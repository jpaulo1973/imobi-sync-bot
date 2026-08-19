CREATE OR REPLACE FUNCTION public.contacts_backfill_apply(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec jsonb;
  v_inserted boolean;
  v_new integer := 0;
  v_reinforced integer := 0;
  v_skipped integer := 0;
  v_key text;
  v_tel text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_key := public.contacts_normalize_name(rec->>'nome_display');
    IF v_key IS NULL THEN
      v_key := NULLIF(btrim(COALESCE(rec->>'nome_normalizado', '')), '');
    END IF;
    v_tel := public.normalize_phone_pt(rec->>'telefone');

    IF v_key IS NULL OR v_tel IS NULL OR length(v_tel) < 9 OR (rec->>'user_id') IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.contacts (
      user_id, nome_normalizado, nome_display, telefone, email, agency, origem,
      times_seen, last_seen_at
    )
    VALUES (
      (rec->>'user_id')::uuid,
      v_key,
      NULLIF(btrim(COALESCE(rec->>'nome_display', '')), ''),
      v_tel,
      NULLIF(btrim(COALESCE(rec->>'email', '')), ''),
      NULL,
      'backfill',
      GREATEST(COALESCE((rec->>'times_seen')::integer, 1), 1),
      COALESCE((rec->>'last_seen_at')::timestamptz, now())
    )
    ON CONFLICT (user_id, nome_normalizado, telefone) DO UPDATE
      SET times_seen = GREATEST(public.contacts.times_seen, EXCLUDED.times_seen),
          last_seen_at = GREATEST(public.contacts.last_seen_at, EXCLUDED.last_seen_at),
          nome_display = COALESCE(public.contacts.nome_display, EXCLUDED.nome_display),
          email = COALESCE(public.contacts.email, EXCLUDED.email)
    RETURNING (xmax = 0) INTO v_inserted;

    IF v_inserted THEN
      v_new := v_new + 1;
    ELSE
      v_reinforced := v_reinforced + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('semeados', v_new, 'reforcados', v_reinforced, 'ignorados', v_skipped);
END;
$function$;