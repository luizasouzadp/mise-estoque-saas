-- Nome do contato do fornecedor (a pessoa, não a empresa) e opção de
-- lembrete automático no dia marcado para fazer o pedido.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS notify_on_order_day BOOLEAN NOT NULL DEFAULT false;

-- Inscrições de notificação push do navegador (uma por dispositivo/navegador
-- que ativar os lembretes), usadas pelo lembrete diário de dia de pedido.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_restaurant ON public.push_subscriptions(restaurant_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view push_subscriptions" ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members insert push_subscriptions" ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members update push_subscriptions" ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members delete push_subscriptions" ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (restaurant_id = public.current_restaurant_id());
