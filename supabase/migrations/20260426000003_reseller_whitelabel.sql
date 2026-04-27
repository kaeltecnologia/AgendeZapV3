-- v4.21: White-label reseller system
-- Each affiliate can become a reseller with their own branded portal,
-- custom domain, OpenAI key, plan pricing and feature flags.

-- ── reseller_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_link_id     UUID REFERENCES affiliate_links(id) ON DELETE CASCADE,

  -- Branding
  brand_name            TEXT,
  logo_url              TEXT,
  primary_color         TEXT DEFAULT '#f97316',
  secondary_color       TEXT DEFAULT '#1e293b',
  custom_domain         TEXT UNIQUE,      -- ex: app.minhamarca.com.br
  favicon_url           TEXT,

  -- API integrations (reseller brings their own OpenAI key)
  openai_api_key        TEXT,

  -- Custom plan pricing per reseller: {"START": 59.90, "PROFISSIONAL": 119.90, "ELITE": 199.90}
  plan_pricing          JSONB DEFAULT '{}'::jsonb,

  -- AI customization
  system_prompt_template TEXT,            -- prepended before tenant's custom prompt
  default_agent_name    TEXT,

  -- Feature flags: NULL = all tabs visible; array = only listed keys visible
  visible_features      TEXT[] DEFAULT NULL,

  -- Tenant creation limit (NULL = unlimited)
  max_tenants           INT DEFAULT NULL,

  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reseller_profiles_affiliate  ON reseller_profiles(affiliate_link_id);
CREATE INDEX IF NOT EXISTS idx_reseller_profiles_domain     ON reseller_profiles(custom_domain) WHERE custom_domain IS NOT NULL;

-- ── FK on tenants ─────────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES reseller_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_reseller_id ON tenants(reseller_id) WHERE reseller_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE reseller_profiles ENABLE ROW LEVEL SECURITY;

-- Anon can read active profiles (needed for domain-based branding before login)
DROP POLICY IF EXISTS "reseller_read_public" ON reseller_profiles;
CREATE POLICY "reseller_read_public" ON reseller_profiles
  FOR SELECT USING (active = true);

-- Only service_role can write (all writes go through edge functions)
DROP POLICY IF EXISTS "reseller_write_service" ON reseller_profiles;
CREATE POLICY "reseller_write_service" ON reseller_profiles
  FOR ALL USING (auth.role() = 'service_role');
