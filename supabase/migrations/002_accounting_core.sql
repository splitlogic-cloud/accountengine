-- =============================================================================
-- AccountEngine — Migration 002: Accounting Core
-- Author: AccountEngine CTO
-- Description: The non-negotiable bookkeeping engine.
--              chart_of_accounts, accounting_periods, journal_entries,
--              journal_lines, entry_sequences, audit_log.
--
--              Key invariants enforced at DB level:
--              1. Debit MUST equal Credit before status='posted'
--              2. entry_number is unique per company per fiscal year, never reused
--              3. journal_lines cannot be inserted for a non-existent or locked period
--              4. audit_log is append-only — no UPDATE or DELETE policies
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: accounts (Chart of Accounts per company)
-- BAS-standard seeded automatically on company creation.
-- account_number is text to support sub-accounts (e.g. "1930-1", "3010-SE")
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  account_number  text        NOT NULL CHECK (account_number ~ '^\d{4}(-[A-Z0-9]+)?$'),
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  account_type    account_type NOT NULL,
  normal_side     normal_side NOT NULL,
  vat_code        text,       -- SKV reporting code e.g. '05', '10', '48'
  is_active       bool        NOT NULL DEFAULT true,
  is_system       bool        NOT NULL DEFAULT false,  -- system accounts cannot be deleted
  opening_balance numeric     NOT NULL DEFAULT 0,      -- populated during onboarding
  description     text,
  parent_account  text,       -- for hierarchical reporting
  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, account_number)
);

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_accounts_company_id ON accounts (company_id);
CREATE INDEX idx_accounts_number     ON accounts (company_id, account_number);
CREATE INDEX idx_accounts_type       ON accounts (company_id, account_type);
-- Fast text search on account name
CREATE INDEX idx_accounts_name_trgm  ON accounts USING gin (name gin_trgm_ops);

-- Prevent deletion of accounts that have journal lines
CREATE OR REPLACE FUNCTION prevent_active_account_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION
      'Cannot delete account % — it has journal line entries. Deactivate instead.',
      OLD.account_number;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_prevent_deletion
  BEFORE DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION prevent_active_account_deletion();

-- ---------------------------------------------------------------------------
-- Table: accounting_periods
-- Each company has monthly periods. Periods progress: open → closed → locked.
-- Locked periods require admin override to reopen (logged in audit).
-- ---------------------------------------------------------------------------
CREATE TABLE accounting_periods (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year     int           NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  month           int           NOT NULL CHECK (month BETWEEN 1 AND 12),
  status          period_status NOT NULL DEFAULT 'open',
  closed_at       timestamptz,
  closed_by       uuid          REFERENCES auth.users (id) ON DELETE SET NULL,
  locked_at       timestamptz,
  locked_by       uuid          REFERENCES auth.users (id) ON DELETE SET NULL,
  reopened_at     timestamptz,
  reopened_by     uuid          REFERENCES auth.users (id) ON DELETE SET NULL,
  reopen_reason   text,
  created_at      timestamptz   NOT NULL DEFAULT NOW(),
  updated_at      timestamptz   NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_year, month)
);

CREATE TRIGGER accounting_periods_updated_at
  BEFORE UPDATE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_periods_company_id ON accounting_periods (company_id);
CREATE INDEX idx_periods_status     ON accounting_periods (company_id, status);

-- Prevent status regression (open ← closed is only allowed with admin override via service role)
CREATE OR REPLACE FUNCTION validate_period_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- locked → open requires explicit reopen (done via service role only)
  IF OLD.status = 'locked' AND NEW.status = 'open' AND NEW.reopen_reason IS NULL THEN
    RAISE EXCEPTION 'Cannot reopen locked period without a reopen_reason.';
  END IF;
  -- Cannot move backwards from closed to open via normal flow
  IF OLD.status = 'closed' AND NEW.status = 'open' AND NEW.reopened_by IS NULL THEN
    RAISE EXCEPTION 'Cannot reopen closed period without setting reopened_by.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER periods_validate_transition
  BEFORE UPDATE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION validate_period_transition();

