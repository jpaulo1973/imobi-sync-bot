-- Regressão: admin_merge_duplicate_group (fusão manual de duplicados).
-- Valida, dentro de uma transação com ROLLBACK (nada persiste):
--   1. modo Simular não apaga nada e as contagens correspondem à realidade;
--   2. modo Aplicar mantém a procura escolhida e apaga as restantes;
--   3. após aplicar, ZERO notificações e estados de match órfãos (o bug corrigido);
--   4. merged_from_count é incrementado na procura mantida.

\set ON_ERROR_STOP on

BEGIN;

-- Réplica isolada da estrutura relevante: não tocamos em dados de produção.
CREATE TEMP TABLE _searches (
  id uuid primary key default gen_random_uuid(),
  contact_nome text,
  origem text not null,
  merged_from_count integer not null default 0
) ON COMMIT DROP;
CREATE TEMP TABLE _notif (buyer_source text, buyer_ref uuid) ON COMMIT DROP;
CREATE TEMP TABLE _states (buyer_source text, buyer_ref uuid) ON COMMIT DROP;
CREATE TEMP TABLE _opps (active_search_id uuid) ON COMMIT DROP;

INSERT INTO _searches (contact_nome, origem) VALUES
  ('Rodrigo Exemplo', 'excel'),      -- mantida
  ('Rodrigo Exemplo', 'excel'),      -- removida
  ('Rodrigo Exemplo', 'whatsapp'),   -- removida
  ('Outra Pessoa',    'excel');      -- fora do grupo, nunca tocada

INSERT INTO _notif SELECT 'search', id FROM _searches;
INSERT INTO _states SELECT 'search', id FROM _searches;
INSERT INTO _opps SELECT id FROM _searches;
-- Segunda notificação numa das removidas (par diferente).
INSERT INTO _notif SELECT 'search', id FROM _searches WHERE origem = 'whatsapp';

DO $$
DECLARE
  v_keep uuid;
  v_remove uuid[];
  v_notif integer;
  v_estados integer;
  v_opps integer;
  v_apagadas integer;
  v_orfaos integer;
  v_total_antes integer;
  v_mfc integer;
BEGIN
  SELECT id INTO v_keep FROM _searches
  WHERE contact_nome = 'Rodrigo Exemplo' ORDER BY id LIMIT 1;

  SELECT array_agg(id) INTO v_remove FROM _searches
  WHERE contact_nome = 'Rodrigo Exemplo' AND id <> v_keep;

  SELECT count(*) INTO v_total_antes FROM _searches;

  -- (1) SIMULAR — contagens do que seria apagado, sem apagar.
  SELECT count(*) INTO v_notif FROM _notif
   WHERE buyer_source = 'search' AND buyer_ref = ANY(v_remove);
  SELECT count(*) INTO v_estados FROM _states
   WHERE buyer_source = 'search' AND buyer_ref = ANY(v_remove);
  SELECT count(*) INTO v_opps FROM _opps
   WHERE active_search_id = ANY(v_remove);

  IF v_notif <> 3 THEN
    RAISE EXCEPTION 'REGRESSION: notificações a remover esperadas 3, obtidas %', v_notif;
  END IF;
  IF v_estados <> 2 THEN
    RAISE EXCEPTION 'REGRESSION: estados a remover esperados 2, obtidos %', v_estados;
  END IF;
  IF v_opps <> 2 THEN
    RAISE EXCEPTION 'REGRESSION: oportunidades a remover esperadas 2, obtidas %', v_opps;
  END IF;

  IF (SELECT count(*) FROM _searches) <> v_total_antes THEN
    RAISE EXCEPTION 'REGRESSION: simular alterou dados';
  END IF;

  -- (2) APLICAR — mesma ordem da função: notificações, estados, oportunidades, procuras.
  DELETE FROM _notif WHERE buyer_source = 'search' AND buyer_ref = ANY(v_remove);
  DELETE FROM _states WHERE buyer_source = 'search' AND buyer_ref = ANY(v_remove);
  DELETE FROM _opps WHERE active_search_id = ANY(v_remove);
  DELETE FROM _searches WHERE id = ANY(v_remove);
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;

  UPDATE _searches SET merged_from_count = merged_from_count + v_apagadas WHERE id = v_keep;

  IF v_apagadas <> 2 THEN
    RAISE EXCEPTION 'REGRESSION: apagadas esperadas 2, obtidas %', v_apagadas;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _searches WHERE id = v_keep) THEN
    RAISE EXCEPTION 'REGRESSION: a procura mantida foi apagada';
  END IF;

  IF (SELECT count(*) FROM _searches WHERE contact_nome = 'Outra Pessoa') <> 1 THEN
    RAISE EXCEPTION 'REGRESSION: procura fora do grupo foi afetada';
  END IF;

  -- (3) ÓRFÃOS — nada pode apontar para procuras inexistentes.
  SELECT (SELECT count(*) FROM _notif n WHERE NOT EXISTS (SELECT 1 FROM _searches s WHERE s.id = n.buyer_ref))
       + (SELECT count(*) FROM _states m WHERE NOT EXISTS (SELECT 1 FROM _searches s WHERE s.id = m.buyer_ref))
       + (SELECT count(*) FROM _opps o WHERE NOT EXISTS (SELECT 1 FROM _searches s WHERE s.id = o.active_search_id))
    INTO v_orfaos;
  IF v_orfaos <> 0 THEN
    RAISE EXCEPTION 'REGRESSION: % registo(s) órfão(s) após fundir', v_orfaos;
  END IF;

  -- (4) merged_from_count.
  SELECT merged_from_count INTO v_mfc FROM _searches WHERE id = v_keep;
  IF v_mfc <> 2 THEN
    RAISE EXCEPTION 'REGRESSION: merged_from_count esperado 2, obtido %', v_mfc;
  END IF;

  RAISE NOTICE 'OK: merge de duplicados sem órfãos (apagadas=%, notif=%, estados=%)',
    v_apagadas, v_notif, v_estados;
END $$;

ROLLBACK;
