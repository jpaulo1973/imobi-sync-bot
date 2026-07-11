
-- Release 1.2 — Motor Geo Funcional + Proximidade

-- 1. Tabela functional_zones
CREATE TABLE public.functional_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  coverage jsonb NOT NULL DEFAULT '{"freguesias": [], "municipios": []}'::jsonb,
  approved boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.functional_zones TO authenticated;
GRANT ALL ON public.functional_zones TO service_role;

ALTER TABLE public.functional_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read functional_zones"
  ON public.functional_zones FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins insert functional_zones"
  ON public.functional_zones FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update functional_zones"
  ON public.functional_zones FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete functional_zones"
  ON public.functional_zones FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER functional_zones_updated_at
  BEFORE UPDATE ON public.functional_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX functional_zones_aliases_gin ON public.functional_zones USING gin (aliases);

-- 2. Proximity nos existentes
ALTER TABLE public.active_searches ADD COLUMN IF NOT EXISTS proximity jsonb;
ALTER TABLE public.buyer_clients   ADD COLUMN IF NOT EXISTS proximity jsonb;

-- 3. Seed inicial (zonas funcionais mais comuns)
INSERT INTO public.functional_zones (nome, aliases, coverage, approved) VALUES
  ('Grande Lisboa',
    ARRAY['grande lisboa','area metropolitana de lisboa','aml'],
    '{"freguesias": [], "municipios": ["lisboa","oeiras","cascais","amadora","odivelas","loures","sintra","mafra","vila franca de xira"]}'::jsonb,
    true),
  ('Margem Sul',
    ARRAY['margem sul','margem sul do tejo','outra banda'],
    '{"freguesias": [], "municipios": ["almada","seixal","barreiro","moita","montijo","alcochete","sesimbra","palmela","setubal"]}'::jsonb,
    true),
  ('Linha de Cascais',
    ARRAY['linha de cascais','linha cascais'],
    '{"freguesias": ["alges","cruz quebrada","dafundo","caxias","paco de arcos","oeiras","carcavelos","parede","sao pedro do estoril","estoril","cascais","monte estoril"], "municipios": []}'::jsonb,
    true),
  ('Linha de Sintra',
    ARRAY['linha de sintra','linha sintra'],
    '{"freguesias": ["benfica","amadora","reboleira","damaia","agualva","cacem","mira sintra","rio de mouro","algueirao mem martins","portela de sintra","sintra"], "municipios": []}'::jsonb,
    true),
  ('Expo / Parque das Nações',
    ARRAY['expo','parque das nacoes','parque das nações','parque nacoes'],
    '{"freguesias": ["parque das nacoes","moscavide","sacavem","olivais"], "municipios": []}'::jsonb,
    true),
  ('Baixa de Lisboa',
    ARRAY['baixa','baixa de lisboa','baixa-chiado','chiado'],
    '{"freguesias": ["santa maria maior","misericordia","santo antonio"], "municipios": []}'::jsonb,
    true),
  ('Zona Ribeirinha',
    ARRAY['zona ribeirinha','ribeirinha','ribeirinha lisboa'],
    '{"freguesias": ["belem","alcantara","misericordia","santa maria maior","sao vicente","beato","marvila"], "municipios": []}'::jsonb,
    true),
  ('Grande Porto',
    ARRAY['grande porto','area metropolitana do porto','amp'],
    '{"freguesias": [], "municipios": ["porto","matosinhos","vila nova de gaia","gondomar","maia","valongo","vila do conde","povoa de varzim"]}'::jsonb,
    true),
  ('Costa da Caparica',
    ARRAY['caparica','costa da caparica','costa caparica'],
    '{"freguesias": ["costa","caparica","trafaria"], "municipios": []}'::jsonb,
    true),
  ('Oeste',
    ARRAY['oeste','regiao oeste','região oeste'],
    '{"freguesias": [], "municipios": ["torres vedras","lourinha","peniche","caldas da rainha","obidos","alcobaca","nazare","mafra"]}'::jsonb,
    true)
ON CONFLICT (nome) DO NOTHING;
