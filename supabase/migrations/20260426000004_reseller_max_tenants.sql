-- v4.22: Add max_tenants limit to reseller_profiles
-- NULL = unlimited; integer = cap on number of tenants this reseller can create

ALTER TABLE reseller_profiles
  ADD COLUMN IF NOT EXISTS max_tenants INT DEFAULT NULL;
