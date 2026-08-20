CREATE OR REPLACE FUNCTION public.admin_purge_expired_searches(p_apply boolean DEFAULT false, p_dias integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dias integer := GREATEST(COALESCE(p_dias, 0), 0);
  v_elegiveis integer := 0;
  v_apagadas integer := 0;
  v_notif integer := 0;
  v_estados integer := 0;
  v_oport integer := 0;
  v_por_origem jsonb;
  v_dist jsonb;
  v_amostra jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;

  -- Lista branca explícita de origens. Procuras de cliente (buyer_clients) e
  -- qualquer outra origem futura ficam sempre fora do alcance.
  CREATE TEMP TABLE _purge ON COMMIT DROP AS
  SELECT s.id, s.origem, s.contact_nome, s.expires_at, s.data_publicacao, s.data_origem
  FROM public.active_searches s
  WHERE s.origem IN ('excel', 'whatsapp')
    AND s.expires_at IS NOT NULL
    AND s.expires_at <= now() - make_interval(days => v_dias);

  SELECT count(*) INTO v_elegiveis FROM _purge;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('origem', d.origem, 'total', d.total) ORDER BY d.origem), '[]'::jsonb)
    INTO v_por_origem
  FROM (SELECT origem, count(*) AS total FROM _purge GROUP BY 1) d;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', d.mes, 'total', d.total) ORDER BY d.mes), '[]'::jsonb)
    INTO v_dist
  FROM (SELECT to_char(expires_at, 'YYYY-MM') AS mes, count(*) AS total FROM _purge GROUP BY 1) d;

  SELECT COALESCE(jsonb_agg(a.x), '[]'::jsonb) INTO v_amostra FROM (
    SELECT jsonb_build_object(
      'id', id,
      'nome', contact_nome,
      'origem', origem,
      'publicacao', to_char(COALESCE(data_publicacao, data_origem::timestamptz), 'YYYY-MM-DD'),
      'expiracao', to_char(expires_at, 'YYYY-MM-DD')
    ) AS x
    FROM _purge ORDER BY expires_at ASC LIMIT 20
  ) a;

  SELECT count(*) INTO v_oport
  FROM public.match_opportunities o WHERE o.active_search_id IN (SELECT id FROM _purge);

  IF p_apply THEN
    DELETE FROM public.match_notifications n
    WHERE n.buyer_source = 'search' AND n.buyer_ref IN (SELECT id FROM _purge);
    GET DIAGNOSTICS v_notif = ROW_COUNT;

    DELETE FROM public.match_states m
    WHERE m.buyer_source = 'search' AND m.buyer_ref IN (SELECT id FROM _purge);
    GET DIAGNOSTICS v_estados = ROW_COUNT;

    -- match_opportunities desaparece por ON DELETE CASCADE.
    DELETE FROM public.active_searches s WHERE s.id IN (SELECT id FROM _purge);
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_notif
    FROM public.match_notifications n
    WHERE n.buyer_source = 'search' AND n.buyer_ref IN (SELECT id FROM _purge);

    SELECT count(*) INTO v_estados
    FROM public.match_states m
    WHERE m.buyer_source = 'search' AND m.buyer_ref IN (SELECT id FROM _purge);
  END IF;

  RETURN jsonb_build_object(
    'aplicado', p_apply,
    'dias', v_dias,
    'elegiveis', v_elegiveis,
    'apagadas', v_apagadas,
    'notificacoes_removidas', v_notif,
    'estados_removidos', v_estados,
    'oportunidades_removidas', v_oport,
    'por_origem', v_por_origem,
    'distribuicao', v_dist,
    'amostra', v_amostra
  );
END;
$function$;