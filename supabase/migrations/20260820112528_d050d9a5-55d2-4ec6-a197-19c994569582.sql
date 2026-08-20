CREATE OR REPLACE FUNCTION public.admin_merge_duplicate_group(
  p_keep_id uuid,
  p_remove_ids uuid[],
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_keep record;
  v_remover integer := 0;
  v_opps integer := 0;
  v_notif integer := 0;
  v_estados integer := 0;
  v_apagadas integer := 0;
  v_amostra jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;

  SELECT s.id, s.user_id, s.contact_nome, s.consultor_nome, s.origem, s.merged_from_count
    INTO v_keep
  FROM public.active_searches s
  WHERE s.id = p_keep_id;

  IF v_keep.id IS NULL THEN
    RAISE EXCEPTION 'Procura a manter não encontrada.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), '{}'::uuid[]) INTO v_ids
  FROM unnest(COALESCE(p_remove_ids, '{}'::uuid[])) AS x
  WHERE x IS DISTINCT FROM p_keep_id
    AND EXISTS (SELECT 1 FROM public.active_searches s WHERE s.id = x);

  v_remover := COALESCE(array_length(v_ids, 1), 0);

  SELECT count(*) INTO v_opps
  FROM public.match_opportunities o WHERE o.active_search_id = ANY(v_ids);

  SELECT count(*) INTO v_notif
  FROM public.match_notifications n
  WHERE n.buyer_source = 'search' AND n.buyer_ref = ANY(v_ids);

  SELECT count(*) INTO v_estados
  FROM public.match_states m
  WHERE m.buyer_source = 'search' AND m.buyer_ref = ANY(v_ids);

  SELECT COALESCE(jsonb_agg(a.x ORDER BY a.created_at), '[]'::jsonb) INTO v_amostra FROM (
    SELECT s.created_at,
           jsonb_build_object(
             'id', s.id,
             'nome', COALESCE(s.contact_nome, s.consultor_nome),
             'origem', s.origem,
             'criada_em', to_char(s.created_at, 'YYYY-MM-DD'),
             'oportunidades', (SELECT count(*) FROM public.match_opportunities o WHERE o.active_search_id = s.id),
             'notificacoes', (SELECT count(*) FROM public.match_notifications n WHERE n.buyer_source = 'search' AND n.buyer_ref = s.id),
             'estados', (SELECT count(*) FROM public.match_states m WHERE m.buyer_source = 'search' AND m.buyer_ref = s.id)
           ) AS x
    FROM public.active_searches s
    WHERE s.id = ANY(v_ids)
    LIMIT 50
  ) a;

  IF p_apply AND v_remover > 0 THEN
    DELETE FROM public.match_notifications n
    WHERE n.buyer_source = 'search' AND n.buyer_ref = ANY(v_ids);

    DELETE FROM public.match_states m
    WHERE m.buyer_source = 'search' AND m.buyer_ref = ANY(v_ids);

    DELETE FROM public.match_opportunities o WHERE o.active_search_id = ANY(v_ids);

    DELETE FROM public.active_searches s WHERE s.id = ANY(v_ids);
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;

    UPDATE public.active_searches
    SET merged_from_count = COALESCE(merged_from_count, 0) + v_apagadas,
        flagged_for_review = false
    WHERE id = p_keep_id;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', COALESCE(p_apply, false),
    'mantida', jsonb_build_object(
      'id', v_keep.id,
      'user_id', v_keep.user_id,
      'nome', COALESCE(v_keep.contact_nome, v_keep.consultor_nome),
      'origem', v_keep.origem
    ),
    'remover', v_remover,
    'apagadas', v_apagadas,
    'oportunidades_removidas', v_opps,
    'notificacoes_removidas', v_notif,
    'estados_removidos', v_estados,
    'amostra', COALESCE(v_amostra, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_merge_duplicate_group(uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_merge_duplicate_group(uuid, uuid[], boolean) TO authenticated, service_role;