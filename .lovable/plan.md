# Sprint — Dados Estruturados e Inteligência Geográfica (Versão Final Aprovada)

## Objetivo

Eliminar definitivamente o texto livre como fonte de verdade para localização. Criar uma infraestrutura geográfica única para todo o Property Match, onde todas as decisões passam obrigatoriamente pela mesma biblioteca, parser, pipeline e motor. Após esta sprint deixará de existir qualquer implementação paralela de lógica geográfica.

## Decisões arquiteturais

- 3 commits: Fundação → Pipeline → Motor.
- `EntitySelector` minimalista; `LocationSelector` como primeira especialização.
- Parser totalmente determinístico. Fuzzy Matching fora do âmbito.
- Toda a lógica geográfica existe apenas uma vez. Nenhum canal pode implementar interpretação própria.

---

## Commit 1 — Fundação  *(parcialmente concluído)*

**Já aplicado na migração anterior:**

- `locations` (id, slug, nome, tipo, parent_id, aprovado).
- `location_relations` (from/to/relation_type: parent, child, adjacent, nearby, contains).
- `functional_zone_members` (functional_zone_id, location_id).
- `location_aliases` (alias_normalizado, location_ids, origem, aprovado, created_by, times_used, last_used_at).
- `location_metadata` (INE, lat/long, centroide, bounding box, NUTS, população, área, código postal).
- `active_searches.location_ids`, `audit_geo`, `pending_geo`.
- `buyer_clients.location_ids`.
- `properties.location_id`.

**Ajustes necessários nesta iteração:**

1. **Versionamento — `geo_library_version`**
   - Nova tabela `geo_library_version` (id, version int, notas, created_at) para registar cada incremento.
   - Adicionar coluna `geo_library_version int` a `active_searches`, `buyer_clients` e `properties`.
   - Incrementar sempre que novos aliases, locais, zonas, relações ou coberturas modifiquem potencialmente o parser.
   - Reprocessamento via `backfillLocations()`.

2. **Seed inicial** — distritos, concelhos, freguesias, zonas funcionais, relações, aliases conhecidos (Alverca, Costa, Expo, Lx, Margem Sul, Grande Lisboa, Linha de Cascais, Lisboa 30 min, Lisboa 20 km, etc.).

3. **Backfill inicial** — apenas correspondência exata; não resolvidos ficam `pending_geo`.

---

## Commit 2 — Parser + UI + Pipeline

### Biblioteca `src/lib/geo/`

- `geo-types.ts` — tipos partilhados.
- `geo-context.ts` — contexto (versão, opções).
- `geo-parser.ts` — função pura `parseLocations(text, context)`.
- `location-repository.ts` — única API de acesso.

### `LocationRepository`

Toda a aplicação consome exclusivamente:

- `search()`
- `resolve()`
- `getById()`
- `getChildren()`
- `getAdjacent()`
- `getFunctionalZoneMembers()`

Nenhum componente consulta diretamente as tabelas geográficas.

### `parseLocations(text, context)`

Função pura. Nunca grava, aprende, altera dados nem conhece a UI.

**Pipeline:** conectores → normalização → alias → slug → freguesia → concelho → distrito → zona funcional → `unresolved`. **Sem fuzzy.**

**Retorno:** `resolved`, `aliases_used`, `confidence`, `unresolved`, `audit_trail`. `confidence` é transitória, nunca persistida como dado de negócio.

**Regras de validação:**

| Confidence | Ação |
|---|---|
| 95+ | Aceitação automática |
| 80–94 | Aceitação + auditoria |
| 60–79 | Sugestão de revisão |
| <60 | Revisão obrigatória |

Qualquer `unresolved` → `pending_geo`.

### Server functions

- `searchLocations()`
- `resolveLocationText()`
- `promoteAlias()`
- `updateSearchLocations()`
- `backfillLocations()`

### `EntitySelector` + `LocationSelector`

Componente base minimalista, primeira especialização é `LocationSelector`. Substituir todos os campos de localização em: Revisão, Compradores, Imóveis, Active Searches, Radar, Importação Manual.

### Pipeline único

```
Excel | WhatsApp | PDF | API | Manual
                ↓
        LocationRepository
                ↓
           Geo Parser
                ↓
      Location IDs + Audit
                ↓
       Validation Rules
                ↓
       Aceite  |  pending_geo
                ↓
              Motor
```

Nenhum canal implementa lógica própria.

### Revisão inteligente

Mostrar: texto original, resultado do parser, aliases utilizados, localizações, IDs, versão da biblioteca, motivo, decisão. Se for nova interpretação: perguntar "Pretende guardar esta interpretação?" → `promoteAlias()`. Aprendizagem sempre explícita.

### Backfill

Executar `backfillLocations()` para `properties`, `buyer_clients`, `active_searches`.

---

## Commit 3 — Motor

Reescrever completamente o matching. Nunca comparar texto — apenas IDs.

**Comparações suportadas:** match direto, parent/child, zona funcional, adjacência.

**Eliminar definitivamente:**

- `location-graph.ts`
- `KNOWN_CONCELHOS`
- `ADJACENT`
- `.includes()` e `.toLowerCase()` sobre campos de zona.

Toda a lógica passa exclusivamente para a infraestrutura geográfica. O motor trabalha sempre sobre coleção de localizações do imóvel — hoje `[property.location_id]`, no futuro `[loc1, loc2, loc3]` sem alterar o algoritmo.

---

## Testes permanentes

- `geo-parser.test`
- `geo-parser.cross-channel.test`
- `matching-engine.geo.test`
- Guarda estática que impede qualquer comparação textual de localização.

---

## Critério de conclusão

- única biblioteca geográfica, único parser, único `LocationRepository`, único pipeline, único componente de seleção, único motor;
- todas as localizações armazenadas como IDs;
- motor deixa definitivamente de comparar texto;
- mesmo input → mesmo resultado em qualquer canal;
- correções da Revisão reutilizadas via biblioteca de aliases;
- `geo_id`/IDs imutáveis; alterações estruturais apenas exigem incremento de `geo_library_version` e eventual `backfillLocations()`, sem alterar o motor;
- suite de regressão verde.

## Princípios arquiteturais permanentes

Uma fonte de verdade, uma biblioteca, um repositório, um parser, um pipeline, um componente de seleção. Parser nunca altera dados nem toma decisões de negócio. Motor nunca interpreta texto — trabalha exclusivamente sobre entidades estruturadas. Aprendizagem sempre explícita e auditável. Nenhum canal pode implementar lógica geográfica própria.

## Fora do âmbito

- Fuzzy Matching.
- Outras especializações do `EntitySelector`.
- Alterações ao `search-acceptance.ts`.
- Alterações ao `bedrooms-normalize.ts`.
