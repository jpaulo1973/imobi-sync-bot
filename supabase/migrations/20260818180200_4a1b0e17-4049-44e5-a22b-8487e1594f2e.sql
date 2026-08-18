ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS estado text;

ALTER TABLE public.buyer_clients
  ADD COLUMN IF NOT EXISTS categorias text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS budget_max_obras numeric,
  ADD COLUMN IF NOT EXISTS budget_max_pronto numeric,
  ADD COLUMN IF NOT EXISTS estado_desejado text;