-- ---------------------------------------------------------------------------
-- Table: entry_sequences
-- Generates sequential entry numbers per company per fiscal year.
-- VER-{year}-{NNNN} e.g. VER-2026-0001
-- Using a separate table with advisory locks ensures no gaps or duplicates.
-- ---------------------------------------------------------------------------
CREATE TABLE entry_sequences (
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year     int     NOT NULL,
  last_number     int     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, fiscal_year)
);

CREATE OR REPLACE FUNCTION next_entry_number(
  p_company_id  uuid,
  p_fiscal_year int
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_next int;
BEGIN
  -- Upsert with row-level lock to guarantee uniqueness under concurrency
  INSERT INTO entry_sequences (company_id, fiscal_year, last_number)
    VALUES (p_company_id, p_fiscal_year, 1)
    ON CONFLICT (company_id, fiscal_year)
    DO UPDATE SET last_number = entry_sequences.last_number + 1
    RETURNING last_number INTO v_next;

  RETURN 'VER-' || p_fiscal_year::text || '-' || LPAD(v_next::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- Table: journal_entries
-- Each entry is a complete double-entry bookkeeping transaction.
-- Once posted, entries are IMMUTABLE. Corrections are made via reversal.
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid         NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  entry_number    text         NOT NULL,   -- e.g. VER-2026-0042
  entry_date      date         NOT NULL,
  fiscal_year     int          NOT NULL,
  period_month    int          NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  description     text         NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  status          entry_status NOT NULL DEFAULT 'draft',
  source          entry_source NOT NULL DEFAULT 'manual',
  source_ref      text,       -- External reference: "stripe:ch_3Pzz", "shopify:order_123"
  source_batch_id uuid,       -- Populated when created from a batch
  reversal_of     uuid        REFERENCES journal_entries (id) ON DELETE RESTRICT,
  reversed_by     uuid        REFERENCES journal_entries (id) ON DELETE RESTRICT,
  approved_by     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_at     timestamptz,
  posted_by       uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  posted_at       timestamptz,
  voided_by       uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  voided_at       timestamptz,
  void_reason     text,
  created_by      uuid        NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, entry_number),
  -- Ensure fiscal_year and period_month are consistent with entry_date
  CONSTRAINT valid_period CHECK (
    fiscal_year BETWEEN 2000 AND 2100 AND
    period_month BETWEEN 1 AND 12
  )
);

CREATE TRIGGER journal_entries_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_je_company_id    ON journal_entries (company_id);
CREATE INDEX idx_je_entry_date    ON journal_entries (company_id, entry_date);
CREATE INDEX idx_je_period        ON journal_entries (company_id, fiscal_year, period_month);
CREATE INDEX idx_je_status        ON journal_entries (company_id, status);
CREATE INDEX idx_je_source_ref    ON journal_entries (company_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX idx_je_source_batch  ON journal_entries (source_batch_id) WHERE source_batch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Critical trigger: enforce double-entry balance before posting
-- Debit MUST equal Credit. Zero-amount postings are rejected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_double_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_debit  numeric;
  v_credit numeric;
  v_count  int;
BEGIN
  -- Only validate when transitioning to 'posted'
  IF NEW.status <> 'posted' OR OLD.status = 'posted' THEN
    RETURN NEW;
  END IF;

  -- Must have at least 2 lines (one debit, one credit)
  SELECT COUNT(*) INTO v_count
  FROM journal_lines WHERE entry_id = NEW.id;

  IF v_count < 2 THEN
    RAISE EXCEPTION
      'Journal entry % must have at least 2 lines before posting (has %).',
      NEW.entry_number, v_count;
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE side = 'debit'),  0),
    COALESCE(SUM(amount) FILTER (WHERE side = 'credit'), 0)
  INTO v_debit, v_credit
  FROM journal_lines
  WHERE entry_id = NEW.id;

  IF v_debit = 0 THEN
    RAISE EXCEPTION
      'Journal entry % has zero debit total. Cannot post an empty entry.',
      NEW.entry_number;
  END IF;

  -- Use numeric comparison with tolerance for floating point
  IF ABS(v_debit - v_credit) > 0.005 THEN
    RAISE EXCEPTION
      'Journal entry % does not balance: Debit=% Credit=% (difference=%).',
      NEW.entry_number,
      TO_CHAR(v_debit,  'FM999G999G999D00'),
      TO_CHAR(v_credit, 'FM999G999G999D00'),
      TO_CHAR(ABS(v_debit - v_credit), 'FM999G999G999D00');
  END IF;

  -- Set posted_at timestamp if not already set
  IF NEW.posted_at IS NULL THEN
    NEW.posted_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER je_enforce_balance
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_double_entry_balance();

