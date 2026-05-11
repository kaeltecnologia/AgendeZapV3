-- Adiciona coluna origem (canal de agendamento) e is_plan na tabela appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_plan BOOLEAN DEFAULT false;

-- Índice para o relatório de marketing (filtro por origem)
CREATE INDEX IF NOT EXISTS idx_appointments_origem ON appointments (tenant_id, origem);
