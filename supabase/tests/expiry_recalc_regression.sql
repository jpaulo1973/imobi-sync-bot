-- Regressão: admin_recalc_excel_expiry — distribuição por mês
-- Testa que o bloco de distribuição não lança "aggregate functions are not allowed in GROUP BY"
-- e que o resultado tem a estrutura esperada.
-- Deve ser corrido numa transação e com rollback, pois cria/modifica dados de teste.

\set ON_ERROR_STOP on

BEGIN;

-- Criar consultor de teste com role admin
INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-1111-1111-1111-000000000001'::uuid,
        'expiry.test@example.com',
        '{"name":"Test Admin"}'::jsonb,
        now(), now())
ON CONFLICT (id) DO UPDATE SET raw_user_meta_data = '{"name":"Test Admin"}'::jsonb;

INSERT INTO public.profiles (id, email, nome, created_at, updated_at)
VALUES ('00000000-1111-1111-1111-000000000001'::uuid,
        'expiry.test@example.com',
        'Test Admin',
        now(), now())
ON CONFLICT (id) DO UPDATE SET nome = 'Test Admin';

INSERT INTO public.user_roles (user_id, role)
VALUES ('00000000-1111-1111-1111-000000000001'::uuid, 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Inserir procuras Excel de teste com data_publicacao no passado e expires_at no futuro
-- para garantir que entram no conjunto "ficam expiradas".
INSERT INTO public.active_searches (
  id, user_id, contact_nome, origem, descartado,
  data_publicacao, data_origem, expires_at, status, import_batch_id
) VALUES
  ('00000000-2222-2222-2222-000000000001'::uuid,
   '00000000-1111-1111-1111-000000000001'::uuid,
   'Lead A', 'excel', false,
   '2026-01-15 10:00:00+00', '2026-01-15', '2026-12-31 23:59:59+00', 'new', 'test-batch'),
  ('00000000-2222-2222-2222-000000000002'::uuid,
   '00000000-1111-1111-1111-000000000001'::uuid,
   'Lead B', 'excel', false,
   '2026-01-20 10:00:00+00', '2026-01-20', '2026-12-31 23:59:59+00', 'new', 'test-batch'),
  ('00000000-2222-2222-2222-000000000003'::uuid,
   '00000000-1111-1111-1111-000000000001'::uuid,
   'Lead C', 'excel', false,
   '2026-02-05 10:00:00+00', '2026-02-05', '2026-12-31 23:59:59+00', 'new', 'test-batch');

-- Simular (dry-run) como admin de teste
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1111-1111-1111-000000000001', true);

DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.admin_recalc_excel_expiry(false);

  IF (v_result->>'ficam_expiradas')::int < 1 THEN
    RAISE EXCEPTION 'REGRESSION: esperava pelo menos 1 procura a expirar, obtive %', v_result->>'ficam_expiradas';
  END IF;

  IF jsonb_array_length(v_result->'distribuicao') = 0 THEN
    RAISE EXCEPTION 'REGRESSION: distribuicao vazia — GROUP BY pode ter falhado silenciosamente';
  END IF;

  IF NOT (v_result->'distribuicao' @> '[{"mes":"2026-01","total":2}]'::jsonb) THEN
    RAISE EXCEPTION 'REGRESSION: distribuicao não contém {mes:2026-01, total:2}, resultado: %', v_result->'distribuicao';
  END IF;

  IF NOT (v_result->'distribuicao' @> '[{"mes":"2026-02","total":1}]'::jsonb) THEN
    RAISE EXCEPTION 'REGRESSION: distribuicao não contém {mes:2026-02, total:1}, resultado: %', v_result->'distribuicao';
  END IF;

  RAISE NOTICE 'OK admin_recalc_excel_expiry dry-run devolveu: %', v_result;
END $$;

RESET ROLE;

ROLLBACK;
