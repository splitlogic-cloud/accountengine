-- =============================================================================
-- AccountEngine — Migration 001: Core Identity & Company Schema
-- Author: AccountEngine CTO
-- Description: Foundation tables for multi-tenant company management.
--              Every subsequent table references companies(id).
--              RLS is enabled on all tables from day one.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- For fast text search on names
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- For exclusion constraints on periods

-- ---------------------------------------------------------------------------
-- Custom types
-- ---------------------------------------------------------------------------
CREATE TYPE company_status      AS ENUM ('active', 'inactive', 'suspended', 'onboarding');
CREATE TYPE member_role         AS ENUM ('owner', 'admin', 'accountant', 'reader', 'auditor');
CREATE TYPE account_type        AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense', 'tax');
CREATE TYPE normal_side         AS ENUM ('debit', 'credit');
CREATE TYPE entry_status        AS ENUM ('draft', 'pending_approval', 'posted', 'reversed', 'void');
CREATE TYPE entry_source        AS ENUM ('manual', 'rule', 'ai', 'import', 'correction', 'opening_balance', 'payroll', 'depreciation');
CREATE TYPE period_status       AS ENUM ('open', 'closed', 'locked');
CREATE TYPE import_status       AS ENUM ('queued', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE batch_status        AS ENUM ('pending', 'preview_ready', 'approved', 'posting', 'posted', 'failed', 'reversed');
CREATE TYPE tx_type             AS ENUM ('sale', 'refund', 'fee', 'payout', 'adjustment', 'transfer', 'chargeback', 'reversal', 'interest', 'subscription');
CREATE TYPE tx_status           AS ENUM ('unprocessed', 'classified', 'batched', 'posted', 'skipped', 'error');
CREATE TYPE tax_treatment       AS ENUM ('domestic_vat', 'eu_oss', 'eu_b2b_reverse_charge', 'export_outside_eu', 'outside_scope', 'exempt', 'unknown');
CREATE TYPE customer_type_enum  AS ENUM ('b2b', 'b2c', 'unknown');
CREATE TYPE payment_direction   AS ENUM ('inbound', 'outbound');
CREATE TYPE payment_status      AS ENUM ('unmatched', 'partial', 'matched', 'excess', 'void');
CREATE TYPE filing_type         AS ENUM ('vat_return', 'oss', 'agi', 'annual', 'intrastat');
CREATE TYPE filing_status       AS ENUM ('draft', 'validated', 'submitted', 'accepted', 'rejected', 'archived');
CREATE TYPE reminder_status     AS ENUM ('draft', 'sent', 'paid', 'cancelled');
CREATE TYPE rule_action         AS ENUM ('auto_post', 'queue', 'skip');
CREATE TYPE bureau_plan         AS ENUM ('starter', 'professional', 'enterprise');

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger (reused across all tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Table: bureaus
-- A bureau is a bookkeeping firm managing multiple client companies.
-- Solo companies will also have a bureau record (self-managed).
-- ---------------------------------------------------------------------------
CREATE TABLE bureaus (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  org_number      text        UNIQUE,
  vat_number      text,
  plan            bureau_plan NOT NULL DEFAULT 'starter',
  max_companies   int         NOT NULL DEFAULT 10,
  settings        jsonb       NOT NULL DEFAULT '{}',
  is_active       bool        NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER bureaus_updated_at
  BEFORE UPDATE ON bureaus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_bureaus_org_number ON bureaus (org_number) WHERE org_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table: profiles
-- Extends auth.users with application-level user data.
-- Created automatically via trigger on auth.users insert.
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id              uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  bureau_id       uuid        REFERENCES bureaus (id) ON DELETE SET NULL,
  full_name       text        CHECK (char_length(full_name) <= 255),
  email           text        NOT NULL,
  phone           text,
  avatar_url      text,
  locale          text        NOT NULL DEFAULT 'sv',
  timezone        text        NOT NULL DEFAULT 'Europe/Stockholm',
  last_seen_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create profile when a user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- Table: companies
-- Each company is an independent accounting entity.
-- fiscal_year_start: 1=Jan (most common), 7=Jul, 9=Sep etc.
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
  id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  bureau_id             uuid           NOT NULL REFERENCES bureaus (id) ON DELETE RESTRICT,
  name                  text           NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  slug                  text           NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
  org_number            text,
  vat_number            text,
  country               char(2)        NOT NULL DEFAULT 'SE',
  currency              char(3)        NOT NULL DEFAULT 'SEK',
  fiscal_year_start     int            NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
  accounting_method     text           NOT NULL DEFAULT 'accrual' CHECK (accounting_method IN ('accrual', 'cash')),
  status                company_status NOT NULL DEFAULT 'onboarding',
  vat_period            text           NOT NULL DEFAULT 'quarterly' CHECK (vat_period IN ('monthly', 'quarterly', 'yearly')),
  oss_registered        bool           NOT NULL DEFAULT false,
  address_line1         text,
  address_line2         text,
  postal_code           text,
  city                  text,
  email                 text,
  phone                 text,
  website               text,
  settings              jsonb          NOT NULL DEFAULT '{}',
  modules_enabled       jsonb          NOT NULL DEFAULT '{"invoicing": true, "payroll": false, "fixed_assets": false}',
  created_at            timestamptz    NOT NULL DEFAULT NOW(),
  updated_at            timestamptz    NOT NULL DEFAULT NOW(),
  UNIQUE (bureau_id, slug),
  UNIQUE (bureau_id, org_number)
);

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_companies_bureau_id ON companies (bureau_id);
CREATE INDEX idx_companies_status    ON companies (status);

-- ---------------------------------------------------------------------------
-- Table: company_members
-- Controls who has access to which company and with what role.
-- ---------------------------------------------------------------------------
CREATE TABLE company_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role            member_role NOT NULL DEFAULT 'accountant',
  is_primary      bool        NOT NULL DEFAULT false,
  invited_by      uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  invited_at      timestamptz,
  accepted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id)
);

