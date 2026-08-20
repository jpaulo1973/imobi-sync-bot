DROP FUNCTION IF EXISTS public.import_batch_register(text, text, text);

CREATE OR REPLACE FUNCTION public.import_batch_register(p_batch_key text, p_origem text, p_filename text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_times integer;
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
  RETURNING times_seen INTO v_times;

  RETURN COALESCE(v_times, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.import_batch_register(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_batch_register(text, text, text) TO authenticated;