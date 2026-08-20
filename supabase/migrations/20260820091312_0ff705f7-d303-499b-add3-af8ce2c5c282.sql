CREATE TABLE public.import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  batch_key text NOT NULL,
  origem text NOT NULL,
  filename text,
  times_seen integer NOT NULL DEFAULT 1,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, batch_key)
);

GRANT SELECT ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_batches_select_own" ON public.import_batches
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.active_searches
  ADD COLUMN IF NOT EXISTS renewed_by_batch_key text,
  ADD COLUMN IF NOT EXISTS renewed_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.import_batch_register(p_batch_key text, p_origem text, p_filename text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_inserted boolean;
BEGIN
  PERFORM public.assert_active_caller();
  v_key := NULLIF(btrim(COALESCE(p_batch_key, '')), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'batch_key obrigatório';
  END IF;

  INSERT INTO public.import_batches (user_id, batch_key, origem, filename)
  VALUES (auth.uid(), v_key, COALESCE(NULLIF(btrim(p_origem), ''), 'excel'), NULLIF(btrim(p_filename), ''))
  ON CONFLICT (user_id, batch_key) DO UPDATE
    SET times_seen = public.import_batches.times_seen + 1,
        last_seen_at = now()
  RETURNING (xmax = 0) INTO v_inserted;

  RETURN COALESCE(v_inserted, false);
END;
$$;
