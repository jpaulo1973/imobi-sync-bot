with al as (
  select id, alias_normalizado, location_ids, replace(alias_normalizado,'-',' ') base
  from public.location_aliases
  where alias_normalizado in ('figueira','sao salvador','sao-salvador','santo isidoro','santo-isidoro','sao miguel','sao-miguel','sao bartolomeu','sao-bartolomeu','cela','barrio','sande','alvarelhos','carvalhosa','frossos','lagares','torrao','urro','cepoes','cabacos','arca','fonte longa','silva escura','sao cipriano')
),
f as (
  select id, lower(translate(nome,'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÇ','aaaaeeiooouucAAAAEEIOOOUC')) nn
  from public.locations where tipo='freguesia' and aprovado
),
comp as (
  select f.id, btrim(regexp_replace(c, '^(uniao das freguesias de|uniao de freguesias de)\s+','')) part
  from f, unnest(regexp_split_to_array(f.nn, '\s+e\s+|,\s*|\(|\)')) c
),
cands as (
  select a.id as alias_id, array_agg(distinct comp.id) as ids
  from al a join comp on comp.part = a.base
  group by a.id
)
update public.location_aliases la
set location_ids = (
      select array_agg(distinct x) from (
        select unnest(c.ids) as x union select unnest(la.location_ids)
      ) u
    ),
    origem = 'auditoria_ambiguidade_v5',
    updated_at = now()
from cands c
where c.alias_id = la.id and array_length(c.ids,1) > 1;

insert into public.geo_library_version (version, notes)
select 5, 'Aliases ambíguos (24 nomes de freguesia repetidos) passam a listar todos os candidatos; parser trata como não resolvido'
where not exists (select 1 from public.geo_library_version where version = 5);