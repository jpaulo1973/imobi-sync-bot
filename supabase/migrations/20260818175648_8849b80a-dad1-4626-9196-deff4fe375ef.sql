ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aberto',
  ADD COLUMN IF NOT EXISTS arquivado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

CREATE TABLE IF NOT EXISTS public.support_replies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.support_requests(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  mensagem text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_replies_request_idx ON public.support_replies(request_id);

GRANT SELECT, INSERT ON public.support_replies TO authenticated;
GRANT ALL ON public.support_replies TO service_role;

ALTER TABLE public.support_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_replies_select_own_or_admin ON public.support_replies;
CREATE POLICY support_replies_select_own_or_admin ON public.support_replies
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.support_requests r
      WHERE r.id = support_replies.request_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_replies_insert_admin ON public.support_replies;
CREATE POLICY support_replies_insert_admin ON public.support_replies
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND author_id = auth.uid());