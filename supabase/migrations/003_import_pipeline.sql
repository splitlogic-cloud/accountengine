-- =============================================================================
-- AccountEngine — Migration 003: Import Pipeline, Currency, Tax & Rules
-- Author: AccountEngine CTO
-- Description: The import pipeline normalises raw data from Stripe, Shopify,
--              PayPal and bank files into accounting-ready transactions.
--              Currency rates, tax classification and rules are defined here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: currency_rates
-- Daily ECB rates. Fetched nightly via background job.
-- Used to convert foreign currency transactions to SEK at time of transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE currency_rates (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date       date    NOT NULL,
  from_currency   char(3) NOT NULL,
  to_currency     char(3) NOT NULL DEFAULT 'SEK',
  rate            numeric NOT NULL CHECK (rate > 0),
  source          text    NOT NULL DEFAULT 'ecb',
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (rate_date, from_currency, to_currency)
);

CREATE INDEX idx_currency_rates_date ON currency_rates (rate_date DESC, from_currency);

-- Function: get rate for a given date, falling back to most recent if no exact match
CREATE OR REPLACE FUNCTION get_exchange_rate(
  p_from_currency char(3),
  p_date          date,
  p_to_currency   char(3) DEFAULT 'SEK'
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF p_from_currency = p_to_currency THEN
    RETURN 1.0;
  END IF;

  SELECT rate INTO v_rate
  FROM currency_rates
  WHERE from_currency = p_from_currency
    AND to_currency   = p_to_currency
    AND rate_date    <= p_date
  ORDER BY rate_date DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION
      'No exchange rate found for %→% on or before %.',
      p_from_currency, p_to_currency, p_date;
  END IF;

  RETURN v_rate;
END;
$$;

-- ---------------------------------------------------------------------------
-- Table: integrations
-- One record per data source per company (Stripe, Shopify, etc.)
-- Credentials are AES-256-GCM encrypted at application layer before storage.
-- ---------------------------------------------------------------------------
CREATE TABLE integrations (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  source          text    NOT NULL CHECK (source IN ('stripe', 'shopify', 'paypal', 'bank_file', 'fortnox', 'sie4')),
  display_name    text,
  status          text    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error', 'pending')),
  credentials     text,           -- AES-256-GCM encrypted JSON, prefix: "v{n}:{base64}"
  key_version     int     NOT NULL DEFAULT 1,
  config          jsonb   NOT NULL DEFAULT '{}',   -- source-specific config (webhooks, shop domain, etc.)
  last_synced_at  timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, source)
);

CREATE TRIGGER integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_integrations_company_id ON integrations (company_id);
CREATE INDEX idx_integrations_status     ON integrations (status) WHERE status = 'error';

