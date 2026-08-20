-- 1. Núcleo partilhado (sem gate) — usado pelo painel admin e pela rotina automática.
CREATE OR REPLACE FUNCTION public.purge_expired_searches_exec(
  p_apply boolean DEFAULT false,
  p_dias integer DEFAULT 0,
  p_via text DEFAULT 'manual'
)
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
  v_res jsonb;
BEGIN
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

  v_res := jsonb_build_object(
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

  -- Histórico consultável: só quando apaga a sério.
  IF p_apply THEN
    INSERT INTO public.app_settings (key, value, updated_by)
    VALUES (
      'purge_expired_last_run',
      jsonb_build_object(
        'executado_em', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
        'via', COALESCE(NULLIF(btrim(p_via), ''), 'manual'),
        'dias', v_dias,
        'elegiveis', v_elegiveis,
        'apagadas', v_apagadas,
        'notificacoes_removidas', v_notif,
        'estados_removidos', v_estados,
        'oportunidades_removidas', v_oport,
        'por_origem', v_por_origem,
        'historico', (
          COALESCE(
            (SELECT (value->'historico') FROM public.app_settings WHERE key = 'purge_expired_last_run'),
            '[]'::jsonb
          )
        )
      ),
      auth.uid()
    )
    ON CONFLICT (key) DO UPDATE SET
      value = jsonb_set(
        EXCLUDED.value,
        '{historico}',
        (
          jsonb_build_array(EXCLUDED.value - 'historico')
          || COALESCE(public.app_settings.value->'historico', '[]'::jsonb)
        )
      ),
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

    -- Mantém apenas as 30 execuções mais recentes.
    UPDATE public.app_settings
    SET value = jsonb_set(
      value, '{historico}',
      COALESCE((SELECT jsonb_agg(h) FROM (
        SELECT h FROM jsonb_array_elements(value->'historico') h LIMIT 30
      ) t), '[]'::jsonb)
    )
    WHERE key = 'purge_expired_last_run';
  END IF;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_searches_exec(boolean, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_searches_exec(boolean, integer, text) TO service_role;

-- 2. Painel admin: gate + delega no núcleo.
CREATE OR REPLACE FUNCTION public.admin_purge_expired_searches(
  p_apply boolean DEFAULT false,
  p_dias integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  RETURN public.purge_expired_searches_exec(p_apply, p_dias, 'manual');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_purge_expired_searches(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_expired_searches(boolean, integer) TO authenticated;

-- 3. Rotina automática: só o service_role (endpoint /api/public/cron) pode chamar.
CREATE OR REPLACE FUNCTION public.cron_purge_expired_searches(p_dias integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.purge_expired_searches_exec(true, COALESCE(p_dias, 0), 'automatico');
END;
$function$;

REVOKE ALL ON FUNCTION public.cron_purge_expired_searches(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_purge_expired_searches(integer) TO service_role;

-- 4. Leitura do histórico pelo painel de Manutenção (admins).
CREATE OR REPLACE FUNCTION public.admin_purge_expired_history()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem permissões de administrador.';
  END IF;
  SELECT value INTO v FROM public.app_settings WHERE key = 'purge_expired_last_run';
  RETURN COALESCE(v, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_purge_expired_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_expired_history() TO authenticated;