-- v4.90: custo de material por serviço
-- Percentual deduzido da comissão do profissional, calculado sobre o valor cadastrado do serviço

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS material_cost_percent DECIMAL(5,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN services.material_cost_percent IS
  'Percentual do valor do serviço deduzido como custo de material antes de calcular comissão';
