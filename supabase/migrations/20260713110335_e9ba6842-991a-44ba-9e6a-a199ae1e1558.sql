
-- Release 1.3: match_states + app_settings

-- 1. match_states: estado por par imóvel↔comprador
CREATE TABLE public.match_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  buyer_source text NOT NULL CHECK (buyer_source IN ('cliente','search')),
  buyer_ref uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('novo','contactado','nao_interessado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, buyer_source, buyer_ref)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_states TO authenticated;
GRANT ALL ON public.match_states TO service_role;

ALTER TABLE public.match_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_states_owner_all"
ON public.match_states
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER match_states_updated_at
BEFORE UPDATE ON public.match_states
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_match_states_property ON public.match_states(property_id);
CREATE INDEX idx_match_states_user ON public.match_states(user_id);

-- 2. app_settings: singleton key/value para configurações globais (modo manutenção)
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_read_all_auth"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "app_settings_admin_insert"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "app_settings_admin_update"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "app_settings_admin_delete"
ON public.app_settings
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (key, value)
VALUES ('maintenance', '{"enabled": false, "message": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
