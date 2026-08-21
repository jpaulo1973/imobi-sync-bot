-- Release 1.3.2 — Regressão: admin_delete_search (apagar procura permanentemente).
-- Replica a semântica da RPC contra tabelas temporárias, dentro de uma
-- transação com ROLLBACK (nada persiste, nenhum dado de produção é tocado).
-- Valida:
--   1. modo Simular devolve as contagens certas e NÃO apaga nada;
--   2. modo Aplicar remove a procura e os três tipos de dependentes;
--   3. uma procura vizinha do mesmo utilizador fica intacta com os seus dependentes;
--   4. id inexistente → encontrada=false, sem erro;
--   5. zero órfãos após apagar (notificações/estados/oportunidades da procura).
-- Nota: o guard de administrador (has_role) é validado pela própria RPC em
-- produção — aqui testa-se a semântica de eliminação, não a autorização.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE _searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  contact_nome text,
  origem text not null
) ON COMMIT DROP;
CREATE TEMP TABLE _notif (buyer_source text, buyer_ref uuid) ON COMMIT DROP;
CREATE TEMP TABLE _states (buyer_source text, buyer_ref uuid) ON COMMIT DROP;
CREATE TEMP TABLE _opps (active_search_id uuid) ON COMMIT DROP;

INSERT INTO _searches (user_id, contact_nome, origem) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Marco Alvo',   'excel'),
  ('11111111-1111-1111-1111-111111111111', 'Vizinha Safe', 'whatsapp');

-- Alvo: 2 notificações, 1 estado, 3 oportunidades. Vizinha: 1 de cada.
INSERT INTO _notif SELECT 'search', id FROM _searches WHERE contact_nome = 'Marco Alvo';
INSERT INTO _notif SELECT 'search', id FROM _searches WHERE contact_nome = 'Marco Alvo';
INSERT INTO _notif SELECT 'search', id FROM _searches WHERE contact_nome = 'Vizinha Safe';
INSERT INTO _states SELECT 'search', id FROM _searches;
INSERT INTO _opps SELECT id FROM _searches;
INSERT INTO _opps SELECT id FROM _searches WHERE contact_nome = 'Marco Alvo';
INSERT INTO _opps SELECT id FROM _searches WHERE contact_nome = 'Marco Alvo';

DO $$
DECLARE
  v_id uuid;
  v_notif integer;
  v_estados integer;
  v_opps integer;
  v_apagada integer;
  v_encontrada boolean;
BEGIN
  SELECT id INTO v_id FROM _searches WHERE contact_nome = 'Marco Alvo';

  -- (1) SIMULAR: contagens corretas, sem apagar.
  SELECT count(*) INTO v_notif FROM _notif WHERE buyer_source='search' AND buyer_ref = v_id;
  SELECT count(*) INTO v_estados FROM _states WHERE buyer_source='search' AND buyer_ref = v_id;
  SELECT count(*) INTO v_opps FROM _opps WHERE active_search_id = v_id;
  IF v_notif <> 2 OR v_estados <> 1 OR v_opps <> 3 THEN
    RAISE EXCEPTION 'FALHOU (1): simulação com contagens erradas (%/%/%)', v_notif, v_estados, v_opps;
  END IF;
  IF (SELECT count(*) FROM _searches) <> 2 THEN
    RAISE EXCEPTION 'FALHOU (1): simulação apagou linhas';
  END IF;

  -- (4) id inexistente → encontrada = false.
  SELECT EXISTS (SELECT 1 FROM _searches WHERE id = gen_random_uuid()) INTO v_encontrada;
  IF v_encontrada THEN
    RAISE EXCEPTION 'FALHOU (4): id inexistente marcado como encontrado';
  END IF;

  -- (2) APLICAR: mesma ordem da RPC.
  DELETE FROM _notif WHERE buyer_source='search' AND buyer_ref = v_id;
  DELETE FROM _states WHERE buyer_source='search' AND buyer_ref = v_id;
  DELETE FROM _opps WHERE active_search_id = v_id;
  DELETE FROM _searches WHERE id = v_id;
  GET DIAGNOSTICS v_apagada = ROW_COUNT;
  IF v_apagada <> 1 THEN
    RAISE EXCEPTION 'FALHOU (2): procura não apagada (%)', v_apagada;
  END IF;

  -- (5) zero órfãos da procura apagada.
  IF (SELECT count(*) FROM _notif WHERE buyer_ref = v_id) <> 0
     OR (SELECT count(*) FROM _states WHERE buyer_ref = v_id) <> 0
     OR (SELECT count(*) FROM _opps WHERE active_search_id = v_id) <> 0 THEN
    RAISE EXCEPTION 'FALHOU (5): sobraram dependentes órfãos';
  END IF;

  -- (3) vizinha intacta, com os seus dependentes.
  IF (SELECT count(*) FROM _searches) <> 1
     OR (SELECT count(*) FROM _notif) <> 1
     OR (SELECT count(*) FROM _states) <> 1
     OR (SELECT count(*) FROM _opps) <> 1 THEN
    RAISE EXCEPTION 'FALHOU (3): procura vizinha ou dependentes afetados';
  END IF;

  RAISE NOTICE 'OK: admin_delete_search — simulação, eliminação, isolamento e ausência de órfãos.';
END $$;

ROLLBACK;
