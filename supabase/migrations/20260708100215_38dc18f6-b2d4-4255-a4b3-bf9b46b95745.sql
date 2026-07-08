
CREATE TABLE public.active_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  criteria jsonb NOT NULL,
  resumo text,
  texto_original text,
  contact_nome text,
  contact_telefone text,
  contact_grupo text,
  data_publicacao timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_active_searches_user ON public.active_searches(user_id);
CREATE INDEX idx_active_searches_expires ON public.active_searches(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_searches TO authenticated;
GRANT ALL ON public.active_searches TO service_role;

ALTER TABLE public.active_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own active_searches" ON public.active_searches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
