
CREATE TABLE public.buyer_clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  finalidade public.finalidade_tipo NOT NULL DEFAULT 'venda',
  tipologia TEXT,
  zona TEXT,
  tipo_imovel TEXT,
  budget_min NUMERIC,
  budget_max NUMERIC,
  area_min NUMERIC,
  quartos_min INTEGER,
  andar_min INTEGER,
  garagem_obrigatoria BOOLEAN NOT NULL DEFAULT false,
  elevador_obrigatorio BOOLEAN NOT NULL DEFAULT false,
  notas TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.buyer_clients TO authenticated;
GRANT ALL ON public.buyer_clients TO service_role;
ALTER TABLE public.buyer_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own buyer_clients" ON public.buyer_clients FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_buyer_clients_updated BEFORE UPDATE ON public.buyer_clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.portal_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  url TEXT NOT NULL,
  portal TEXT,
  titulo TEXT,
  finalidade public.finalidade_tipo NOT NULL DEFAULT 'venda',
  preco NUMERIC,
  preco_anterior NUMERIC,
  tipologia TEXT,
  zona TEXT,
  concelho TEXT,
  tipo_imovel TEXT,
  area_m2 NUMERIC,
  quartos INTEGER,
  casas_banho INTEGER,
  andar INTEGER,
  tem_garagem BOOLEAN,
  tem_elevador BOOLEAN,
  descricao TEXT,
  imagem_url TEXT,
  raw_extract JSONB,
  ultima_verificacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, url)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_listings TO authenticated;
GRANT ALL ON public.portal_listings TO service_role;
ALTER TABLE public.portal_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own portal_listings" ON public.portal_listings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_portal_listings_updated BEFORE UPDATE ON public.portal_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
