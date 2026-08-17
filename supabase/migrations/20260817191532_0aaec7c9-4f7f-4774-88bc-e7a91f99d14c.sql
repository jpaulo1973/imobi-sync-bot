-- Admin pode ver/corrigir imóveis de todos (ferramentas de manutenção/backfill)
DROP POLICY IF EXISTS "Admins read all properties" ON public.properties;
CREATE POLICY "Admins read all properties" ON public.properties
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins update all properties" ON public.properties;
CREATE POLICY "Admins update all properties" ON public.properties
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage all match_opportunities" ON public.match_opportunities;
CREATE POLICY "Admins manage all match_opportunities" ON public.match_opportunities
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage all match_notifications" ON public.match_notifications;
CREATE POLICY "Admins manage all match_notifications" ON public.match_notifications
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Aprendizagem de aliases (qualquer consultor pode reforçar um alias aprovado)
CREATE OR REPLACE FUNCTION public.upsert_location_alias(
  p_alias text, p_ids uuid[], p_origem text DEFAULT 'revisao'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT id INTO v_id FROM public.location_aliases WHERE alias_normalizado = p_alias;
  IF v_id IS NULL THEN
    INSERT INTO public.location_aliases (alias_normalizado, location_ids, origem, aprovado, created_by)
    VALUES (p_alias, p_ids, p_origem, true, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.location_aliases
    SET location_ids = p_ids, aprovado = true, origem = p_origem
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Administração de utilizadores
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid, email text, full_name text, agency text, telefone text,
  created_at timestamptz, ativo boolean, roles text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.agency, p.telefone, p.created_at, p.ativo,
         COALESCE(array_agg(r.role::text) FILTER (WHERE r.role IS NOT NULL), '{}'::text[])
  FROM public.profiles p
  LEFT JOIN public.user_roles r ON r.user_id = p.id
  GROUP BY p.id, p.email, p.full_name, p.agency, p.telefone, p.created_at, p.ativo
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id uuid, p_role app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  IF p_user_id = auth.uid() AND p_role <> 'admin' THEN
    RAISE EXCEPTION 'Não pode remover as suas próprias permissões de administrador.';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_user_data(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não pode remover a sua própria conta.';
  END IF;
  DELETE FROM public.match_notifications WHERE user_id = p_user_id;
  DELETE FROM public.match_states WHERE user_id = p_user_id;
  DELETE FROM public.match_opportunities WHERE user_id = p_user_id;
  DELETE FROM public.active_searches WHERE user_id = p_user_id;
  DELETE FROM public.buyer_clients WHERE user_id = p_user_id;
  DELETE FROM public.portal_listings WHERE user_id = p_user_id;
  DELETE FROM public.properties WHERE user_id = p_user_id;
  DELETE FROM public.support_requests WHERE user_id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  UPDATE public.profiles SET ativo = false WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_location_alias(text, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_location_alias(text, uuid[], text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_location_alias(text, uuid[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) TO authenticated, service_role;