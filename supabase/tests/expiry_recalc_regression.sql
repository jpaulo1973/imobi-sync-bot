-- Regressão: admin_recalc_excel_expiry — padrão de distribuição por mês
-- Testa que o bloco de distribuição (query equivalente) não lança
-- "aggregate functions are not allowed in GROUP BY" e devolve a estrutura esperada.
-- Não depende de auth: usa uma tabela temporária e agregação pura.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE _recalc_test ON COMMIT DROP AS
SELECT
  '2026-01-15 10:00:00+00'::timestamptz AS data_publicacao,
  '2026-01-15'::date AS data_origem,
  '2026-12-31 23:59:59+00'::timestamptz AS exp_atual,
  ('2026-01-15 10:00:00+00'::timestamptz + interval '30 days') AS exp_novo
UNION ALL SELECT '2026-01-20 10:00:00+00', '2026-01-20', '2026-12-31 23:59:59+00', '2026-01-20 10:00:00+00'::timestamptz + interval '30 days'
UNION ALL SELECT '2026-02-05 10:00:00+00', '2026-02-05', '2026-12-31 23:59:59+00', '2026-02-05 10:00:00+00'::timestamptz + interval '30 days';

-- Esta é a query equivalente ao bloco de distribuição corrigido.
SELECT COALESCE(jsonb_agg(
  jsonb_build_object('mes', d.mes, 'total', d.total) ORDER BY d.mes
), '[]'::jsonb) AS distribuicao
FROM (
  SELECT to_char(COALESCE(data_publicacao, data_origem::timestamptz), 'YYYY-MM') AS mes,
         count(*) AS total
  FROM _recalc_test WHERE exp_novo <= now() AND exp_atual > now()
  GROUP BY 1
) d;

DO $$
DECLARE
  v_dist jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('mes', d.mes, 'total', d.total) ORDER BY d.mes
  ), '[]'::jsonb) INTO v_dist
  FROM (
    SELECT to_char(COALESCE(data_publicacao, data_origem::timestamptz), 'YYYY-MM') AS mes,
           count(*) AS total
    FROM _recalc_test WHERE exp_novo <= now() AND exp_atual > now()
    GROUP BY 1
  ) d;

  IF jsonb_array_length(v_dist) = 0 THEN
    RAISE EXCEPTION 'REGRESSION: distribuicao vazia';
  END IF;

  IF NOT (v_dist @> '[{"mes":"2026-01","total":2}]'::jsonb) THEN
    RAISE EXCEPTION 'REGRESSION: distribuicao não contém {mes:2026-01, total:2}, resultado: %', v_dist;
  END IF;

  IF NOT (v_dist @> '[{"mes":"2026-02","total":1}]'::jsonb) THEN
    RAISE EXCEPTION 'REGRESSION: distribuicao não contém {mes:2026-02, total:1}, resultado: %', v_dist;
  END IF;

  RAISE NOTICE 'OK distribuicao por mes devolveu: %', v_dist;
END $$;

ROLLBACK;
