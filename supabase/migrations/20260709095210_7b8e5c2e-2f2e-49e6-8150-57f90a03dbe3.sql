-- Release 1.2 — Base Global + metadados de oportunidade

-- 1) Metadados de contexto em active_searches
ALTER TABLE public.active_searches
  ADD COLUMN IF NOT EXISTS consultor_nome text,
  ADD COLUMN IF NOT EXISTS consultor_telefone text,
  ADD COLUMN IF NOT EXISTS data_origem date,
  ADD COLUMN IF NOT EXISTS hora_origem time,
  ADD COLUMN IF NOT EXISTS grupo_whatsapp text,
  ADD COLUMN IF NOT EXISTS comunidade text;

-- 2) RLS: active_searches passa a Base Global — só admin ou proprietário podem gerir/ler
DROP POLICY IF EXISTS "Users manage own active_searches" ON public.active_searches;
CREATE POLICY "active_searches: admin or owner select"
  ON public.active_searches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);
CREATE POLICY "active_searches: admin or owner insert"
  ON public.active_searches FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);
CREATE POLICY "active_searches: admin or owner update"
  ON public.active_searches FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id)
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);
CREATE POLICY "active_searches: admin or owner delete"
  ON public.active_searches FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);