-- ---------------------------------------------------------------------------
-- Table: imports
-- Tracks each import run. One import = one fetch from one source.
-- ---------------------------------------------------------------------------
CREATE TABLE imports (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid          NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  integration_id  uuid          REFERENCES integrations (id) ON DELETE SET NULL,
  source          text          NOT NULL,
  status          import_status NOT NULL DEFAULT 'queued',
  from_date       date,
  to_date         date,
  raw_count       int           NOT NULL DEFAULT 0,  -- rows received from source
  tx_count        int           NOT NULL DEFAULT 0,  -- normalised transactions created
  skip_count      int           NOT NULL DEFAULT 0,  -- duplicates skipped
  error_count     int           NOT NULL DEFAULT 0,
  error_message   text,
  error_detail    jsonb,
  inngest_event   text,         -- event ID for tracing
  started_at      timestamptz,
  completed_at    timestamptz,
  created_by      uuid          REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT NOW(),
  updated_at      timestamptz   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER imports_updated_at
  BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_imports_company_id ON imports (company_id, created_at DESC);
CREATE INDEX idx_imports_status     ON imports (status) WHERE status IN ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- Table: transactions
-- Normalised representation of every financial event from every source.
-- fingerprint = SHA-256(company_id||source||external_id||date||amount||currency)
-- This guarantees idempotency across re-runs and prevents duplicates.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id              uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid      NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  import_id       uuid      REFERENCES imports (id) ON DELETE SET NULL,
  source          text      NOT NULL,
  external_id     text,               -- original ID in source system
  external_ref    text,               -- secondary reference (e.g. Stripe payout_id)
  fingerprint     text      NOT NULL, -- SHA-256, used for deduplication
  transaction_type tx_type  NOT NULL,
  amount          numeric   NOT NULL, -- positive = revenue/inbound, negative = cost/outbound
  currency        char(3)   NOT NULL,
  amount_sek      numeric,            -- converted to SEK using exchange_rate
  exchange_rate   numeric,
  exchange_rate_id uuid     REFERENCES currency_rates (id) ON DELETE SET NULL,
  transaction_date date     NOT NULL,
  value_date      date,               -- bank value date when relevant
  description     text,
  counterpart_name text,
  counterpart_ref  text,              -- BG/PG/IBAN/org_number of counterpart
  customer_country char(2),           -- ISO-3166-1 alpha-2, critical for VAT
  customer_type   customer_type_enum  NOT NULL DEFAULT 'unknown',
  customer_vat_number text,           -- if known, triggers B2B reverse charge
  status          tx_status NOT NULL DEFAULT 'unprocessed',
  raw_data        jsonb,              -- original payload from source, unmodified
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fingerprint)
);

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tx_company_id      ON transactions (company_id);
CREATE INDEX idx_tx_date            ON transactions (company_id, transaction_date);
CREATE INDEX idx_tx_status          ON transactions (company_id, status);
CREATE INDEX idx_tx_source          ON transactions (company_id, source);
CREATE INDEX idx_tx_external_ref    ON transactions (company_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX idx_tx_fingerprint     ON transactions (fingerprint); -- global dedup check

-- ---------------------------------------------------------------------------
-- Table: transaction_tax_results
-- One record per transaction. Stores the classification result.
-- classified_by: 'rule' | 'ai' | 'manual'
-- Evidence stores exactly what data drove the classification decision.
-- ---------------------------------------------------------------------------
CREATE TABLE transaction_tax_results (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid          NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE,
  company_id      uuid          NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  tax_treatment   tax_treatment NOT NULL,
  vat_rate        numeric       CHECK (vat_rate IS NULL OR vat_rate IN (0, 6, 12, 25)),
  vat_amount      numeric       NOT NULL DEFAULT 0,
  taxable_amount  numeric       NOT NULL DEFAULT 0,
  jurisdiction    char(2),      -- ISO country code where VAT is due
  scheme          text          CHECK (scheme IN ('standard', 'oss', 'reverse_charge', 'none')),
  classified_by   text          NOT NULL DEFAULT 'rule' CHECK (classified_by IN ('rule', 'ai', 'manual')),
  rule_id         uuid,         -- FK set after rules table is created
  ai_confidence   numeric       CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 100),
  ai_reasoning    text,         -- Claude's explanation in Swedish
  ai_model        text,         -- e.g. 'claude-sonnet-4-20250514'
  evidence        jsonb         NOT NULL DEFAULT '{}',  -- what data drove the decision
  needs_review    bool          NOT NULL DEFAULT false,
  reviewed_by     uuid          REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT NOW(),
  updated_at      timestamptz   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER tax_results_updated_at
  BEFORE UPDATE ON transaction_tax_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tax_company_id    ON transaction_tax_results (company_id);
CREATE INDEX idx_tax_treatment     ON transaction_tax_results (company_id, tax_treatment);
CREATE INDEX idx_tax_jurisdiction  ON transaction_tax_results (company_id, jurisdiction) WHERE jurisdiction IS NOT NULL;
CREATE INDEX idx_tax_needs_review  ON transaction_tax_results (needs_review) WHERE needs_review = true;

-- ---------------------------------------------------------------------------
-- Table: rules
-- Bookkeeping rules that map transactions to journal line templates.
-- Rules are evaluated in priority order (lower number = higher priority).
-- Conditions and journal_template are typed JSON structures validated by app.
-- ---------------------------------------------------------------------------
CREATE TABLE rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  bureau_id       uuid        REFERENCES bureaus (id) ON DELETE SET NULL,  -- NULL = company-specific
  scope           text        NOT NULL DEFAULT 'company' CHECK (scope IN ('bureau', 'company')),
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  description     text,
  priority        int         NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 9999),
  is_active       bool        NOT NULL DEFAULT true,
  action          rule_action NOT NULL DEFAULT 'auto_post',
  auto_post_min_confidence numeric NOT NULL DEFAULT 90 CHECK (auto_post_min_confidence BETWEEN 0 AND 100),
  -- Conditions: [{"field": "source", "operator": "equals", "value": "stripe"}, ...]
  -- Valid fields: source, transaction_type, tax_treatment, customer_country,
  --               customer_type, counterpart_name, counterpart_ref, amount
  -- Valid operators: equals, not_equals, contains, starts_with, ends_with,
  --                  greater_than, less_than, between, in, not_in
  conditions      jsonb       NOT NULL DEFAULT '[]',
  -- Journal template: [{"side": "debit", "account_number": "1930", "percent": 100, "description": null}, ...]
  -- Percentages must sum to 100 for each side independently
  journal_template jsonb      NOT NULL DEFAULT '[]',
  match_count     int         NOT NULL DEFAULT 0,
  last_matched_at timestamptz,
  version         int         NOT NULL DEFAULT 1,
  created_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER rules_updated_at
  BEFORE UPDATE ON rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_rules_company_id ON rules (company_id, priority, is_active);
CREATE INDEX idx_rules_bureau_id  ON rules (bureau_id) WHERE bureau_id IS NOT NULL;

