-- 1. profiles.email + sync
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE u.id = p.id AND p.email IS DISTINCT FROM u.email;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$function$;

-- 2. Admins gerem todos os perfis
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
CREATE POLICY "Admins read all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update all profiles" ON public.profiles;
CREATE POLICY "Admins update all profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Bolsa global de imóveis ativos
CREATE OR REPLACE FUNCTION public.pool_properties()
RETURNS SETOF public.properties
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.properties WHERE ativo = true;
$$;

-- 4. Bolsa global de procuras ativas (contactos do lead mascarados p/ terceiros)
CREATE OR REPLACE FUNCTION public.pool_active_searches(p_include_expired boolean DEFAULT false)
RETURNS SETOF public.active_searches
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r public.active_searches;
  is_admin boolean := public.has_role(auth.uid(), 'admin');
BEGIN
  FOR r IN
    SELECT * FROM public.active_searches
    WHERE p_include_expired OR expires_at > now()
  LOOP
    IF NOT (is_admin OR r.user_id = auth.uid()) THEN
      r.contact_telefone := NULL;
      r.contact_email := NULL;
    END IF;
    RETURN NEXT r;
  END LOOP;
END;
$$;

-- 5. Diretório de consultores
CREATE OR REPLACE FUNCTION public.consultor_directory()
RETURNS TABLE (id uuid, full_name text, agency text, telefone text, whatsapp text, email text, ativo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.agency, p.telefone, p.whatsapp, p.email, p.ativo
  FROM public.profiles p;
$$;

-- 6. Oportunidades de match cross-user
CREATE OR REPLACE FUNCTION public.list_match_opportunities(p_search_ids uuid[])
RETURNS TABLE (id uuid, user_id uuid, property_id uuid, active_search_id uuid, score integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT o.id, o.user_id, o.property_id, o.active_search_id, o.score
  FROM public.match_opportunities o
  WHERE o.active_search_id = ANY(p_search_ids);
$$;

CREATE OR REPLACE FUNCTION public.apply_match_opportunities(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  rec jsonb;
  existing_id uuid;
  existing_score integer;
  inserted integer := 0;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    SELECT o.id, o.score INTO existing_id, existing_score
    FROM public.match_opportunities o
    WHERE o.active_search_id = (rec->>'active_search_id')::uuid
      AND o.property_id = (rec->>'property_id')::uuid
    ORDER BY o.score DESC
    LIMIT 1;

    IF existing_id IS NULL THEN
      INSERT INTO public.match_opportunities
        (user_id, property_id, active_search_id, score, reasons, categories)
      VALUES (
        (rec->>'user_id')::uuid,
        (rec->>'property_id')::uuid,
        (rec->>'active_search_id')::uuid,
        (rec->>'score')::integer,
        rec->'reasons',
        rec->'categories'
      );
      inserted := inserted + 1;
    ELSIF existing_score IS DISTINCT FROM (rec->>'score')::integer THEN
      UPDATE public.match_opportunities
      SET score = (rec->>'score')::integer,
          reasons = rec->'reasons',
          categories = rec->'categories',
          viewed_at = NULL
      WHERE id = existing_id;
    END IF;
  END LOOP;
  RETURN inserted;
END;
$$;

-- 7. Notificações cross-user
CREATE OR REPLACE FUNCTION public.insert_match_notifications(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  rec jsonb;
  inserted integer := 0;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.match_notifications n
      WHERE n.user_id = (rec->>'user_id')::uuid
        AND n.pair_key = rec->>'pair_key'
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.match_notifications
      (user_id, pair_key, buyer_source, buyer_ref, property_id, buyer_label, property_label, score, reason_summary)
    VALUES (
      (rec->>'user_id')::uuid,
      rec->>'pair_key',
      rec->>'buyer_source',
      (rec->>'buyer_ref')::uuid,
      (rec->>'property_id')::uuid,
      rec->>'buyer_label',
      rec->>'property_label',
      COALESCE((rec->>'score')::integer, 0),
      rec->>'reason_summary'
    );
    inserted := inserted + 1;
  END LOOP;
  RETURN inserted;
END;
$$;

-- 8. Contador de utilização de aliases
CREATE OR REPLACE FUNCTION public.touch_location_alias(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.location_aliases
  SET times_used = times_used + 1, last_used_at = now()
  WHERE id = p_id;
$$;

-- Permissões: apenas utilizadores autenticados
REVOKE ALL ON FUNCTION public.pool_properties() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pool_active_searches(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consultor_directory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_match_opportunities(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_match_opportunities(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_match_notifications(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_location_alias(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pool_properties() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pool_active_searches(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consultor_directory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_match_opportunities(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_match_opportunities(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_match_notifications(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_location_alias(uuid) TO authenticated, service_role;