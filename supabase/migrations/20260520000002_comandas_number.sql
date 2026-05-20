-- v4.93: add number column to comandas table
-- This column was being inserted by createComanda() but missing from the schema,
-- causing every Supabase insert to fail silently (fallback to localStorage only).
-- Without this column, comandas created by professionals were invisible to the admin
-- on a different device (empty localStorage).

ALTER TABLE comandas
  ADD COLUMN IF NOT EXISTS number INTEGER;
