DO $$
DECLARE
  z_centro uuid; z_sousa uuid; z_douro uuid; z_prata uuid; z_algarve uuid; z_cont uuid;
  v_id uuid;
  r record;
BEGIN
  -- Helper inline: cria zona funcional se não existir
  INSERT INTO public.locations (slug, nome, tipo, parent_id, aprovado)
  VALUES ('zf-centro','Centro','zona_funcional',NULL,true)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id INTO z_centro;
  INSERT INTO public.locations (slug, nome, tipo, parent_id, aprovado)
  VALUES ('zf-vale-do-sousa','Vale do Sousa','zona_funcional',NULL,true)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id INTO z_sousa;
  INSERT INTO public.locations (slug, nome, tipo, parent_id, aprovado)
  VALUES ('zf-margens-do-rio-douro','Margens do Rio Douro','zona_funcional',NULL,true)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id INTO z_douro;
  INSERT INTO public.locations (slug, nome, tipo, parent_id, aprovado)
  VALUES ('zf-costa-da-prata','Costa da Prata','zona_funcional',NULL,true)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id INTO z_prata;
  INSERT INTO public.locations (slug, nome, tipo, parent_id, aprovado)
  VALUES ('zf-algarve','Algarve','zona_funcional',NULL,true)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id INTO z_algarve;
  INSERT INTO public.locations (slug, nome, tipo, parent_id, aprovado)
  VALUES ('zf-portugal-continental','Portugal Continental','zona_funcional',NULL,true)
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id INTO z_cont;

  -- 1. Centro: distritos inteiros
  FOR r IN SELECT id FROM public.locations
           WHERE tipo='distrito' AND nome IN ('Aveiro','Coimbra','Leiria','Viseu','Guarda','Castelo Branco')
  LOOP
    INSERT INTO public.functional_zone_members (functional_zone_id, location_id)
    SELECT z_centro, r.id
    WHERE NOT EXISTS (SELECT 1 FROM public.functional_zone_members m WHERE m.functional_zone_id=z_centro AND m.location_id=r.id);
  END LOOP;

  -- 2. Vale do Sousa: concelhos
  FOR r IN SELECT c.id FROM public.locations c
           WHERE c.tipo='concelho' AND c.nome IN ('Castelo de Paiva','Felgueiras','Lousada','Paços de Ferreira','Paredes','Penafiel')
  LOOP
    INSERT INTO public.functional_zone_members (functional_zone_id, location_id)
    SELECT z_sousa, r.id
    WHERE NOT EXISTS (SELECT 1 FROM public.functional_zone_members m WHERE m.functional_zone_id=z_sousa AND m.location_id=r.id);
  END LOOP;

  -- 3. Margens do Rio Douro: freguesias exactas (nome, concelho)
  FOR r IN
    SELECT f.id FROM public.locations f
    JOIN public.locations c ON c.id = f.parent_id
    WHERE f.tipo='freguesia' AND (c.nome, f.nome) IN (
      ('Baião','União das freguesias de Ancede e Ribadouro'),
      ('Baião','União das freguesias de Baião (Santa Leocádia) e Mesquinhata'),
      ('Marco de Canaveses','Sande e São Lourenço do Douro'),
      ('Marco de Canaveses','Várzea, Aliviada e Folhada'),
      ('Marco de Canaveses','Vila Boa do Bispo'),
      ('Marco de Canaveses','Penha Longa'),
      ('Marco de Canaveses','Paços de Gaiolo'),
      ('Gondomar','União das freguesias de Foz do Sousa e Covelo'),
      ('Gondomar','União das freguesias de Melres e Medas'),
      ('Cinfães','Souselo'),
      ('Cinfães','Espadanedo'),
      ('Cinfães','Cinfães'),
      ('Cinfães','Oliveira do Douro'),
      ('Cinfães','São Cristóvão de Nogueira'),
      ('Castelo de Paiva','Raiva'),
      ('Castelo de Paiva','Pedorido'),
      ('Castelo de Paiva','Paraíso'),
      ('Castelo de Paiva','Santa Maria de Sardoura'),
      ('Resende','Barrô'),
      ('Resende','Paus'),
      ('Resende','União das freguesias de Anreade e São Romão de Aregos'),
      ('Resende','São Martinho de Mouros'),
      ('Lamego','Penajóia'),
      ('Lamego','Samodães')
    )
  LOOP
    INSERT INTO public.functional_zone_members (functional_zone_id, location_id)
    SELECT z_douro, r.id
    WHERE NOT EXISTS (SELECT 1 FROM public.functional_zone_members m WHERE m.functional_zone_id=z_douro AND m.location_id=r.id);
  END LOOP;

  -- 4. Costa da Prata: concelhos
  FOR r IN
    SELECT c.id FROM public.locations c JOIN public.locations d ON d.id=c.parent_id
    WHERE c.tipo='concelho' AND (d.nome, c.nome) IN (
      ('Leiria','Nazaré'),('Leiria','Caldas da Rainha'),('Leiria','Óbidos'),('Leiria','Peniche'),
      ('Lisboa','Lourinhã'),('Lisboa','Torres Vedras'),('Leiria','Bombarral'),('Leiria','Alcobaça'),
      ('Leiria','Marinha Grande'),('Coimbra','Figueira da Foz'),('Coimbra','Mira')
    )
  LOOP
    INSERT INTO public.functional_zone_members (functional_zone_id, location_id)
    SELECT z_prata, r.id
    WHERE NOT EXISTS (SELECT 1 FROM public.functional_zone_members m WHERE m.functional_zone_id=z_prata AND m.location_id=r.id);
  END LOOP;

  -- 5. Algarve: todos os concelhos do distrito de Faro
  FOR r IN
    SELECT c.id FROM public.locations c JOIN public.locations d ON d.id=c.parent_id
    WHERE c.tipo='concelho' AND d.tipo='distrito' AND d.nome='Faro'
  LOOP
    INSERT INTO public.functional_zone_members (functional_zone_id, location_id)
    SELECT z_algarve, r.id
    WHERE NOT EXISTS (SELECT 1 FROM public.functional_zone_members m WHERE m.functional_zone_id=z_algarve AND m.location_id=r.id);
  END LOOP;

  -- 6. Portugal Continental: 18 distritos (exclui ilhas)
  FOR r IN
    SELECT id FROM public.locations WHERE tipo='distrito' AND nome NOT LIKE 'Ilha %'
  LOOP
    INSERT INTO public.functional_zone_members (functional_zone_id, location_id)
    SELECT z_cont, r.id
    WHERE NOT EXISTS (SELECT 1 FROM public.functional_zone_members m WHERE m.functional_zone_id=z_cont AND m.location_id=r.id);
  END LOOP;

  -- Aliases (uma localização cada => nunca ambíguos)
  FOREACH v_id IN ARRAY ARRAY[]::uuid[] LOOP END LOOP;

  INSERT INTO public.location_aliases (alias_normalizado, location_ids, origem, aprovado)
  VALUES
    ('centro', ARRAY[z_centro], 'zona_lote_v6', true),
    ('zona centro', ARRAY[z_centro], 'zona_lote_v6', true),
    ('regiao centro', ARRAY[z_centro], 'zona_lote_v6', true),
    ('vale do sousa', ARRAY[z_sousa], 'zona_lote_v6', true),
    ('vale sousa', ARRAY[z_sousa], 'zona_lote_v6', true),
    ('margens do rio douro', ARRAY[z_douro], 'zona_lote_v6', true),
    ('margens do douro', ARRAY[z_douro], 'zona_lote_v6', true),
    ('rio douro', ARRAY[z_douro], 'zona_lote_v6', true),
    ('costa da prata', ARRAY[z_prata], 'zona_lote_v6', true),
    ('algarve', ARRAY[z_algarve], 'zona_lote_v6', true),
    ('portugal continental', ARRAY[z_cont], 'zona_lote_v6', true),
    ('continente', ARRAY[z_cont], 'zona_lote_v6', true),
    ('todo o pais', ARRAY[z_cont], 'zona_lote_v6', true),
    ('qualquer zona do continente', ARRAY[z_cont], 'zona_lote_v6', true)
  ON CONFLICT (alias_normalizado) DO UPDATE
    SET location_ids = EXCLUDED.location_ids, aprovado = true, origem = EXCLUDED.origem;
END $$;

INSERT INTO public.geo_library_version (version, notes)
VALUES (6, 'Zonas novas: Centro, Vale do Sousa, Margens do Rio Douro, Costa da Prata, Algarve, Portugal Continental');