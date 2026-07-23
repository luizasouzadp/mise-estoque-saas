
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS invoice_image_paths text[];
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS receipt_image_paths text[];