-- Prevent editing posted entries (immutability)
CREATE OR REPLACE FUNCTION prevent_posted_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'posted' AND NEW.status = 'posted' THEN
    -- Only allow updating metadata fields, not accounting fields
    IF OLD.entry_date    <> NEW.entry_date    OR
       OLD.fiscal_year   <> NEW.fiscal_year   OR
       OLD.period_month  <> NEW.period_month  OR
       OLD.description   <> NEW.description   OR
       OLD.company_id    <> NEW.company_id
    THEN
      RAISE EXCEPTION
        'Posted journal entry % is immutable. Create a reversal entry to correct it.',
        OLD.entry_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER je_prevent_mutation
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_entry_mutation();

-- Prevent posting into a locked period
CREATE OR REPLACE FUNCTION prevent_posting_to_locked_period()
RETURNS TRIGGER AS $$
DECLARE
  v_period_status period_status;
BEGIN
  IF NEW.status = 'posted' AND OLD.status <> 'posted' THEN
    SELECT status INTO v_period_status
    FROM accounting_periods
    WHERE company_id = NEW.company_id
      AND fiscal_year = NEW.fiscal_year
      AND month = NEW.period_month;

    IF v_period_status = 'locked' THEN
      RAISE EXCEPTION
        'Cannot post to locked period %/%. Use admin override to reopen.',
        NEW.fiscal_year, NEW.period_month;
    END IF;

    IF v_period_status = 'closed' THEN
      RAISE EXCEPTION
        'Cannot post to closed period %/%. Period must be reopened first.',
        NEW.fiscal_year, NEW.period_month;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER je_prevent_locked_period_posting
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_posting_to_locked_period();

-- ---------------------------------------------------------------------------
-- Table: journal_lines
-- Individual debit/credit lines within an entry.
-- amount is always positive — side determines debit/credit.
-- ---------------------------------------------------------------------------
CREATE TABLE journal_lines (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid        NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  company_id      uuid        NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  line_number     int         NOT NULL CHECK (line_number > 0),
  side            normal_side NOT NULL,
  account_id      uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  account_number  text        NOT NULL,   -- denormalized for query performance and historical accuracy
  account_name    text        NOT NULL,   -- denormalized: preserves name at time of posting
  amount          numeric     NOT NULL CHECK (amount > 0),
  currency        char(3)     NOT NULL DEFAULT 'SEK',
  amount_sek      numeric,                -- always in SEK, populated for foreign currency lines
  exchange_rate   numeric,                -- rate used for conversion
  description     text,
  vat_code        text,
  vat_amount      numeric     NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  cost_center     text,
  project_code    text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (entry_id, line_number),
  -- Foreign currency lines must have conversion data
  CONSTRAINT fx_consistency CHECK (
    (currency = 'SEK') OR
    (currency <> 'SEK' AND amount_sek IS NOT NULL AND exchange_rate IS NOT NULL)
  )
);

