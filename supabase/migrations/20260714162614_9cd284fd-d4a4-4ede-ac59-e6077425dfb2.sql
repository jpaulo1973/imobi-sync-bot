
CREATE TABLE public.geo_library_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.geo_library_version TO authenticated;
GRANT ALL ON public.geo_library_version TO service_role;

ALTER TABLE public.geo_library_version ENABLE ROW LEVEL SECURITY;

CREATE POLICY "geo_library_version_select_authenticated"
  ON public.geo_library_version FOR SELECT TO authenticated USING (true);

CREATE POLICY "geo_library_version_insert_admin"
  ON public.geo_library_version FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "geo_library_version_update_admin"
  ON public.geo_library_version FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "geo_library_version_delete_admin"
  ON public.geo_library_version FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.geo_library_version (version, notes)
VALUES (1, 'Versão inicial da biblioteca geográfica.');

ALTER TABLE public.properties      ADD COLUMN IF NOT EXISTS geo_library_version integer;
ALTER TABLE public.buyer_clients   ADD COLUMN IF NOT EXISTS geo_library_version integer;
ALTER TABLE public.active_searches ADD COLUMN IF NOT EXISTS geo_library_version integer;