-- Add FK from tax_results to rules (now that rules table exists)
ALTER TABLE transaction_tax_results
  ADD CONSTRAINT fk_tax_results_rule
  FOREIGN KEY (rule_id) REFERENCES rules (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Table: batches
-- Groups transactions into bookkeeping batches for atomic posting.
-- One batch = one journal entry (or one per period if spanning months).
-- ---------------------------------------------------------------------------
CREATE TABLE batches (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid         NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  import_id       uuid         REFERENCES imports (id) ON DELETE SET NULL,
  source          text         NOT NULL,
  batch_ref       text,        -- e.g. Stripe payout_id, Shopify settlement_id
  fiscal_year     int          NOT NULL,
  period_month    int          NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status          batch_status NOT NULL DEFAULT 'pending',
  tx_count        int          NOT NULL DEFAULT 0,
  total_debit     numeric      NOT NULL DEFAULT 0,
  total_credit    numeric      NOT NULL DEFAULT 0,
  preview_data    jsonb,       -- cached preview of journal lines
  blocker_count   int          NOT NULL DEFAULT 0,
  blockers        jsonb,       -- details of what's blocking posting
  approved_by     uuid         REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_at     timestamptz,
  entry_id        uuid         REFERENCES journal_entries (id) ON DELETE SET NULL,
  error_message   text,
  created_at      timestamptz  NOT NULL DEFAULT NOW(),
  updated_at      timestamptz  NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, source, batch_ref, fiscal_year, period_month)
);

CREATE TRIGGER batches_updated_at
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_batches_company_id ON batches (company_id, status);
CREATE INDEX idx_batches_period     ON batches (company_id, fiscal_year, period_month);
CREATE INDEX idx_batches_entry_id   ON batches (entry_id) WHERE entry_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: batch_transactions
-- Many-to-many: one transaction can only belong to one batch.
-- Enforced via unique index on transaction_id.
-- ---------------------------------------------------------------------------
CREATE TABLE batch_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  transaction_id  uuid NOT NULL REFERENCES transactions (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id)   -- One transaction → one batch only
);

CREATE INDEX idx_batch_tx_batch_id ON batch_transactions (batch_id);

-- ---------------------------------------------------------------------------
-- Table: vat_buckets
-- Aggregated VAT per treatment/jurisdiction/rate/period.
-- Updated atomically when batches are posted.
-- Used for VAT return generation.
-- ---------------------------------------------------------------------------
CREATE TABLE vat_buckets (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year     int     NOT NULL,
  period_month    int     NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  treatment       tax_treatment NOT NULL,
  jurisdiction    char(2),
  vat_rate        numeric,
  taxable_amount  numeric NOT NULL DEFAULT 0,
  vat_amount      numeric NOT NULL DEFAULT 0,
  tx_count        int     NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_year, period_month, treatment, jurisdiction, vat_rate)
);

CREATE INDEX idx_vat_buckets_period ON vat_buckets (company_id, fiscal_year, period_month);

-- ---------------------------------------------------------------------------
-- Table: opening_balances
-- Populated during onboarding via SIE4 import or manual entry.
-- Generates IB (ingående balans) journal entries.
-- ---------------------------------------------------------------------------
CREATE TABLE opening_balances (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid    NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  fiscal_year     int     NOT NULL,
  account_number  text    NOT NULL,
  balance         numeric NOT NULL,  -- positive = debit normal, negative = credit normal
  imported_from   text    NOT NULL DEFAULT 'manual' CHECK (imported_from IN ('sie4', 'manual')),
  entry_id        uuid    REFERENCES journal_entries (id) ON DELETE SET NULL,  -- IB entry created
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_year, account_number)
);

CREATE INDEX idx_ob_company_year ON opening_balances (company_id, fiscal_year);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE integrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_tax_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_buckets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;

-- Currency rates are readable by all authenticated users
CREATE POLICY currency_rates_select ON currency_rates FOR SELECT USING (auth.uid() IS NOT NULL);

-- All other tables: company-scoped
CREATE POLICY integrations_select ON integrations FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY integrations_insert ON integrations FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY integrations_update ON integrations FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY imports_select ON imports FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY imports_insert ON imports FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY imports_update ON imports FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY transactions_select ON transactions FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY transactions_insert ON transactions FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY tax_results_select ON transaction_tax_results FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY tax_results_insert ON transaction_tax_results FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY tax_results_update ON transaction_tax_results FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY rules_select ON rules FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY rules_insert ON rules FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY rules_update ON rules FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY batches_select ON batches FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY batches_insert ON batches FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY batches_update ON batches FOR UPDATE
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY batch_tx_select ON batch_transactions FOR SELECT
  USING (batch_id IN (SELECT id FROM batches WHERE company_id IN (SELECT accessible_company_ids())));
CREATE POLICY batch_tx_insert ON batch_transactions FOR INSERT
  WITH CHECK (batch_id IN (SELECT id FROM batches WHERE company_id IN (SELECT accessible_company_ids())));

CREATE POLICY vat_buckets_select ON vat_buckets FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));

CREATE POLICY ob_select ON opening_balances FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));
CREATE POLICY ob_insert ON opening_balances FOR INSERT
  WITH CHECK (company_id IN (SELECT accessible_company_ids()));
