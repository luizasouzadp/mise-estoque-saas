-- Marca se um contato de WhatsApp é fornecedor, para escolher a mensagem
-- automática certa ao enviar a lista de compras (pedido de encomenda vs.
-- aviso interno para um funcionário).
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS is_supplier BOOLEAN NOT NULL DEFAULT false;
