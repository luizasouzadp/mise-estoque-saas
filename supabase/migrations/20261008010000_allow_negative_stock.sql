-- Estoque pode ficar negativo.
-- Antes, uma saída que levava o estoque abaixo de zero era travada em 0 e a
-- diferença se perdia (ex.: produção lançada com data anterior à compra:
-- 0 - 30 virava 0, e depois a compra de 40 deixava 40 em vez de 10).
-- Agora o valor fica negativo e se acerta quando a entrada é lançada.
-- No custo médio, estoque negativo conta como zero (a compra nova "cobre" o
-- que já saiu), para o preço médio não ficar distorcido.

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_delta NUMERIC := 0;
  new_delta NUMERIC := 0;
BEGIN
  IF current_setting('mise.skip_stock_apply', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') THEN
    old_delta := CASE WHEN OLD.type = 'in' THEN OLD.quantity ELSE -OLD.quantity END;
    IF COALESCE(OLD.reason, '') ILIKE 'Inventário%'
       OR NOT public.absorb_into_next_count(OLD.ingredient_id, OLD.occurred_at, -old_delta) THEN
      UPDATE public.ingredients
        SET current_stock = COALESCE(current_stock,0) - old_delta
        WHERE id = OLD.ingredient_id;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') THEN
    new_delta := CASE WHEN NEW.type = 'in' THEN NEW.quantity ELSE -NEW.quantity END;
    IF COALESCE(NEW.reason, '') ILIKE 'Inventário%'
       OR NOT public.absorb_into_next_count(NEW.ingredient_id, NEW.occurred_at, new_delta) THEN
      UPDATE public.ingredients
        SET current_stock = COALESCE(current_stock,0) + new_delta
        WHERE id = NEW.ingredient_id;
    END IF;
    IF NEW.type = 'in' AND NEW.unit_cost IS NOT NULL THEN
      UPDATE public.ingredients SET last_cost = NEW.unit_cost WHERE id = NEW.ingredient_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

-- Compras: sem trava em zero no estoque.
CREATE OR REPLACE FUNCTION public.apply_purchase_to_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_stock numeric;
  cur_avg numeric;
  new_value numeric;
  new_base numeric;
BEGIN
  -- Estoque (negativo conta como zero) e custo médio antes desta compra.
  IF TG_OP <> 'DELETE' THEN
    SELECT GREATEST(0, COALESCE(current_stock,0)), COALESCE(avg_cost,0) INTO cur_stock, cur_avg
      FROM public.ingredients WHERE id = NEW.ingredient_id;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF NOT public.absorb_into_next_count(OLD.ingredient_id, OLD.purchased_at, -COALESCE(OLD.quantity, 0)) THEN
      UPDATE public.ingredients
        SET current_stock = COALESCE(current_stock,0) - COALESCE(OLD.quantity, 0)
        WHERE id = OLD.ingredient_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Custo médio: compra nova entra na média; na edição, só muda se o preço
  -- mudou (a diferença de preço é distribuída pelo estoque atual).
  IF TG_OP = 'INSERT' OR NEW.ingredient_id <> OLD.ingredient_id THEN
    new_value := cur_stock * cur_avg + NEW.quantity * NEW.unit_cost;
    new_base := cur_stock + NEW.quantity;
  ELSIF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
    new_value := cur_stock * cur_avg + NEW.quantity * (COALESCE(NEW.unit_cost,0) - COALESCE(OLD.unit_cost,0));
    new_base := cur_stock;
  ELSE
    new_value := NULL; -- preço igual: mantém o custo médio
  END IF;

  IF NOT public.absorb_into_next_count(NEW.ingredient_id, NEW.purchased_at, COALESCE(NEW.quantity, 0)) THEN
    UPDATE public.ingredients
      SET current_stock = COALESCE(current_stock,0) + COALESCE(NEW.quantity, 0)
      WHERE id = NEW.ingredient_id;
  END IF;

  UPDATE public.ingredients
    SET avg_cost = CASE
          WHEN new_value IS NULL THEN avg_cost
          WHEN new_base > 0 AND new_value >= 0 THEN new_value / new_base
          ELSE NEW.unit_cost
        END,
        last_cost = NEW.unit_cost
    WHERE id = NEW.ingredient_id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_purchase_to_stock() FROM anon, authenticated, public;
