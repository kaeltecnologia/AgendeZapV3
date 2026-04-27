-- Add unique constraint on affiliate_link_id so ON CONFLICT upserts work
ALTER TABLE reseller_profiles
  ADD CONSTRAINT IF NOT EXISTS reseller_profiles_affiliate_link_id_key
  UNIQUE (affiliate_link_id);
