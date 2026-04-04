-- Affiliate links system for external partners/salespeople
CREATE TABLE IF NOT EXISTS affiliate_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  phone TEXT,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  email TEXT,
  password TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_links_slug ON affiliate_links(slug);

-- Track which affiliate link brought each tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS affiliate_link_id UUID REFERENCES affiliate_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_affiliate_link_id
  ON tenants(affiliate_link_id) WHERE affiliate_link_id IS NOT NULL;
