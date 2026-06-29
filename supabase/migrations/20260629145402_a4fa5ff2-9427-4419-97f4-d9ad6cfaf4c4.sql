
CREATE TYPE public.finalidade_tipo AS ENUM ('venda', 'arrendamento');

CREATE TABLE public.properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referencia TEXT,
  finalidade public.finalidade_tipo NOT NULL DEFAULT 'venda',
  tipologia TEXT NOT NULL,
  zona TEXT NOT NULL,
  concelho TEXT,
  preco NUMERIC(12,2) NOT NULL,
  area_m2 NUMERIC(8,2),
  quartos INTEGER,
  casas_banho INTEGER,
  descricao TEXT,
  caracteristicas TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own properties"
  ON public.properties FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_properties_updated
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_properties_user ON public.properties(user_id);
