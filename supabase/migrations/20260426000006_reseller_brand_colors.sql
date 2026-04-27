-- Add extended brand color columns to reseller_profiles
ALTER TABLE reseller_profiles
  ADD COLUMN IF NOT EXISTS font_color  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bg_color    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS icon_color  TEXT DEFAULT NULL;
