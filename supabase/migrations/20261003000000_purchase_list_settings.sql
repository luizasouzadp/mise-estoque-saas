-- Lista de compras automática: campos que faltavam em fornecedores e insumos.
--
-- Fornecedor
--   order_interval_days (já existe, derivado de order_frequency) = intervalo PREFERIDO.
--   possible_interval_days = intervalo POSSÍVEL entre pedidos (ex.: Daniel entrega toda
--     semana = 7, mas o preferido é quinzenal = 14). Vazio = deduzido dos dias de pedido.
--   safety_days = margem de segurança em dias (padrão 2).
--   is_active = desativar sem perder o histórico.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS possible_interval_days INTEGER
    CHECK (possible_interval_days >= 1),
  ADD COLUMN IF NOT EXISTS safety_days INTEGER NOT NULL DEFAULT 2
    CHECK (safety_days >= 0),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Insumo: embalagem de compra (tamanho na unidade do insumo + nome).
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS purchase_pack_qty NUMERIC
    CHECK (purchase_pack_qty > 0),
  ADD COLUMN IF NOT EXISTS purchase_pack_name TEXT;
