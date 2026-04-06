-- =============================================================================
-- AccountEngine — Migration 006: Financial Event Store & Deterministic Engine
-- Author: AccountEngine CTO
-- =============================================================================
--
-- DESIGN PHILOSOPHY:
--   Every financial outcome is the deterministic result of an immutable event
--   processed through a versioned rule set.
--
--   The chain is:
--     financial_event (immutable)
--       → rule_execution (versioned, reproducible)
--         → journal_entry (locked, hash-verified)
--           → audit_chain (hash-chained, tamper-evident)
--
--   Given the same event + same rule_version → identical journal output.
--   This is the property that makes the system revision-safe.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: financial_events
-- The single source of truth for everything that happens.
-- IMMUTABLE after insert. Never updated, never deleted.
-- Every journal entry traces back to exactly one financial event.
-- ---------------------------------------------------------------------------
CREATE TYPE financial_event_type AS ENUM (
  -- Payment processor events
  'stripe_charge',
  'stripe_refund',
  'stripe_fee',
  'stripe_payout',
  'stripe_chargeback',
  'stripe_dispute_won',
  'shopify_order',
  'shopify_refund',
  'shopify_payout',
  'paypal_payment',
  'paypal_refund',
  'paypal_fee',
  -- Bank events
  'bank_credit',
  'bank_debit',
  'bank_fee',
  -- Internal events
  'manual_entry',
  'opening_balance',
  'period_correction',
  'payroll_run',
  'depreciation_run',
  'fx_revaluation',
  'reminder_fee',
  'invoice_created',
  'invoice_paid',
  'supplier_invoice_paid'
);

CREATE TYPE event_processing_status AS ENUM (
  'pending',       -- Received, not yet validated
  'validated',     -- Passed all blockers
  'blocked',       -- Has blockers — cannot post
  'posted',        -- Journal entry created
  'skipped',       -- Intentionally skipped (rule action = skip)
  'failed',        -- Processing error
  'reversed'       -- Reversed by another event
);

CREATE TABLE financial_events (
  id                uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid                   NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  event_type        financial_event_type   NOT NULL,
  occurred_at       timestamptz            NOT NULL,   -- When it happened in reality
  recorded_at       timestamptz            NOT NULL DEFAULT NOW(),   -- When we recorded it
  source            text                   NOT NULL,   -- 'stripe' | 'shopify' | 'bank' | 'manual'
  source_id         text,                              -- External ID in source system
  source_ref        text,                              -- Secondary reference (payout_id, order_id)
  amount            numeric                NOT NULL,
  currency          char(3)                NOT NULL,
  amount_sek        numeric,                           -- Converted at event time
  exchange_rate     numeric,
  payload           jsonb                  NOT NULL,   -- Raw, unmodified source data
  payload_hash      text                   NOT NULL,   -- SHA-256 of payload for integrity
  processing_status event_processing_status NOT NULL DEFAULT 'pending',
  rule_version      text,                              -- Which rule set version was applied
  journal_entry_id  uuid REFERENCES journal_entries (id) ON DELETE SET NULL,
  reversal_of       uuid REFERENCES financial_events (id) ON DELETE SET NULL,
  reversed_by       uuid REFERENCES financial_events (id) ON DELETE SET NULL,
  import_id         uuid REFERENCES imports (id) ON DELETE SET NULL,
  idempotency_key   text                   NOT NULL,   -- SHA-256(source:source_id:company_id)
  created_by        text                   NOT NULL DEFAULT 'system',
  -- Immutability: no updates allowed after status = 'posted'
  locked_at         timestamptz,
  UNIQUE (company_id, idempotency_key)
);

