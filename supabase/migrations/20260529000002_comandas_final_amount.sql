-- Add final_amount column to comandas (stores override value from estorno/adjustment)
ALTER TABLE comandas ADD COLUMN IF NOT EXISTS final_amount NUMERIC;
