-- v4.23: Full white-label theme color columns
ALTER TABLE reseller_profiles
  ADD COLUMN IF NOT EXISTS page_bg_color  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_bg_color  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS text_color     TEXT DEFAULT NULL;
