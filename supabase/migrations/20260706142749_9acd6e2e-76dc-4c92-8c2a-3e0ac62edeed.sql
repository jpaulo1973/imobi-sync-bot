ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tipo_imovel text,
  ADD COLUMN IF NOT EXISTS distrito text,
  ADD COLUMN IF NOT EXISTS freguesia text,
  ADD COLUMN IF NOT EXISTS area_util_m2 numeric,
  ADD COLUMN IF NOT EXISTS garagem boolean,
  ADD COLUMN IF NOT EXISTS elevador boolean,
  ADD COLUMN IF NOT EXISTS jardim boolean,
  ADD COLUMN IF NOT EXISTS piscina boolean;