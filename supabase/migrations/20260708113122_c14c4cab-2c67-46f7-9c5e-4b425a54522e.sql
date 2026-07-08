-- Remover unicidade fixa por (user_id, dedup_key) — passa a ser apenas hint
DROP INDEX IF EXISTS public.uniq_active_searches_user_dedup;

ALTER TABLE public.active_searches
  ADD COLUMN IF NOT EXISTS similarity_score NUMERIC,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merged_from_count INTEGER NOT NULL DEFAULT 0;

-- Índice para acelerar candidate-lookup por telefone (dentro do user)
CREATE INDEX IF NOT EXISTS idx_active_searches_user_phone
  ON public.active_searches (user_id, contact_telefone)
  WHERE contact_telefone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_active_searches_flagged
  ON public.active_searches (user_id, flagged_for_review)
  WHERE flagged_for_review = true;