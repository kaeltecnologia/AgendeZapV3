-- v4.24: favicon_url column for reseller white-label
ALTER TABLE reseller_profiles
  ADD COLUMN IF NOT EXISTS favicon_url TEXT DEFAULT NULL;
