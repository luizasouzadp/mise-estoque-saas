-- Also link the supplier when a purchase's supplier is changed on edit.
DROP TRIGGER IF EXISTS trg_link_supplier_from_purchase ON public.purchases;
CREATE TRIGGER trg_link_supplier_from_purchase
  AFTER INSERT OR UPDATE OF supplier ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.link_supplier_from_purchase();
