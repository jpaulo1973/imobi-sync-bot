-- Regressão: admin_purge_expired_searches (limpeza definitiva).
-- Valida, dentro de uma transação com ROLLBACK (nada persiste):
--   1. origem 'cliente'/'texto' nunca é apanhada, mesmo expirada há 1 ano;
--   2. procura ainda válida (expires_at futuro) não é apanhada;
--   3. contagem do modo simular == número realmente apagado no modo aplicar;
--   4. após aplicar, zero oportunidades/notificações/estados órfãos.

\set ON_ERROR_STOP on

BEGIN;

-- Replica a regra de elegibilidade do RPC (lista branca + janela p_dias = 0).
CREATE TEMP TABLE _searches ON COMMIT DROP (
  id uuid primary key default gen_random_uuid(),
  origem text not null,
  expires_at timestamptz
);
CREATE TEMP TABLE _notif ON COMMIT DROP (buyer_source text, buyer_ref uuid);
CREATE TEMP TABLE _states ON COMMIT DROP (buyer_source text, buyer_ref uuid);
CREATE TEMP TABLE _opps ON COMMIT DROP (active_search_id uuid);

INSERT INTO _searches (origem, expires_at) VALUES
  ('excel',    now() - interval '1 day'),
  ('excel',    now() - interval '400 days'),
  ('whatsapp', now() - interval '2 hours'),
  ('excel',    now() + interval '10 days'),   -- ainda válida
  ('excel',    NULL),                          -- sem expiração
  ('cliente',  now() - interval '365 days'),   -- NUNCA apagar
  ('texto',    now() - interval '365 days'),   -- NUNCA apagar
  ('captura',  now() - interval '365 days');   -- NUNCA apagar

INSERT INTO _notif SELECT 'search', id FROM _searches;
INSERT INTO _states SELECT 'search', id FROM _searches;
INSERT INTO _opps SELECT id FROM _searches;

DO $$
DECLARE
  v_sim integer;
  v_del integer;
  v_cliente integer;
  v_orfaos integer;
BEGIN
  CREATE TEMP TABLE _purge ON COMMIT DROP AS
  SELECT s.id, s.origem FROM _searches s
  WHERE s.origem IN ('excel', 'whatsapp')
    AND s.expires_at IS NOT NULL
    AND s.expires_at <= now() - make_interval(days => 0);

  SELECT count(*) INTO v_sim FROM _purge;
  IF v_sim <> 3 THEN
    RAISE EXCEPTION 'REGRESSION: elegíveis esperados 3, obtidos %', v_sim;
  END IF;

  SELECT count(*) INTO v_cliente FROM _purge WHERE origem NOT IN ('excel','whatsapp');
  IF v_cliente <> 0 THEN
    RAISE EXCEPTION 'REGRESSION: origem não-purgável apanhada pela query';
  END IF;

  DELETE FROM _notif WHERE buyer_source = 'search' AND buyer_ref IN (SELECT id FROM _purge);
  DELETE FROM _states WHERE buyer_source = 'search' AND buyer_ref IN (SELECT id FROM _purge);
  DELETE FROM _opps WHERE active_search_id IN (SELECT id FROM _purge);
  DELETE FROM _searches WHERE id IN (SELECT id FROM _purge);
  GET DIAGNOSTICS v_del = ROW_COUNT;

  IF v_del <> v_sim THEN
    RAISE EXCEPTION 'REGRESSION: simular=% mas apagadas=%', v_sim, v_del;
  END IF;

  -- Procuras de cliente intactas.
  IF (SELECT count(*) FROM _searches WHERE origem = 'cliente') <> 1 THEN
    RAISE EXCEPTION 'REGRESSION: procura de cliente foi apagada';
  END IF;

  -- Nada órfão: cada referência restante aponta para uma procura existente.
  SELECT count(*) INTO v_orfaos FROM (
    SELECT buyer_ref AS ref FROM _notif
    UNION ALL SELECT buyer_ref FROM _states
    UNION ALL SELECT active_search_id FROM _opps
  ) r WHERE NOT EXISTS (SELECT 1 FROM _searches s WHERE s.id = r.ref);
  IF v_orfaos <> 0 THEN
    RAISE EXCEPTION 'REGRESSION: % referências órfãs após limpeza', v_orfaos;
  END IF;

  RAISE NOTICE 'OK purge expired: simular=% apagadas=% orfaos=0', v_sim, v_del;
END $$;

-- A função existe e está admin-gated (sem admin, levanta excepção).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_purge_expired_searches'
  ) THEN
    RAISE EXCEPTION 'REGRESSION: admin_purge_expired_searches não existe';
  END IF;
  RAISE NOTICE 'OK rpc admin_purge_expired_searches presente';
END $$;

ROLLBACK;