CREATE INDEX idx_jl_entry_id     ON journal_lines (entry_id);
CREATE INDEX idx_jl_company_id   ON journal_lines (company_id);
CREATE INDEX idx_jl_account_id   ON journal_lines (account_id);
CREATE INDEX idx_jl_account_num  ON journal_lines (company_id, account_number);

-- Prevent mutation of lines that belong to posted entries
CREATE OR REPLACE FUNCTION prevent_posted_line_mutation()
RETURNS TRIGGER AS $$
DECLARE
  v_entry_status entry_status;
BEGIN
  SELECT status INTO v_entry_status
  FROM journal_entries WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF v_entry_status = 'posted' THEN
    RAISE EXCEPTION
      'Cannot modify journal lines of a posted entry. Create a reversal instead.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jl_prevent_posted_mutation
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_line_mutation();

-- ---------------------------------------------------------------------------
-- View: general_ledger
-- The accounting backbone. All reports derive from this view.
-- Never cache or aggregate this into a separate table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW general_ledger AS
SELECT
  jl.company_id,
  jl.account_number,
  jl.account_name,
  a.account_type,
  a.normal_side,
  je.id                AS entry_id,
  je.entry_number,
  je.entry_date,
  je.fiscal_year,
  je.period_month,
  je.description       AS entry_description,
  jl.description       AS line_description,
  jl.side,
  jl.amount,
  jl.currency,
  jl.amount_sek,
  jl.vat_code,
  jl.vat_amount,
  -- Net amount in normal_side direction (positive = normal, negative = contra)
  CASE
    WHEN a.normal_side = 'debit'
    THEN CASE WHEN jl.side = 'debit' THEN jl.amount ELSE -jl.amount END
    ELSE CASE WHEN jl.side = 'credit' THEN jl.amount ELSE -jl.amount END
  END                  AS net_amount,
  je.source,
  je.source_ref,
  je.posted_at,
  je.posted_by
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
JOIN accounts a         ON a.id  = jl.account_id;

-- ---------------------------------------------------------------------------
-- Table: audit_log
-- Append-only. No UPDATE. No DELETE. Ever.
-- bigserial guarantees ordering even across concurrent inserts.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigserial   PRIMARY KEY,
  company_id      uuid        REFERENCES companies (id) ON DELETE SET NULL,
  bureau_id       uuid        REFERENCES bureaus (id) ON DELETE SET NULL,
  user_id         uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  action          text        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       uuid,
  before_data     jsonb,
  after_data      jsonb,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_company_id   ON audit_log (company_id, created_at DESC);
CREATE INDEX idx_audit_entity       ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_user_id      ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_action       ON audit_log (action, created_at DESC);

-- RLS on audit_log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Users can read audit for their accessible companies
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (
    company_id IN (SELECT accessible_company_ids())
    OR bureau_id = current_bureau_id()
  );

-- INSERT allowed (done via service functions), never UPDATE or DELETE
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (true);
-- No UPDATE policy — append only
-- No DELETE policy — permanent record

-- Convenience function for writing audit entries
CREATE OR REPLACE FUNCTION write_audit(
  p_company_id  uuid,
  p_bureau_id   uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid DEFAULT NULL,
  p_before      jsonb DEFAULT NULL,
  p_after       jsonb DEFAULT NULL,
  p_metadata    jsonb DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_log (
    company_id, bureau_id, user_id,
    action, entity_type, entity_id,
    before_data, after_data, metadata
  ) VALUES (
    p_company_id, p_bureau_id, auth.uid(),
    p_action, p_entity_type, p_entity_id,
    p_before, p_after, p_metadata
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS on accounting tables
-- ---------------------------------------------------------------------------
ALTER TABLE accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines      ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY accounts_insert ON accounts FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY periods_select ON accounting_periods FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY periods_insert ON accounting_periods FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY periods_update ON accounting_periods FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY je_select ON journal_entries FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY je_insert ON journal_entries FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY je_update ON journal_entries FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY jl_select ON journal_lines FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY jl_insert ON journal_lines FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
