-- Contagem de inventário fica fixa.
-- Quando uma movimentação (manual, produção ou compra) com data ANTERIOR a
-- uma contagem é criada, editada ou excluída, a diferença é absorvida pelo
-- ajuste da primeira contagem seguinte daquele insumo. Assim o valor contado
-- não muda e as movimentações posteriores (e o estoque atual) ficam intactas.
-- Sem contagem posterior, o estoque muda normalmente.

-- Ajustes de inventário podem ter quantidade 0 (contagem bateu com o sistema),
-- para servirem de "âncora" para correções futuras.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_quantity_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_quantity_check
  CHECK (quantity > 0 OR (quantity = 0 AND reason ILIKE 'Inventário%'));

-- p_delta: mudança no estoque no momento p_at (positivo = mais estoque).
-- Retorna true se havia contagem posterior e ela absorveu a mudança.
CREATE OR REPLACE FUNCTION public.absorb_into_next_count(p_ingredient uuid, p_at timestamptz, p_delta numeric)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  new_signed numeric;
BEGIN
  SELECT id, type, quantity INTO inv
    FROM public.stock_movements
    WHERE ingredient_id = p_ingredient
      AND reason ILIKE 'Inventário%'
      AND occurred_at > p_at
    ORDER BY occurred_at ASC, created_at ASC
    LIMIT 1
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF COALESCE(p_delta, 0) = 0 THEN
    RETURN true;
  END IF;

  new_signed := (CASE WHEN inv.type = 'in' THEN inv.quantity ELSE -inv.quantity END) - p_delta;

  -- O ajuste muda só para compensar: o estoque atual não deve mudar.
  PERFORM set_config('mise.skip_stock_apply', 'on', true);
  UPDATE public.stock_movements
    SET type = CASE WHEN new_signed >= 0 THEN 'in' ELSE 'out' END,
        quantity = abs(new_signed)
    WHERE id = inv.id;
  PERFORM set_config('mise.skip_stock_apply', 'off', true);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.absorb_into_next_count(uuid, timestamptz, numeric) FROM anon, authenticated, public;

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
        SET current_stock = GREATEST(0, COALESCE(current_stock,0) - old_delta)
        WHERE id = OLD.ingredient_id;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') THEN
    new_delta := CASE WHEN NEW.type = 'in' THEN NEW.quantity ELSE -NEW.quantity END;
    IF COALESCE(NEW.reason, '') ILIKE 'Inventário%'
       OR NOT public.absorb_into_next_count(NEW.ingredient_id, NEW.occurred_at, new_delta) THEN
      UPDATE public.ingredients
        SET current_stock = GREATEST(0, COALESCE(current_stock,0) + new_delta)
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

-- Compras: mesma regra. Também corrige editar/excluir compra — a versão
-- anterior somava a quantidade de novo a cada edição e não revertia na exclusão.
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
  -- Estoque e custo médio antes de qualquer alteração desta compra.
  IF TG_OP <> 'DELETE' THEN
    SELECT COALESCE(current_stock,0), COALESCE(avg_cost,0) INTO cur_stock, cur_avg
      FROM public.ingredients WHERE id = NEW.ingredient_id;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF NOT public.absorb_into_next_count(OLD.ingredient_id, OLD.purchased_at, -COALESCE(OLD.quantity, 0)) THEN
      UPDATE public.ingredients
        SET current_stock = GREATEST(0, COALESCE(current_stock,0) - COALESCE(OLD.quantity, 0))
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
      SET current_stock = GREATEST(0, COALESCE(current_stock,0) + COALESCE(NEW.quantity, 0))
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
