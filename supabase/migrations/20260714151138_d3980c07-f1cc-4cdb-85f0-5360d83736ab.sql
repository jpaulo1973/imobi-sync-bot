-- Backfill: sanitizar tipologias/quartos_min implausíveis gravados por
-- versões antigas do importador (ex.: "T3" lido como número 73).
--
-- Regras (alinhadas com src/lib/bedrooms-normalize.ts):
--   - quartos_min > 20 → null
--   - tipologia numérica > 20 (ex.: "73") → null
--   - tipologia "Tn" com n > 20 → null
-- Múltiplas tipologias ("T2 ou T3") e "Moradia" ficam intactas.

-- 1) active_searches.criteria (jsonb)
UPDATE public.active_searches
SET criteria = jsonb_set(
  criteria,
  '{quartos_min}',
  'null'::jsonb,
  true
)
WHERE (criteria->>'quartos_min') ~ '^\d+$'
  AND (criteria->>'quartos_min')::int > 20;

UPDATE public.active_searches
SET criteria = jsonb_set(
  criteria,
  '{tipologia}',
  'null'::jsonb,
  true
)
WHERE criteria ? 'tipologia'
  AND (
    -- número puro implausível ("73")
    ((criteria->>'tipologia') ~ '^\d+$' AND (criteria->>'tipologia')::int > 20)
    OR
    -- "T<n>" com n > 20 ("T73")
    ((criteria->>'tipologia') ~* '^t\s*\d+\+?$'
      AND (regexp_replace(criteria->>'tipologia', '\D', '', 'g'))::int > 20)
  );

-- 2) buyer_clients (colunas dedicadas)
UPDATE public.buyer_clients
SET quartos_min = NULL
WHERE quartos_min IS NOT NULL AND quartos_min > 20;

UPDATE public.buyer_clients
SET tipologia = NULL
WHERE tipologia IS NOT NULL
  AND (
    (tipologia ~ '^\d+$' AND tipologia::int > 20)
    OR (tipologia ~* '^t\s*\d+\+?$'
        AND (regexp_replace(tipologia, '\D', '', 'g'))::int > 20)
  );

-- 3) properties.quartos (defesa: número de quartos de imóvel > 20 é ruído)
UPDATE public.properties
SET quartos = NULL
WHERE quartos IS NOT NULL AND quartos > 20;