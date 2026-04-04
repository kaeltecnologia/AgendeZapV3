-- Referral/Indication System
-- Adds referred_by column to track which tenant referred each new tenant
-- Run in Supabase SQL Editor

-- Add referred_by column (nullable UUID referencing tenants.id)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES tenants(id) ON DELETE SET NULL;

-- Index for fast lookup: "how many active referrals does tenant X have?"
CREATE INDEX IF NOT EXISTS idx_tenants_referred_by ON tenants(referred_by) WHERE referred_by IS NOT NULL;

-- Helper function: count active referrals for a given tenant
CREATE OR REPLACE FUNCTION count_active_referrals(p_tenant_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM tenants
  WHERE referred_by = p_tenant_id
    AND status = 'ATIVA';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function: get referral summary (count + total subscription value of referrals)
CREATE OR REPLACE FUNCTION referral_summary(p_tenant_id UUID)
RETURNS TABLE(active_referrals INTEGER, total_referral_revenue NUMERIC) AS $$
  SELECT
    COUNT(*)::INTEGER AS active_referrals,
    COALESCE(SUM(mensalidade), 0) AS total_referral_revenue
  FROM tenants
  WHERE referred_by = p_tenant_id
    AND status = 'ATIVA';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION count_active_referrals(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION referral_summary(UUID) TO service_role;

-- ── Customer Referrals (B2C2B) ──────────────────────────────────────
-- Track when a customer of a tenant refers a new business to AgendeZap
-- referred_by_customer stores the phone number of the customer who referred
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referred_by_customer TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_referred_by_customer
  ON tenants(referred_by_customer) WHERE referred_by_customer IS NOT NULL;

-- Count active customer referrals by phone
CREATE OR REPLACE FUNCTION count_customer_referrals(p_phone TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM tenants
  WHERE referred_by_customer = p_phone
    AND status = 'ATIVA';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Customer referral summary (count + revenue)
CREATE OR REPLACE FUNCTION customer_referral_summary(p_phone TEXT)
RETURNS TABLE(active_referrals INTEGER, total_referral_revenue NUMERIC) AS $$
  SELECT
    COUNT(*)::INTEGER AS active_referrals,
    COALESCE(SUM(mensalidade), 0) AS total_referral_revenue
  FROM tenants
  WHERE referred_by_customer = p_phone
    AND status = 'ATIVA';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION count_customer_referrals(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION customer_referral_summary(TEXT) TO service_role;
