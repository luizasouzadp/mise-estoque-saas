
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS receipt_image_path text,
  ADD COLUMN IF NOT EXISTS receipt_notes text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS imported_purchase_ids uuid[];

-- Backfill existing received orders as skipped so they don't show up as pending.
UPDATE public.purchase_orders
  SET import_status = 'skipped'
  WHERE status = 'received' AND receipt_image_path IS NULL AND import_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_purchase_orders_receipt
  ON public.purchase_orders (receipt_image_path)
  WHERE receipt_image_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_import_status
  ON public.purchase_orders (restaurant_id, import_status);
