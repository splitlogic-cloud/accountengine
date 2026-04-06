-- =============================================================================
-- AccountEngine — Migration 005: RPC Functions & BAS Seed
-- Author: AccountEngine CTO
-- Description: Atomic posting RPC, create_journal_entry_draft RPC,
--              BAS-kontoplan seed function, period auto-creation,
--              and bureau-level batch job tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RPC: create_journal_entry_draft
-- Creates journal entry + lines atomically.
-- Called from application layer (journal-service.ts).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_journal_entry_draft(
  p_company_id    uuid,
  p_entry_date    date,
  p_fiscal_year   int,
  p_period_month  int,
  p_description   text,
  p_source        text,
  p_source_ref    text,
  p_created_by    uuid,
  p_lines         jsonb   -- Array of line objects
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_entry_id     uuid;
  v_entry_number text;
  v_entry        jsonb;
  v_line         jsonb;
  v_line_num     int := 0;
BEGIN
  -- Ensure period exists (auto-create if not)
  INSERT INTO accounting_periods (company_id, fiscal_year, month, status)
    VALUES (p_company_id, p_fiscal_year, p_period_month, 'open')
    ON CONFLICT (company_id, fiscal_year, month) DO NOTHING;

  -- Generate entry number
  v_entry_number := next_entry_number(p_company_id, p_fiscal_year);

  -- Create entry
  INSERT INTO journal_entries (
    company_id, entry_number, entry_date,
    fiscal_year, period_month, description,
    status, source, source_ref, created_by
  ) VALUES (
    p_company_id, v_entry_number, p_entry_date,
    p_fiscal_year, p_period_month, p_description,
    'draft', p_source::entry_source, p_source_ref, p_created_by
  ) RETURNING id INTO v_entry_id;

  -- Insert lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_num := v_line_num + 1;
    INSERT INTO journal_lines (
      entry_id, company_id, line_number, side,
      account_id, account_number, account_name,
      amount, currency, amount_sek, exchange_rate,
      description, vat_code, vat_amount,
      cost_center, project_code
    ) VALUES (
      v_entry_id,
      p_company_id,
      (v_line->>'line_number')::int,
      (v_line->>'side')::normal_side,
      (v_line->>'account_id')::uuid,
      v_line->>'account_number',
      v_line->>'account_name',
      (v_line->>'amount')::numeric,
      COALESCE(v_line->>'currency', 'SEK'),
      NULLIF(v_line->>'amount_sek', '')::numeric,
      NULLIF(v_line->>'exchange_rate', '')::numeric,
      NULLIF(v_line->>'description', ''),
      NULLIF(v_line->>'vat_code', ''),
      COALESCE((v_line->>'vat_amount')::numeric, 0),
      NULLIF(v_line->>'cost_center', ''),
      NULLIF(v_line->>'project_code', '')
    );
  END LOOP;

  -- Return entry as JSON
  SELECT to_jsonb(je.*) INTO v_entry
  FROM journal_entries je
  WHERE je.id = v_entry_id;

  RETURN v_entry;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: post_batch_atomic
-- Posts a batch as a journal entry in a single database transaction.
-- If ANY step fails, the entire operation rolls back.
-- Idempotent: checking batch.status = 'posting' before proceeding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_batch_atomic(
  p_batch_id    uuid,
  p_company_id  uuid,
  p_entry_date  date,
  p_description text,
  p_posted_by   uuid,
  p_lines       jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_batch         record;
  v_entry_id      uuid;
  v_entry_number  text;
  v_fiscal_year   int;
  v_period_month  int;
  v_line          jsonb;
  v_line_num      int := 0;
  v_total_debit   numeric := 0;
  v_total_credit  numeric := 0;
BEGIN
  -- 1. Lock and verify batch is in 'posting' status
  SELECT * INTO v_batch
  FROM batches
  WHERE id = p_batch_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % not found for company %.', p_batch_id, p_company_id;
  END IF;

  IF v_batch.status <> 'posting' THEN
    RAISE EXCEPTION
      'Batch % must be in posting status, got: %.',
      p_batch_id, v_batch.status;
  END IF;

  -- 2. Determine period from entry_date
  v_fiscal_year  := EXTRACT(year  FROM p_entry_date)::int;
  v_period_month := EXTRACT(month FROM p_entry_date)::int;

  -- 3. Ensure period exists and is open
  INSERT INTO accounting_periods (company_id, fiscal_year, month, status)
    VALUES (p_company_id, v_fiscal_year, v_period_month, 'open')
    ON CONFLICT (company_id, fiscal_year, month) DO NOTHING;

  -- Check period is not locked or closed
  PERFORM 1 FROM accounting_periods
  WHERE company_id  = p_company_id
    AND fiscal_year = v_fiscal_year
    AND month       = v_period_month
    AND status      = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Accounting period %/% is not open. Cannot post batch.',
      v_fiscal_year, v_period_month;
  END IF;

  -- 4. Generate entry number
  v_entry_number := next_entry_number(p_company_id, v_fiscal_year);

  -- 5. Create the journal entry (draft first, then post)
  INSERT INTO journal_entries (
    company_id, entry_number, entry_date,
    fiscal_year, period_month, description,
    status, source, source_batch_id, created_by
  ) VALUES (
    p_company_id, v_entry_number, p_entry_date,
    v_fiscal_year, v_period_month, p_description,
    'draft', 'import', p_batch_id, p_posted_by
  ) RETURNING id INTO v_entry_id;

  -- 6. Insert all journal lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_num := v_line_num + 1;

    INSERT INTO journal_lines (
      entry_id, company_id, line_number, side,
      account_id, account_number, account_name,
      amount, currency, description,
      vat_code, vat_amount
    )
    SELECT
      v_entry_id,
      p_company_id,
      v_line_num,
      (v_line->>'side')::normal_side,
      a.id,
      a.account_number,
      a.name,
      (v_line->>'amount')::numeric,
      'SEK',
      NULLIF(v_line->>'description', ''),
      NULLIF(v_line->>'vat_code', ''),
      COALESCE((v_line->>'vat_amount')::numeric, 0)
    FROM accounts a
    WHERE a.company_id     = p_company_id
      AND a.account_number = v_line->>'account_number'
      AND a.is_active      = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Account % not found or inactive in company %.',
        v_line->>'account_number', p_company_id;
    END IF;

    -- Track totals for final balance check
    IF (v_line->>'side') = 'debit' THEN
      v_total_debit  := v_total_debit  + (v_line->>'amount')::numeric;
    ELSE
      v_total_credit := v_total_credit + (v_line->>'amount')::numeric;
    END IF;
  END LOOP;

  -- 7. Verify balance before posting (redundant with trigger — belt and suspenders)
  IF ABS(v_total_debit - v_total_credit) > 0.005 THEN
    RAISE EXCEPTION
      'Batch lines do not balance: Debit=% Credit=%.',
      v_total_debit, v_total_credit;
  END IF;

  -- 8. Post the entry (trigger will re-validate balance)
  UPDATE journal_entries
  SET
    status    = 'posted',
    posted_by = p_posted_by,
    posted_at = NOW()
  WHERE id = v_entry_id;

  -- 9. Update batch: posted + entry_id
  UPDATE batches
  SET
    status    = 'posted',
    entry_id  = v_entry_id,
    updated_at = NOW()
  WHERE id = p_batch_id;

  -- 10. Mark all batch transactions as posted
  UPDATE transactions t
  SET
    status     = 'posted',
    updated_at = NOW()
  FROM batch_transactions bt
  WHERE bt.batch_id      = p_batch_id
    AND bt.transaction_id = t.id;

  -- 11. Return result
  RETURN jsonb_build_object(
    'entry_id',     v_entry_id,
    'entry_number', v_entry_number,
    'line_count',   v_line_num,
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Update batch to failed (cannot rollback this since we're in the same transaction,
    -- but the entire transaction will rollback, so batch stays in 'posting' for retry)
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: close_period
-- Closes an accounting period. Validates no draft entries exist.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION close_period(
  p_company_id   uuid,
  p_fiscal_year  int,
  p_period_month int,
  p_closed_by    uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_draft_count int;
  v_period      record;
BEGIN
  SELECT * INTO v_period
  FROM accounting_periods
  WHERE company_id  = p_company_id
    AND fiscal_year = p_fiscal_year
    AND month       = p_period_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period %/% not found.', p_fiscal_year, p_period_month;
  END IF;

  IF v_period.status <> 'open' THEN
    RAISE EXCEPTION
      'Period %/% is not open (status: %). Cannot close.',
      p_fiscal_year, p_period_month, v_period.status;
  END IF;

  -- Check for draft entries
  SELECT COUNT(*) INTO v_draft_count
  FROM journal_entries
  WHERE company_id   = p_company_id
    AND fiscal_year  = p_fiscal_year
    AND period_month = p_period_month
    AND status       IN ('draft', 'pending_approval');

  IF v_draft_count > 0 THEN
    RAISE EXCEPTION
      'Cannot close period %/% — % draft or pending entry/entries exist. Post or void them first.',
      p_fiscal_year, p_period_month, v_draft_count;
  END IF;

  UPDATE accounting_periods
  SET
    status     = 'closed',
    closed_at  = NOW(),
    closed_by  = p_closed_by,
    updated_at = NOW()
  WHERE company_id  = p_company_id
    AND fiscal_year = p_fiscal_year
    AND month       = p_period_month;

  PERFORM write_audit(
    p_company_id,
    NULL,
    'period.closed',
    'accounting_period',
    v_period.id,
    NULL,
    jsonb_build_object(
      'fiscal_year',  p_fiscal_year,
      'period_month', p_period_month,
      'closed_by',    p_closed_by
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: reopen_period
-- Reopens a closed period. Requires admin — always audit logged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reopen_period(
  p_company_id   uuid,
  p_fiscal_year  int,
  p_period_month int,
  p_reopened_by  uuid,
  p_reason       text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required to reopen a period.';
  END IF;

  UPDATE accounting_periods
  SET
    status        = 'open',
    reopened_at   = NOW(),
    reopened_by   = p_reopened_by,
    reopen_reason = p_reason,
    updated_at    = NOW()
  WHERE company_id  = p_company_id
    AND fiscal_year = p_fiscal_year
    AND month       = p_period_month
    AND status      IN ('closed', 'locked');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Period %/% not found or already open.',
      p_fiscal_year, p_period_month;
  END IF;

  PERFORM write_audit(
    p_company_id,
    NULL,
    'period.reopened',
    'accounting_period',
    NULL,
    NULL,
    jsonb_build_object(
      'fiscal_year',  p_fiscal_year,
      'period_month', p_period_month,
      'reopened_by',  p_reopened_by,
      'reason',       p_reason
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Function: seed_bas_accounts
-- Seeds BAS-kontoplan for a new company.
-- Called once on company creation.
-- Full BAS 2024/2025 chart of accounts (accounting plan).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_bas_accounts(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO accounts (company_id, account_number, name, account_type, normal_side, vat_code, is_system, sort_order)
  VALUES
    -- ── TILLGÅNGAR (Assets) ──────────────────────────────────────────────────
    (p_company_id, '1010', 'Byggnader',                              'asset', 'debit', NULL,  true,  1010),
    (p_company_id, '1110', 'Mark',                                   'asset', 'debit', NULL,  true,  1110),
    (p_company_id, '1120', 'Markanläggningar',                       'asset', 'debit', NULL,  true,  1120),
    (p_company_id, '1210', 'Maskiner och andra tekniska anläggningar','asset', 'debit', NULL,  true,  1210),
    (p_company_id, '1220', 'Inventarier och verktyg',                'asset', 'debit', NULL,  true,  1220),
    (p_company_id, '1229', 'Ack. avskrivn. inventarier',             'asset', 'credit',NULL,  true,  1229),
    (p_company_id, '1240', 'Bilar och andra transportmedel',         'asset', 'debit', NULL,  true,  1240),
    (p_company_id, '1249', 'Ack. avskrivn. bilar',                   'asset', 'credit',NULL,  true,  1249),
    (p_company_id, '1310', 'Andelar i koncernföretag',               'asset', 'debit', NULL,  true,  1310),
    (p_company_id, '1381', 'Lån till delägare eller närstående',     'asset', 'debit', NULL,  true,  1381),
    (p_company_id, '1410', 'Lager av råvaror',                       'asset', 'debit', NULL,  true,  1410),
    (p_company_id, '1460', 'Lager av färdiga varor',                 'asset', 'debit', NULL,  true,  1460),
    (p_company_id, '1510', 'Kundfordringar',                         'asset', 'debit', NULL,  true,  1510),
    (p_company_id, '1511', 'Osäkra kundfordringar',                  'asset', 'debit', NULL,  true,  1511),
    (p_company_id, '1512', 'Befarade kundförluster',                 'asset', 'credit',NULL,  true,  1512),
    (p_company_id, '1520', 'Växelfordringar',                        'asset', 'debit', NULL,  true,  1520),
    (p_company_id, '1610', 'Fordringar hos anställda',               'asset', 'debit', NULL,  true,  1610),
    (p_company_id, '1620', 'Fordringar hos delägare',                'asset', 'debit', NULL,  true,  1620),
    (p_company_id, '1630', 'Avräkning för skatter och avgifter (Skattekonto)', 'asset', 'debit', NULL, true, 1630),
    (p_company_id, '1640', 'Skattefordran',                          'asset', 'debit', NULL,  true,  1640),
    (p_company_id, '1650', 'Momsfordran',                            'asset', 'debit', NULL,  true,  1650),
    (p_company_id, '1710', 'Förutbetalda hyreskostnader',            'asset', 'debit', NULL,  true,  1710),
    (p_company_id, '1720', 'Förutbetalda försäkringspremier',        'asset', 'debit', NULL,  true,  1720),
    (p_company_id, '1790', 'Övriga förutbetalda kostnader och upplupna intäkter', 'asset', 'debit', NULL, true, 1790),
    (p_company_id, '1910', 'Kassa',                                  'asset', 'debit', NULL,  true,  1910),
    (p_company_id, '1920', 'PlusGiro',                               'asset', 'debit', NULL,  true,  1920),
    (p_company_id, '1930', 'Företagskonto / affärskonto',            'asset', 'debit', NULL,  true,  1930),
    (p_company_id, '1940', 'Övriga bankkonton',                      'asset', 'debit', NULL,  true,  1940),
    (p_company_id, '1941', 'Bankkonto Stripe',                       'asset', 'debit', NULL,  true,  1941),
    (p_company_id, '1942', 'Bankkonto PayPal',                       'asset', 'debit', NULL,  true,  1942),
    (p_company_id, '1980', 'Värdepapper',                            'asset', 'debit', NULL,  true,  1980),

    -- ── EGET KAPITAL (Equity) ────────────────────────────────────────────────
    (p_company_id, '2010', 'Aktiekapital',                           'equity','credit',NULL,  true,  2010),
    (p_company_id, '2020', 'Ej registrerat aktiekapital',            'equity','credit',NULL,  true,  2020),
    (p_company_id, '2030', 'Överkursfond',                           'equity','credit',NULL,  true,  2030),
    (p_company_id, '2086', 'Reservfond',                             'equity','credit',NULL,  true,  2086),
    (p_company_id, '2091', 'Balanserad vinst eller förlust',         'equity','credit',NULL,  true,  2091),
    (p_company_id, '2099', 'Årets resultat',                         'equity','credit',NULL,  true,  2099),

    -- ── SKULDER (Liabilities) ────────────────────────────────────────────────
    (p_company_id, '2250', 'Checkräkningskredit',                    'liability','credit',NULL, true, 2250),
    (p_company_id, '2350', 'Skulder till kreditinstitut, långfristiga', 'liability','credit',NULL, true, 2350),
    (p_company_id, '2390', 'Övriga kortfristiga skulder',            'liability','credit',NULL, true, 2390),
    (p_company_id, '2391', 'Förskott från kunder (presentkort mm)',  'liability','credit',NULL, true, 2391),
    (p_company_id, '2440', 'Leverantörsskulder',                     'liability','credit',NULL, true, 2440),
    (p_company_id, '2510', 'Skatteskulder',                          'liability','credit',NULL, true, 2510),
    (p_company_id, '2512', 'Innehållen preliminärskatt',             'liability','credit',NULL, true, 2512),
    (p_company_id, '2513', 'Innehållen utländsk källskatt',          'liability','credit',NULL, true, 2513),
    (p_company_id, '2650', 'Redovisningskonto för moms',             'liability','credit','49', true, 2650),
    -- Moms: Utgående moms
    (p_company_id, '2610', 'Utgående moms, 25 %',                   'liability','credit','20', true, 2610),
    (p_company_id, '2611', 'Utgående moms, 25 %, ej deklarerad',    'liability','credit','20', true, 2611),
    (p_company_id, '2612', 'Utgående moms, 12 %',                   'liability','credit','22', true, 2612),
    (p_company_id, '2613', 'Utgående moms, 6 %',                    'liability','credit','23', true, 2613),
    (p_company_id, '2614', 'Utgående moms OSS EU',                  'liability','credit','20', true, 2614),
    (p_company_id, '2615', 'Utgående moms, import/export, 25 %',    'liability','credit','20', true, 2615),
    -- Moms: Ingående moms
    (p_company_id, '2640', 'Ingående moms',                         'asset',   'debit', '48', true, 2640),
    (p_company_id, '2641', 'Ingående moms, 25 %',                   'asset',   'debit', '48', true, 2641),
    (p_company_id, '2642', 'Ingående moms, 12 %',                   'asset',   'debit', '48', true, 2642),
    (p_company_id, '2643', 'Ingående moms, 6 %',                    'asset',   'debit', '48', true, 2643),
    (p_company_id, '2645', 'Beräknad ingående moms på förvärv från utlandet', 'asset', 'debit', '48', true, 2645),
    -- Personalrelaterade skulder
    (p_company_id, '2710', 'Personalskatt',                          'liability','credit',NULL, true, 2710),
    (p_company_id, '2730', 'Lagstadgade sociala avgifter',           'liability','credit',NULL, true, 2730),
    (p_company_id, '2731', 'Arbetsgivaravgifter',                    'liability','credit',NULL, true, 2731),
    (p_company_id, '2750', 'Semesterlöneskuld',                      'liability','credit',NULL, true, 2750),
    (p_company_id, '2890', 'Skulder till anställda / delägare',      'liability','credit',NULL, true, 2890),
    (p_company_id, '2920', 'Upplupna löner',                         'liability','credit',NULL, true, 2920),
    (p_company_id, '2940', 'Upplupna räntekostnader',                'liability','credit',NULL, true, 2940),
    (p_company_id, '2990', 'Övriga upplupna kostnader och förutbetalda intäkter', 'liability','credit',NULL, true, 2990),

    -- ── INTÄKTER (Revenue) ───────────────────────────────────────────────────
    (p_company_id, '3001', 'Försäljning varor, 25 % moms',          'revenue', 'credit','05', true, 3001),
    (p_company_id, '3002', 'Försäljning varor, 12 % moms',          'revenue', 'credit','06', true, 3002),
    (p_company_id, '3003', 'Försäljning varor, 6 % moms',           'revenue', 'credit','07', true, 3003),
    (p_company_id, '3010', 'Försäljning tjänster, 25 % moms',       'revenue', 'credit','05', true, 3010),
    (p_company_id, '3011', 'Försäljning tjänster, 12 % moms',       'revenue', 'credit','06', true, 3011),
    (p_company_id, '3012', 'Försäljning tjänster, 6 % moms',        'revenue', 'credit','07', true, 3012),
    (p_company_id, '3040', 'Försäljning SaaS / prenumerationstjänster', 'revenue','credit','05', true, 3040),
    (p_company_id, '3105', 'Försäljning varor utom EU (export)',     'revenue', 'credit','10', true, 3105),
    (p_company_id, '3106', 'Försäljning tjänster utom EU (export)',  'revenue', 'credit','10', true, 3106),
    (p_company_id, '3108', 'Försäljning varor inom EU (OSS)',        'revenue', 'credit','39', true, 3108),
    (p_company_id, '3109', 'Försäljning tjänster inom EU (OSS)',     'revenue', 'credit','39', true, 3109),
    (p_company_id, '3200', 'Hyresintäkter',                          'revenue', 'credit','05', true, 3200),
    (p_company_id, '3211', 'Intäkter EU-handel, omvänd skattskyldighet', 'revenue','credit','40', true, 3211),
    (p_company_id, '3590', 'Påminnelseavgifter',                     'revenue', 'credit','05', true, 3590),
    (p_company_id, '3740', 'Öres- och kronutjämning',                'revenue', 'credit', NULL, true, 3740),
    (p_company_id, '3960', 'Valutakursvinster på fordringar och skulder', 'revenue','credit',NULL, true, 3960),
    (p_company_id, '3970', 'Valutakursvinster på likvida medel',     'revenue', 'credit',NULL, true, 3970),

    -- ── KOSTNADER — Handelskostnader ─────────────────────────────────────────
    (p_company_id, '4010', 'Inköp varor och material, 25 % moms',   'expense', 'debit', NULL,  true, 4010),
    (p_company_id, '4090', 'Inköp varor från EU',                    'expense', 'debit', NULL,  true, 4090),
    (p_company_id, '4400', 'Förbrukningsinventarier och förbrukningsmaterial', 'expense','debit',NULL, true, 4400),
    (p_company_id, '4500', 'Underentreprenörer',                     'expense', 'debit', NULL,  true, 4500),

    -- ── KOSTNADER — Personalkostnader ────────────────────────────────────────
    (p_company_id, '5000', 'Löner',                                  'expense', 'debit', NULL,  true, 5000),
    (p_company_id, '5010', 'Löner och arvoden, kollektivanställda',  'expense', 'debit', NULL,  true, 5010),
    (p_company_id, '5020', 'Löner och arvoden, tjänstemän',          'expense', 'debit', NULL,  true, 5020),
    (p_company_id, '5070', 'Sjuklöner',                              'expense', 'debit', NULL,  true, 5070),
    (p_company_id, '5090', 'Övriga löner och ersättningar',          'expense', 'debit', NULL,  true, 5090),
    (p_company_id, '5400', 'Arbetsgivaravgifter',                    'expense', 'debit', NULL,  true, 5400),
    (p_company_id, '5410', 'Beräknade semesterlöner',                'expense', 'debit', NULL,  true, 5410),
    (p_company_id, '5420', 'Lagstadgade sociala avgifter',           'expense', 'debit', NULL,  true, 5420),
    (p_company_id, '5460', 'Tjänstepension',                         'expense', 'debit', NULL,  true, 5460),
    (p_company_id, '5800', 'Resekostnader',                          'expense', 'debit', NULL,  true, 5800),
    (p_company_id, '5801', 'Resor med bil',                          'expense', 'debit', NULL,  true, 5801),
    (p_company_id, '5802', 'Traktamente och resetillägg',            'expense', 'debit', NULL,  true, 5802),
    (p_company_id, '5900', 'Reklam och PR',                          'expense', 'debit', NULL,  true, 5900),
    (p_company_id, '5910', 'Annonsering',                            'expense', 'debit', NULL,  true, 5910),

    -- ── KOSTNADER — Lokalkostnader ───────────────────────────────────────────
    (p_company_id, '5010', 'Lokalhyra',                              'expense', 'debit', NULL,  true, 6010),
    (p_company_id, '6010', 'Lokalhyra',                              'expense', 'debit', NULL,  true, 6011),
    (p_company_id, '6011', 'Hyra kontorslokaler',                    'expense', 'debit', NULL,  true, 6012),
    (p_company_id, '6070', 'Städning och renhållning',               'expense', 'debit', NULL,  true, 6070),
    (p_company_id, '6090', 'Övriga lokalkostnader',                  'expense', 'debit', NULL,  true, 6090),
    (p_company_id, '6110', 'Kontorsmateriel',                        'expense', 'debit', NULL,  true, 6110),
    (p_company_id, '6150', 'Trycksaker',                             'expense', 'debit', NULL,  true, 6150),
    (p_company_id, '6200', 'Tele och post',                          'expense', 'debit', NULL,  true, 6200),
    (p_company_id, '6210', 'Fast telefoni',                          'expense', 'debit', NULL,  true, 6210),
    (p_company_id, '6212', 'Telefoni och telefax',                   'expense', 'debit', NULL,  true, 6212),
    (p_company_id, '6220', 'Datatrafik',                             'expense', 'debit', NULL,  true, 6220),
    (p_company_id, '6230', 'Mobiltelefon',                           'expense', 'debit', NULL,  true, 6230),
    (p_company_id, '6250', 'Porto och frakt',                        'expense', 'debit', NULL,  true, 6250),
    (p_company_id, '6310', 'Företagsförsäkringar',                   'expense', 'debit', NULL,  true, 6310),
    (p_company_id, '6410', 'Styrelsearvode',                         'expense', 'debit', NULL,  true, 6410),
    (p_company_id, '6420', 'Revision',                               'expense', 'debit', NULL,  true, 6420),
    (p_company_id, '6430', 'Juridiska kostnader',                    'expense', 'debit', NULL,  true, 6430),
    (p_company_id, '6530', 'Redovisningstjänster',                   'expense', 'debit', NULL,  true, 6530),
    (p_company_id, '6540', 'IT-tjänster och support',                'expense', 'debit', NULL,  true, 6540),
    (p_company_id, '6550', 'Programvarulicenser / SaaS-prenumerationer', 'expense','debit',NULL, true, 6550),
    (p_company_id, '6570', 'Bankavgifter och fakturaavgifter',       'expense', 'debit', NULL,  true, 6570),
    (p_company_id, '6571', 'Kortavgifter och betalningstjänster (Stripe, PayPal mm)', 'expense','debit',NULL, true, 6571),
    (p_company_id, '6590', 'Övriga externa tjänster',                'expense', 'debit', NULL,  true, 6590),
    (p_company_id, '6720', 'Representation, avdragsgill',            'expense', 'debit', NULL,  true, 6720),
    (p_company_id, '6730', 'Representation, ej avdragsgill',         'expense', 'debit', NULL,  true, 6730),

    -- ── KOSTNADER — Avskrivningar ─────────────────────────────────────────────
    (p_company_id, '7800', 'Avskrivning immateriella anläggningstillgångar', 'expense','debit',NULL, true, 7800),
    (p_company_id, '7810', 'Avskrivning byggnad och markanläggningar','expense','debit', NULL,  true, 7810),
    (p_company_id, '7820', 'Avskrivning inventarier',                'expense', 'debit', NULL,  true, 7820),
    (p_company_id, '7830', 'Avskrivning bilar',                      'expense', 'debit', NULL,  true, 7830),

    -- ── FINANSIELLA POSTER ───────────────────────────────────────────────────
    (p_company_id, '8010', 'Ränteintäkter',                          'revenue', 'credit',NULL, true, 8010),
    (p_company_id, '8310', 'Räntekostnader för kortfristiga skulder','expense', 'debit', NULL,  true, 8310),
    (p_company_id, '8320', 'Räntekostnader för långfristiga skulder','expense', 'debit', NULL,  true, 8320),
    (p_company_id, '7960', 'Valutakursförluster på fordringar och skulder', 'expense','debit',NULL, true, 7960),
    (p_company_id, '7970', 'Valutakursförluster på likvida medel',   'expense', 'debit', NULL,  true, 7970),

    -- ── SKATT ────────────────────────────────────────────────────────────────
    (p_company_id, '8910', 'Skatt på årets resultat',                'expense', 'debit', NULL,  true, 8910),
    (p_company_id, '8920', 'Uppskjuten skatt',                       'expense', 'debit', NULL,  true, 8920)

  ON CONFLICT (company_id, account_number) DO NOTHING;
END;
$$;

-- Trigger: auto-seed BAS on company creation
CREATE OR REPLACE FUNCTION on_company_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM seed_bas_accounts(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER company_seed_bas
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION on_company_created();

-- ---------------------------------------------------------------------------
-- Bureau jobs table (for mass operations across all clients)
-- ---------------------------------------------------------------------------
CREATE TABLE bureau_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bureau_id       uuid        NOT NULL REFERENCES bureaus (id) ON DELETE CASCADE,
  job_type        text        NOT NULL CHECK (job_type IN ('sync_all', 'batch_all', 'post_all', 'close_period_all', 'vat_report_all')),
  status          text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  config          jsonb       NOT NULL DEFAULT '{}',
  total_companies int         NOT NULL DEFAULT 0,
  done_companies  int         NOT NULL DEFAULT 0,
  failed_companies int        NOT NULL DEFAULT 0,
  results         jsonb       NOT NULL DEFAULT '[]',
  error_summary   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  triggered_by    uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  inngest_event   text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER bureau_jobs_updated_at
  BEFORE UPDATE ON bureau_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_bureau_jobs_bureau_id ON bureau_jobs (bureau_id, status);

ALTER TABLE bureau_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY bureau_jobs_select ON bureau_jobs FOR SELECT
  USING (bureau_id = current_bureau_id());
CREATE POLICY bureau_jobs_insert ON bureau_jobs FOR INSERT
  WITH CHECK (bureau_id = current_bureau_id());
CREATE POLICY bureau_jobs_update ON bureau_jobs FOR UPDATE
  USING (bureau_id = current_bureau_id());

-- ---------------------------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------------------------
CREATE TABLE notification_preferences (
  id                    uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid    NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  company_id            uuid    REFERENCES companies (id) ON DELETE CASCADE,
  notify_import_failed  bool    NOT NULL DEFAULT true,
  notify_batch_blocked  bool    NOT NULL DEFAULT true,
  notify_vat_due        bool    NOT NULL DEFAULT true,
  notify_invoice_overdue bool   NOT NULL DEFAULT true,
  notify_period_closing bool    NOT NULL DEFAULT false,
  vat_due_days_before   int     NOT NULL DEFAULT 14,
  invoice_overdue_days  int     NOT NULL DEFAULT 1,
  email_enabled         bool    NOT NULL DEFAULT true,
  slack_webhook         text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, company_id)
);

CREATE TRIGGER notif_prefs_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_prefs_select ON notification_preferences FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY notif_prefs_all ON notification_preferences FOR ALL
  USING (user_id = auth.uid());
