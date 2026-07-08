
ALTER TABLE public.active_searches
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_match_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matches_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_batch_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_searches_user_dedup
  ON public.active_searches (user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_active_searches_batch
  ON public.active_searches (user_id, origem, import_batch_id);

DROP TRIGGER IF EXISTS trg_active_searches_updated_at ON public.active_searches;
CREATE TRIGGER trg_active_searches_updated_at
  BEFORE UPDATE ON public.active_searches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
