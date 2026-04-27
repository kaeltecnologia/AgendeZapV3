-- v4.18: dark-mode color overrides for reseller white-label
ALTER TABLE reseller_profiles
  ADD COLUMN IF NOT EXISTS dark_bg_color       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dark_font_color     TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dark_icon_color     TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dark_page_bg_color  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dark_card_bg_color  TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dark_text_color     TEXT DEFAULT NULL;
