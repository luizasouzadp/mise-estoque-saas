-- Telefone/WhatsApp do fornecedor, usado para puxar o contato direto do
-- cadastro de fornecedores na lista de compras.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS phone TEXT;
