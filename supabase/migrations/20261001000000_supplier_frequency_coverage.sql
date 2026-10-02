-- Frequência de compra do fornecedor e cobertura mínima de estoque (em dias).
-- O intervalo em dias é derivado da frequência pelo próprio banco
-- (semanal = 7, quinzenal = 14, mensal = 30, sob demanda = sem intervalo fixo).
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS order_frequency TEXT
    CHECK (order_frequency IN ('weekly', 'biweekly', 'monthly', 'on_demand')),
  ADD COLUMN IF NOT EXISTS min_coverage_days INTEGER
    CHECK (min_coverage_days >= 0),
  ADD COLUMN IF NOT EXISTS order_interval_days INTEGER
    GENERATED ALWAYS AS (
      CASE order_frequency
        WHEN 'weekly' THEN 7
        WHEN 'biweekly' THEN 14
        WHEN 'monthly' THEN 30
        ELSE NULL
      END
    ) STORED;
