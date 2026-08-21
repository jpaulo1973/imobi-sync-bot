CREATE OR REPLACE FUNCTION public.admin_delete_search(p_id uuid, p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_notif integer := 0;
  v_estados integer := 0;
  v_opps integer := 0;
  v_apagada integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;

  SELECT s.id, s.origem, COALESCE(s.contact_nome, s.consultor_nome) AS nome
    INTO v_row
  FROM public.active_searches s
  WHERE s.id = p_id;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'aplicado', COALESCE(p_apply, false),
      'encontrada', false,
      'nome', NULL,
      'origem', NULL,
      'notificacoes_removidas', 0,
      'estados_removidos', 0,
      'oportunidades_removidas', 0,
      'apagada', 0
    );
  END IF;

  SELECT count(*) INTO v_notif
  FROM public.match_notifications n
  WHERE n.buyer_source = 'search' AND n.buyer_ref = p_id;

  SELECT count(*) INTO v_estados
  FROM public.match_states m
  WHERE m.buyer_source = 'search' AND m.buyer_ref = p_id;

  SELECT count(*) INTO v_opps
  FROM public.match_opportunities o
  WHERE o.active_search_id = p_id;

  IF COALESCE(p_apply, false) THEN
    DELETE FROM public.match_notifications n
    WHERE n.buyer_source = 'search' AND n.buyer_ref = p_id;

    DELETE FROM public.match_states m
    WHERE m.buyer_source = 'search' AND m.buyer_ref = p_id;

    DELETE FROM public.match_opportunities o
    WHERE o.active_search_id = p_id;

    DELETE FROM public.active_searches s WHERE s.id = p_id;
    GET DIAGNOSTICS v_apagada = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', COALESCE(p_apply, false),
    'encontrada', true,
    'nome', v_row.nome,
    'origem', v_row.origem,
    'notificacoes_removidas', v_notif,
    'estados_removidos', v_estados,
    'oportunidades_removidas', v_opps,
    'apagada', v_apagada
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_delete_search(uuid, boolean) TO authenticated;