CREATE TRIGGER company_members_updated_at
  BEFORE UPDATE ON company_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_company_members_user_id    ON company_members (user_id);
CREATE INDEX idx_company_members_company_id ON company_members (company_id);

-- Ensure only one primary member per company
CREATE UNIQUE INDEX idx_company_members_primary
  ON company_members (company_id)
  WHERE is_primary = true;

-- ---------------------------------------------------------------------------
-- Table: bureau_clients
-- Links a bureau to its client companies with assignment tracking.
-- ---------------------------------------------------------------------------
CREATE TABLE bureau_clients (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bureau_id       uuid        NOT NULL REFERENCES bureaus (id) ON DELETE CASCADE,
  company_id      uuid        NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  assigned_to     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  client_ref      text,       -- Bureau's internal reference for the client
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (bureau_id, company_id)
);

CREATE TRIGGER bureau_clients_updated_at
  BEFORE UPDATE ON bureau_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Policy design: users can only see data for companies they are members of.
-- Service role bypasses RLS for background jobs.
-- ---------------------------------------------------------------------------
ALTER TABLE bureaus          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bureau_clients   ENABLE ROW LEVEL SECURITY;

-- Helper function: returns company_ids the current user can access
CREATE OR REPLACE FUNCTION accessible_company_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id
  FROM company_members
  WHERE user_id = auth.uid()
    AND accepted_at IS NOT NULL
$$;

-- Helper function: returns bureau_id for current user
CREATE OR REPLACE FUNCTION current_bureau_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT bureau_id FROM profiles WHERE id = auth.uid()
$$;

-- Bureaus: users can see their own bureau
CREATE POLICY bureaus_select ON bureaus FOR SELECT
  USING (id = current_bureau_id());

-- Profiles: users can see and update their own profile
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = auth.uid());

-- Companies: only members can see their companies
CREATE POLICY companies_select ON companies FOR SELECT
  USING (id IN (SELECT accessible_company_ids()));

CREATE POLICY companies_insert ON companies FOR INSERT
  WITH CHECK (bureau_id = current_bureau_id());

CREATE POLICY companies_update ON companies FOR UPDATE
  USING (id IN (SELECT accessible_company_ids()))
  WITH CHECK (bureau_id = current_bureau_id());

-- Company members: members can see other members of shared companies
CREATE POLICY company_members_select ON company_members FOR SELECT
  USING (company_id IN (SELECT accessible_company_ids()));

-- Bureau clients: bureau members can see their client assignments
CREATE POLICY bureau_clients_select ON bureau_clients FOR SELECT
  USING (bureau_id = current_bureau_id());