-- Prevent ANY modification to posted or reversed events
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.processing_status IN ('posted', 'reversed') THEN
    -- Only allow updating the reversed_by pointer on posted events
    IF OLD.processing_status = 'posted' AND
       OLD.reversed_by IS NULL AND
       NEW.reversed_by IS NOT NULL AND
       NEW.processing_status = 'reversed' THEN
      RETURN NEW;  -- Allow: marking a posted event as reversed
    END IF;
    IF OLD.processing_status = 'reversed' THEN
      RAISE EXCEPTION 'Financial event % is reversed and fully immutable.', OLD.id;
    END IF;
    -- Allow only status transitions on posted events
    IF OLD.id            = NEW.id            AND
       OLD.event_type    = NEW.event_type    AND
       OLD.occurred_at   = NEW.occurred_at   AND
       OLD.payload_hash  = NEW.payload_hash  AND
       OLD.idempotency_key = NEW.idempotency_key
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'Financial event % is locked (status: %). Core fields are immutable.',
      OLD.id, OLD.processing_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_prevent_mutation
  BEFORE UPDATE ON financial_events
  FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

CREATE INDEX idx_fe_company_id       ON financial_events (company_id, occurred_at DESC);
CREATE INDEX idx_fe_status           ON financial_events (company_id, processing_status);
CREATE INDEX idx_fe_idempotency_key  ON financial_events (idempotency_key);
CREATE INDEX idx_fe_source           ON financial_events (company_id, source, source_id);
CREATE INDEX idx_fe_journal_entry    ON financial_events (journal_entry_id) WHERE journal_entry_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: rule_versions
-- Every time the rule set changes, a new version is created.
-- Events are always processed against a specific, immutable rule version.
-- This ensures that re-running an event always produces the same output.
-- ---------------------------------------------------------------------------
CREATE TABLE rule_versions (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  version_tag     text    NOT NULL,   -- e.g. "2026-04-01_v1", "2026-04-01_v2"
  is_current      bool    NOT NULL DEFAULT false,
  rules_snapshot  jsonb   NOT NULL,   -- Full snapshot of all active rules at this version
  rules_hash      text    NOT NULL,   -- SHA-256 of rules_snapshot — integrity check
  change_summary  text,               -- Human-readable description of what changed
  created_by      uuid    REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, version_tag)
);

-- Ensure only one current version per company
CREATE UNIQUE INDEX idx_rule_versions_current
  ON rule_versions (company_id)
  WHERE is_current = true;

