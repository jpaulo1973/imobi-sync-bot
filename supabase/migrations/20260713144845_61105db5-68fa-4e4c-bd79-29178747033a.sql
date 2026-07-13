-- Release 1.3 finais
-- 1) Adicionar coluna area_terreno_m2 a properties (para quintas/herdades/terrenos)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS area_terreno_m2 numeric;

-- 2) Normalização global de telefones: 9 dígitos para PT (sem prefixo 351),
--    E.164-lite para restantes. Aplica-se a contact_telefone e consultor_telefone
--    em active_searches, e telefone em buyer_clients.
CREATE OR REPLACE FUNCTION public.normalize_phone_pt(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE s text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN RETURN NULL; END IF;
  s := regexp_replace(raw, '\D+', '', 'g');
  IF s IS NULL OR s = '' THEN RETURN NULL; END IF;
  IF left(s, 2) = '00' THEN s := substring(s from 3); END IF;
  IF left(s, 3) = '351' AND length(s) > 9 THEN s := right(s, 9); END IF;
  IF length(s) < 6 THEN RETURN NULL; END IF;
  RETURN s;
END;
$$;

UPDATE public.active_searches
SET contact_telefone = public.normalize_phone_pt(contact_telefone)
WHERE contact_telefone IS NOT NULL
  AND contact_telefone <> COALESCE(public.normalize_phone_pt(contact_telefone), '');

UPDATE public.active_searches
SET consultor_telefone = public.normalize_phone_pt(consultor_telefone)
WHERE consultor_telefone IS NOT NULL
  AND consultor_telefone <> COALESCE(public.normalize_phone_pt(consultor_telefone), '');

UPDATE public.buyer_clients
SET telefone = public.normalize_phone_pt(telefone)
WHERE telefone IS NOT NULL
  AND telefone <> COALESCE(public.normalize_phone_pt(telefone), '');