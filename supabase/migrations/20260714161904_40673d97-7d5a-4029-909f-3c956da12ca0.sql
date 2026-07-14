
-- =========================================================
-- FASE A — Fundação de dados da inteligência geográfica
-- =========================================================

-- 1. Enums
DO $$ BEGIN
  CREATE TYPE public.location_type AS ENUM ('distrito','concelho','freguesia','zona_funcional');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.location_relation_type AS ENUM ('parent','child','adjacent','nearby','contains');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 2. locations
-- =========================================================
CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  tipo public.location_type NOT NULL,
  parent_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  aprovado boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_tipo ON public.locations(tipo);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON public.locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_nome_lower ON public.locations(lower(nome));

GRANT SELECT ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locations: authenticated read"
  ON public.locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "locations: admin write"
  ON public.locations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "locations: admin update"
  ON public.locations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "locations: admin delete"
  ON public.locations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 3. location_relations
-- =========================================================
CREATE TABLE IF NOT EXISTS public.location_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  to_location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  relation_type public.location_relation_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_location_id, to_location_id, relation_type),
  CHECK (from_location_id <> to_location_id)
);
CREATE INDEX IF NOT EXISTS idx_location_relations_from ON public.location_relations(from_location_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_location_relations_to   ON public.location_relations(to_location_id, relation_type);

GRANT SELECT ON public.location_relations TO authenticated;
GRANT ALL ON public.location_relations TO service_role;
ALTER TABLE public.location_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "location_relations: authenticated read"
  ON public.location_relations FOR SELECT TO authenticated USING (true);
CREATE POLICY "location_relations: admin write"
  ON public.location_relations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "location_relations: admin update"
  ON public.location_relations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "location_relations: admin delete"
  ON public.location_relations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================================
-- 4. functional_zone_members
-- =========================================================
CREATE TABLE IF NOT EXISTS public.functional_zone_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  functional_zone_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (functional_zone_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_fzm_zone ON public.functional_zone_members(functional_zone_id);
CREATE INDEX IF NOT EXISTS idx_fzm_loc  ON public.functional_zone_members(location_id);

GRANT SELECT ON public.functional_zone_members TO authenticated;
GRANT ALL ON public.functional_zone_members TO service_role;
ALTER TABLE public.functional_zone_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fzm: authenticated read"
  ON public.functional_zone_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "fzm: admin write"
  ON public.functional_zone_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "fzm: admin update"
  ON public.functional_zone_members FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "fzm: admin delete"
  ON public.functional_zone_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================================
-- 5. location_aliases
-- =========================================================
CREATE TABLE IF NOT EXISTS public.location_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_normalizado text NOT NULL,
  location_ids uuid[] NOT NULL,
  origem text NOT NULL DEFAULT 'manual',
  aprovado boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  times_used integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alias_normalizado)
);
CREATE INDEX IF NOT EXISTS idx_location_aliases_alias ON public.location_aliases(alias_normalizado);
CREATE INDEX IF NOT EXISTS idx_location_aliases_aprovado ON public.location_aliases(aprovado);

GRANT SELECT ON public.location_aliases TO authenticated;
GRANT ALL ON public.location_aliases TO service_role;
ALTER TABLE public.location_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "location_aliases: authenticated read"
  ON public.location_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "location_aliases: authenticated insert"
  ON public.location_aliases FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "location_aliases: owner or admin update"
  ON public.location_aliases FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR auth.uid() = created_by)
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR auth.uid() = created_by);
CREATE POLICY "location_aliases: admin delete"
  ON public.location_aliases FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_location_aliases_updated_at
  BEFORE UPDATE ON public.location_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 6. location_metadata
-- =========================================================
CREATE TABLE IF NOT EXISTS public.location_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE CASCADE,
  codigo_ine text,
  nuts text,
  latitude numeric,
  longitude numeric,
  centroide jsonb,
  bounding_box jsonb,
  populacao integer,
  area_km2 numeric,
  codigo_postal text,
  extras jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.location_metadata TO authenticated;
GRANT ALL ON public.location_metadata TO service_role;
ALTER TABLE public.location_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "location_metadata: authenticated read"
  ON public.location_metadata FOR SELECT TO authenticated USING (true);
CREATE POLICY "location_metadata: admin write"
  ON public.location_metadata FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "location_metadata: admin update"
  ON public.location_metadata FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "location_metadata: admin delete"
  ON public.location_metadata FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_location_metadata_updated_at
  BEFORE UPDATE ON public.location_metadata
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 7. Alterações a tabelas existentes
-- =========================================================

-- active_searches
ALTER TABLE public.active_searches
  ADD COLUMN IF NOT EXISTS location_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audit_geo jsonb,
  ADD COLUMN IF NOT EXISTS pending_geo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_active_searches_location_ids
  ON public.active_searches USING gin(location_ids);
CREATE INDEX IF NOT EXISTS idx_active_searches_pending_geo
  ON public.active_searches(user_id) WHERE pending_geo = true;

-- buyer_clients
ALTER TABLE public.buyer_clients
  ADD COLUMN IF NOT EXISTS location_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_buyer_clients_location_ids
  ON public.buyer_clients USING gin(location_ids);

-- properties
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_properties_location_id
  ON public.properties(location_id);
