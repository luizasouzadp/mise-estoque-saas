-- Dias da semana em que o restaurante não abre (0=domingo … 6=sábado).
-- Nesses dias não há consumo: a lista de compras usa consumo por dia aberto.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS closed_weekdays INTEGER[] NOT NULL DEFAULT '{}'
    CHECK (closed_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);

-- Hangar fecha na segunda-feira.
UPDATE public.restaurants SET closed_weekdays = '{1}' WHERE name ILIKE '%hangar%';
