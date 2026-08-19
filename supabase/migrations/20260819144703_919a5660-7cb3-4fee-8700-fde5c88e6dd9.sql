CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_normalizado text NOT NULL,
  nome_display text,
  telefone text NOT NULL,
  email text,
  agency text,
  origem text NOT NULL DEFAULT 'import',
  times_seen integer NOT NULL DEFAULT 1,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, nome_normalizado, telefone)
);

CREATE INDEX contacts_user_nome_idx ON public.contacts (user_id, nome_normalizado);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_own_all" ON public.contacts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "contacts_admin_select" ON public.contacts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.contacts_normalize_name(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    btrim(regexp_replace(
      lower(translate(coalesce(raw, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
      '[^a-z0-9]+', ' ', 'g')),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.contacts_upsert(
  p_nome text,
  p_telefone text,
  p_email text DEFAULT NULL,
  p_agency text DEFAULT NULL,
  p_origem text DEFAULT 'import'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_tel text;
  v_id uuid;
BEGIN
  PERFORM public.assert_active_caller();
  v_key := public.contacts_normalize_name(p_nome);
  v_tel := public.normalize_phone_pt(p_telefone);
  IF v_key IS NULL OR v_tel IS NULL OR length(v_tel) < 9 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.contacts (user_id, nome_normalizado, nome_display, telefone, email, agency, origem)
  VALUES (auth.uid(), v_key, NULLIF(btrim(p_nome), ''), v_tel, NULLIF(btrim(p_email), ''), NULLIF(btrim(p_agency), ''), coalesce(NULLIF(btrim(p_origem), ''), 'import'))
  ON CONFLICT (user_id, nome_normalizado, telefone) DO UPDATE
    SET times_seen = contacts.times_seen + 1,
        last_seen_at = now(),
        nome_display = COALESCE(EXCLUDED.nome_display, contacts.nome_display),
        email = COALESCE(EXCLUDED.email, contacts.email),
        agency = COALESCE(EXCLUDED.agency, contacts.agency),
        origem = EXCLUDED.origem
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_lookup(p_nomes text[])
RETURNS TABLE(nome_normalizado text, nome_display text, telefone text, email text, agency text, times_seen integer, last_seen_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keys text[];
BEGIN
  PERFORM public.assert_active_caller();
  SELECT array_agg(DISTINCT k) INTO v_keys
  FROM (
    SELECT public.contacts_normalize_name(n) AS k
    FROM unnest(coalesce(p_nomes, '{}'::text[])) AS n
  ) s
  WHERE k IS NOT NULL;

  IF v_keys IS NULL OR array_length(v_keys, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.nome_normalizado, c.nome_display, c.telefone, c.email, c.agency, c.times_seen, c.last_seen_at
  FROM public.contacts c
  WHERE c.user_id = auth.uid()
    AND c.nome_normalizado = ANY(v_keys)
  ORDER BY c.times_seen DESC, c.last_seen_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contacts_upsert(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_lookup(text[]) TO authenticated;