CREATE INDEX idx_rule_versions_company ON rule_versions (company_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Table: rule_executions
-- Records exactly which rules were evaluated and what decision was made
-- for each financial event. Append-only — never updated.
-- ---------------------------------------------------------------------------
CREATE TABLE rule_executions (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid    NOT NULL REFERENCES financial_events (id) ON DELETE RESTRICT,
  company_id          uuid    NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  rule_version_id     uuid    REFERENCES rule_versions (id) ON DELETE RESTRICT,
  rule_version_tag    text    NOT NULL,
  matched_rule_id     uuid    REFERENCES rules (id) ON DELETE SET NULL,
  matched_rule_name   text,
  action_taken        text    NOT NULL CHECK (action_taken IN ('auto_post', 'queue', 'skip', 'blocked')),
  tax_treatment       tax_treatment,
  generated_lines     jsonb   NOT NULL DEFAULT '[]',  -- The proposed journal lines
  generated_hash      text    NOT NULL,               -- SHA-256 of generated_lines — reproducibility
  blockers            jsonb   NOT NULL DEFAULT '[]',  -- Array of BlockerType objects
  execution_time_ms   int,
  executed_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_re_event_id   ON rule_executions (event_id);
CREATE INDEX idx_re_company_id ON rule_executions (company_id);

-- ---------------------------------------------------------------------------
-- Table: event_blockers
-- Normalized blocker records. One row per blocker per event.
-- Allows querying "all events blocked because of missing VAT rate" etc.
-- ---------------------------------------------------------------------------
CREATE TYPE blocker_severity AS ENUM ('error', 'warning', 'info');

CREATE TABLE event_blockers (
  id              uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid             NOT NULL REFERENCES financial_events (id) ON DELETE CASCADE,
  company_id      uuid             NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  blocker_code    text             NOT NULL,  -- Machine-readable code
  severity        blocker_severity NOT NULL DEFAULT 'error',
  message         text             NOT NULL,  -- Human-readable in Swedish
  context         jsonb            NOT NULL DEFAULT '{}',  -- Additional context data
  resolved_at     timestamptz,
  resolved_by     uuid             REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blockers_event_id   ON event_blockers (event_id);
CREATE INDEX idx_blockers_company_id ON event_blockers (company_id, resolved_at);
CREATE INDEX idx_blockers_code       ON event_blockers (company_id, blocker_code) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Table: audit_chain
-- Hash-chained audit log. Each entry contains the hash of the previous entry.
-- Makes tampering detectable: if any entry is modified, all subsequent hashes break.
-- This is the difference between "we have logs" and "we can prove nothing was changed".
-- ---------------------------------------------------------------------------
CREATE TABLE audit_chain (
  sequence_num    bigserial   PRIMARY KEY,             -- Global monotonic sequence
  company_id      uuid        REFERENCES companies (id) ON DELETE SET NULL,
  event_id        uuid        REFERENCES financial_events (id) ON DELETE SET NULL,
  entry_id        uuid        REFERENCES journal_entries (id) ON DELETE SET NULL,
  action          text        NOT NULL,
  actor_id        text        NOT NULL DEFAULT 'system',  -- user_id or 'system'
  actor_type      text        NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system', 'inngest')),
  payload         jsonb       NOT NULL,                -- The audited data
  payload_hash    text        NOT NULL,                -- SHA-256(payload)
  prev_hash       text        NOT NULL,                -- Hash of previous row's chain_hash
  chain_hash      text        NOT NULL,                -- SHA-256(sequence_num||payload_hash||prev_hash)
  created_at      timestamptz NOT NULL DEFAULT NOW()
  -- NOTE: No foreign key to auth.users — audit survives user deletion
);

-- Ensure sequence integrity
CREATE UNIQUE INDEX idx_audit_chain_seq ON audit_chain (sequence_num);
CREATE INDEX idx_audit_chain_company    ON audit_chain (company_id, created_at DESC);
CREATE INDEX idx_audit_chain_event      ON audit_chain (event_id) WHERE event_id IS NOT NULL;

-- Verify chain integrity function (call periodically to detect tampering)
CREATE OR REPLACE FUNCTION verify_audit_chain_integrity(
  p_company_id uuid,
  p_from_seq   bigint DEFAULT 1,
  p_limit      int    DEFAULT 1000
) RETURNS TABLE (
  sequence_num    bigint,
  is_valid        bool,
  expected_hash   text,
  actual_hash     text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_prev_hash text := '0000000000000000000000000000000000000000000000000000000000000000';
  r           record;
BEGIN
  FOR r IN
    SELECT ac.sequence_num, ac.payload_hash, ac.prev_hash, ac.chain_hash
    FROM audit_chain ac
    WHERE (p_company_id IS NULL OR ac.company_id = p_company_id)
      AND ac.sequence_num >= p_from_seq
    ORDER BY ac.sequence_num
    LIMIT p_limit
  LOOP
    DECLARE
      v_expected_chain text;
    BEGIN
      -- Recompute chain hash
      v_expected_chain := encode(
        sha256(convert_to(r.sequence_num::text || r.payload_hash || v_prev_hash, 'UTF8')),
        'hex'
      );

      sequence_num  := r.sequence_num;
      is_valid      := (v_expected_chain = r.chain_hash AND v_prev_hash = r.prev_hash);
      expected_hash := v_expected_chain;
      actual_hash   := r.chain_hash;

      RETURN NEXT;
      v_prev_hash := r.chain_hash;
    END;
  END LOOP;
END;
$$;

-- Write to audit chain (called from application layer)
CREATE OR REPLACE FUNCTION write_audit_chain(
  p_company_id uuid,
  p_event_id   uuid,
  p_entry_id   uuid,
  p_action     text,
  p_actor_id   text,
  p_actor_type text,
  p_payload    jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prev_hash     text;
  v_payload_hash  text;
  v_chain_hash    text;
  v_seq           bigint;
BEGIN
  -- Get previous hash (last row for this company, or genesis hash)
  SELECT chain_hash INTO v_prev_hash
  FROM audit_chain
  WHERE company_id = p_company_id
  ORDER BY sequence_num DESC
  LIMIT 1;

  v_prev_hash := COALESCE(v_prev_hash,
    '0000000000000000000000000000000000000000000000000000000000000000'
  );

  -- Hash the payload
  v_payload_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

  -- Insert to get sequence number
  INSERT INTO audit_chain (
    company_id, event_id, entry_id,
    action, actor_id, actor_type,
    payload, payload_hash, prev_hash, chain_hash
  ) VALUES (
    p_company_id, p_event_id, p_entry_id,
    p_action, p_actor_id, p_actor_type,
    p_payload, v_payload_hash, v_prev_hash,
    'PENDING'  -- placeholder, updated below
  ) RETURNING sequence_num INTO v_seq;

  -- Compute chain hash using actual sequence number
  v_chain_hash := encode(
    sha256(convert_to(v_seq::text || v_payload_hash || v_prev_hash, 'UTF8')),
    'hex'
  );

  UPDATE audit_chain SET chain_hash = v_chain_hash WHERE sequence_num = v_seq;

  RETURN v_seq;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: process_financial_event
-- The single entry point for all posting.
-- Input:  financial_event_id
-- Output: { status, journal_entry_id, blockers }
-- Atomic: either posts completely or rolls back entirely.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_financial_event(
  p_event_id   uuid,
  p_actor_id   text DEFAULT 'system'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event       record;
  v_execution   record;
  v_entry_id    uuid;
  v_entry_number text;
  v_line        jsonb;
  v_line_num    int := 0;
  v_blockers    jsonb;
  v_fiscal_year int;
  v_period_month int;
BEGIN
  -- Lock the event for processing
  SELECT * INTO v_event
  FROM financial_events
  WHERE id = p_event_id
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial event % not found.', p_event_id;
  END IF;

  IF v_event.processing_status NOT IN ('pending', 'validated') THEN
    RAISE EXCEPTION
      'Event % cannot be processed in status: %.',
      p_event_id, v_event.processing_status;
  END IF;

  -- Get the latest rule execution for this event
  SELECT * INTO v_execution
  FROM rule_executions
  WHERE event_id = p_event_id
  ORDER BY executed_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No rule execution found for event %. Run rule engine first.', p_event_id;
  END IF;

  -- Check for unresolved blockers
  SELECT jsonb_agg(jsonb_build_object('code', blocker_code, 'message', message, 'severity', severity))
  INTO v_blockers
  FROM event_blockers
  WHERE event_id = p_event_id AND resolved_at IS NULL AND severity = 'error';

  IF v_blockers IS NOT NULL AND jsonb_array_length(v_blockers) > 0 THEN
    UPDATE financial_events SET processing_status = 'blocked' WHERE id = p_event_id;
    RETURN jsonb_build_object('status', 'blocked', 'blockers', v_blockers);
  END IF;

  -- Skip if rule said skip
  IF v_execution.action_taken = 'skip' THEN
    UPDATE financial_events SET processing_status = 'skipped' WHERE id = p_event_id;
    RETURN jsonb_build_object('status', 'skipped');
  END IF;

  -- Determine period
  v_fiscal_year  := EXTRACT(year  FROM v_event.occurred_at)::int;
  v_period_month := EXTRACT(month FROM v_event.occurred_at)::int;

  -- Ensure period open
  INSERT INTO accounting_periods (company_id, fiscal_year, month)
    VALUES (v_event.company_id, v_fiscal_year, v_period_month)
    ON CONFLICT (company_id, fiscal_year, month) DO NOTHING;

  PERFORM 1 FROM accounting_periods
  WHERE company_id  = v_event.company_id
    AND fiscal_year = v_fiscal_year
    AND month       = v_period_month
    AND status      = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Period %/% is not open.', v_fiscal_year, v_period_month;
  END IF;

  -- Generate entry number
  v_entry_number := next_entry_number(v_event.company_id, v_fiscal_year);

  -- Create journal entry
  INSERT INTO journal_entries (
    company_id, entry_number, entry_date,
    fiscal_year, period_month, description,
    status, source, source_ref,
    created_by
  ) VALUES (
    v_event.company_id,
    v_entry_number,
    v_event.occurred_at::date,
    v_fiscal_year,
    v_period_month,
    v_event.event_type::text || ' — ' || COALESCE(v_event.source_id, v_event.id::text),
    'draft',
    'import',
    v_event.source_id,
    p_actor_id::uuid
  ) RETURNING id INTO v_entry_id;

  -- Insert journal lines from rule execution
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_execution.generated_lines)
  LOOP
    v_line_num := v_line_num + 1;
    INSERT INTO journal_lines (
      entry_id, company_id, line_number, side,
      account_id, account_number, account_name,
      amount, currency, description, vat_code, vat_amount
    )
    SELECT
      v_entry_id,
      v_event.company_id,
      v_line_num,
      (v_line->>'side')::normal_side,
      a.id,
      a.account_number,
      a.name,
      (v_line->>'amount')::numeric,
      COALESCE(v_line->>'currency', v_event.currency),
      NULLIF(v_line->>'description', ''),
      NULLIF(v_line->>'vat_code', ''),
      COALESCE((v_line->>'vat_amount')::numeric, 0)
    FROM accounts a
    WHERE a.company_id     = v_event.company_id
      AND a.account_number = v_line->>'account_number'
      AND a.is_active      = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account % not found for company %.', v_line->>'account_number', v_event.company_id;
    END IF;
  END LOOP;

  -- Post entry (triggers balance check)
  UPDATE journal_entries
  SET status = 'posted', posted_at = NOW(), posted_by = p_actor_id::uuid
  WHERE id = v_entry_id;

  -- Link entry to event
  UPDATE financial_events
  SET
    processing_status = 'posted',
    journal_entry_id  = v_entry_id,
    rule_version      = v_execution.rule_version_tag,
    locked_at         = NOW()
  WHERE id = p_event_id;

  -- Write to hash chain
  PERFORM write_audit_chain(
    v_event.company_id,
    p_event_id,
    v_entry_id,
    'event.posted',
    p_actor_id,
    'system',
    jsonb_build_object(
      'event_id',      p_event_id,
      'event_type',    v_event.event_type,
      'entry_number',  v_entry_number,
      'entry_id',      v_entry_id,
      'rule_version',  v_execution.rule_version_tag,
      'generated_hash',v_execution.generated_hash,
      'amount',        v_event.amount,
      'currency',      v_event.currency,
      'occurred_at',   v_event.occurred_at
    )
  );

  RETURN jsonb_build_object(
    'status',          'posted',
    'journal_entry_id', v_entry_id,
    'entry_number',    v_entry_number,
    'line_count',      v_line_num
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Mark event as failed (within same transaction — will rollback)
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE financial_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_executions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_blockers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain         ENABLE ROW LEVEL SECURITY;

CREATE POLICY fe_select ON financial_events FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY fe_insert ON financial_events FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
-- No UPDATE policy via RLS — updates only via trigger-gated paths

CREATE POLICY rv_select ON rule_versions FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY re_select ON rule_executions FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY re_insert ON rule_executions FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY eb_select ON event_blockers FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));

-- Audit chain: read-only for authenticated users of the company
CREATE POLICY ac_select ON audit_chain FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
-- INSERT only via write_audit_chain() which is SECURITY DEFINER
