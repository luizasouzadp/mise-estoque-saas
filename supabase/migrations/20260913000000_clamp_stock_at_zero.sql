-- Impede que o estoque de um insumo fique negativo: qualquer ajuste
-- (compra, produção, movimentação manual) que levaria o estoque abaixo de
-- zero agora é limitado a zero, em vez de deixar o valor negativo.
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
  IF TG_OP IN ('UPDATE','DELETE') THEN
    old_delta := CASE WHEN OLD.type = 'in' THEN OLD.quantity ELSE -OLD.quantity END;
    UPDATE public.ingredients
      SET current_stock = GREATEST(0, COALESCE(current_stock,0) - old_delta)
      WHERE id = OLD.ingredient_id;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    new_delta := CASE WHEN NEW.type = 'in' THEN NEW.quantity ELSE -NEW.quantity END;
    UPDATE public.ingredients
      SET current_stock = GREATEST(0, COALESCE(current_stock,0) + new_delta),
          last_cost = CASE WHEN NEW.type = 'in' AND NEW.unit_cost IS NOT NULL THEN NEW.unit_cost ELSE last_cost END
      WHERE id = NEW.ingredient_id;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

-- Mesma trava para compras (entrada de estoque) — aqui nunca reduz estoque,
-- mas mantém o padrão de nunca deixar o valor negativo por segurança.
CREATE OR REPLACE FUNCTION public.apply_purchase_to_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_stock numeric;
  cur_avg numeric;
  new_stock numeric;
  new_avg numeric;
BEGIN
  SELECT current_stock, avg_cost INTO cur_stock, cur_avg
    FROM public.ingredients WHERE id = new.ingredient_id;

  new_stock := GREATEST(0, COALESCE(cur_stock,0) + new.quantity);
  IF new_stock > 0 THEN
    new_avg := ((COALESCE(cur_stock,0) * COALESCE(cur_avg,0)) + (new.quantity * new.unit_cost)) / new_stock;
  ELSE
    new_avg := new.unit_cost;
  END IF;

  UPDATE public.ingredients
    SET current_stock = new_stock,
        avg_cost = new_avg,
        last_cost = new.unit_cost
    WHERE id = new.ingredient_id;
  RETURN new;
END;
$$;

-- Corrige qualquer estoque já negativo hoje.
UPDATE public.ingredients SET current_stock = 0 WHERE current_stock < 0;
