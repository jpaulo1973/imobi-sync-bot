-- "Remover utilizador": apaga todos os dados e o perfil, o que retira o acesso
-- à aplicação (sem perfil ativo não há acesso) e remove-o da lista de contas.
CREATE OR REPLACE FUNCTION public.admin_purge_user_data(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  DELETE FROM public.profiles WHERE id = p_user_id;
END;
$function$;