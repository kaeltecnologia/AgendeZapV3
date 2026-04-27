-- Add unique constraint on affiliate_link_id so ON CONFLICT upserts work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reseller_profiles_affiliate_link_id_key'
  ) THEN
    ALTER TABLE reseller_profiles
      ADD CONSTRAINT reseller_profiles_affiliate_link_id_key
      UNIQUE (affiliate_link_id);
  END IF;
END$$;
