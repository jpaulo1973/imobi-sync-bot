# Sprint — Dados Estruturados e Inteligência Geográfica (Versão Final Aprovada)

## Objetivo

Eliminar definitivamente o texto livre como fonte de verdade para localização.

Criar uma infraestrutura geográfica única, reutilizável e permanente para todo o Property Match. Após esta sprint passará a existir: uma única biblioteca geográfica, um único parser, um único componente de seleção, um único pipeline de ingestão, um único motor de matching e um único modelo interno baseado em IDs. Toda a aplicação utilizará obrigatoriamente esta arquitetura.

## Decisões arquiteturais aprovadas

- Desenvolvimento em 3 fases (Fundação → Pipeline → Motor).
- `EntitySelector` minimalista.
- `LocationSelector` como primeira especialização.
- Parser totalmente determinístico.
- Fuzzy Matching fora desta sprint.
- Nenhuma implementação paralela de localização será permitida após esta sprint.

---

## Fase A — Fundação de Dados

### 1. Biblioteca geográfica — `locations`

Campos: `id`, `slug`, `nome`, `tipo`, `parent_id`, `aprovado`, `created_at`, `updated_at`.

Tipos: `distrito`, `concelho`, `freguesia`, `zona_funcional`.

### 2. Relações geográficas

Não utilizar arrays dentro de `locations`. Criar tabelas relacionais.

**`location_relations`** — `from_location_id`, `to_location_id`, `relation_type` (`parent | child | adjacent | nearby | contains`).

**`functional_zone_members`** — `functional_zone_id`, `location_id`. Cada zona funcional passa a ser um conjunto de localizações.

### 3. Biblioteca de aliases — `location_aliases`

Campos: `alias_normalizado`, `location_ids`, `origem`, `aprovado`, `created_by`, `created_at`, `updated_at`.

Métricas: `times_used`, `last_used_at`.

### 4. Metadados — `location_metadata`

Preparada para evolução futura (código INE, latitude, longitude, centroide, bounding box, NUTS, população, área, código postal). Não é necessário preencher nesta sprint.

### 5. Alterações às tabelas

- **`active_searches`** — `location_ids uuid[]`, `audit_geo jsonb`. Novo estado `pending_geo` — enquanto existir, a procura não entra no motor.
- **`buyer_clients`** — `location_ids uuid[]`.
- **`properties`** — `location_id uuid`.

Embora nesta fase cada imóvel possua apenas uma localização principal, toda a arquitetura (`LocationRepository`, parser e motor) deve ser implementada permitindo futura evolução para relação N:N (`property_location_relations`) sem alterar a lógica do motor.

O motor nunca deve assumir internamente que um imóvel possui apenas uma localização — deve trabalhar sempre sobre uma coleção, mesmo que hoje contenha um único elemento.

- Hoje: `[property.location_id]`
- Futuro: `[loc1, loc2, loc3]` — sem alterar o algoritmo.

### 6. Seed inicial

Popular automaticamente: distritos, concelhos, freguesias, zonas funcionais, relações e aliases conhecidos (Alverca, Costa, Expo, Lx, Margem Sul, Grande Lisboa, Linha de Cascais, Lisboa 30 min, Lisboa 20 km, etc.).

---

## Fase B — Parser, UI e Pipeline

### 1. Biblioteca

Criar `src/lib/geo/` com: `geo-types`, `geo-context`, `geo-parser`, `location-repository`.

### 2. LocationRepository

Toda a aplicação utiliza exclusivamente o `LocationRepository`. API mínima:

- `search()`
- `resolve()`
- `getById()`
- `getChildren()`
- `getAdjacent()`
- `getCoverage()`

Nenhum componente consulta diretamente a base de dados.

### 3. Parser — `parseLocations(text, context)`

Função pura. Nunca grava dados, cria aliases, altera informação, nem depende da UI ou de React.

Pipeline: divisão por conectores → normalização → alias → slug → freguesia → concelho → distrito → zona funcional → `unresolved`. Sem fuzzy.

Retorno: `resolved`, `aliases_used`, `unresolved`, `audit_trail`, `confidence`. `confidence` fica preparado para futuras evoluções.

### 4. Server Functions

Criar: `searchLocations()`, `resolveLocationText()`, `promoteAlias()`, `updateSearchLocations()`.

### 5. EntitySelector

Componente base reutilizável. Primeira especialização: `LocationSelector`. Não implementar ainda: tipologias, características, proximidade, certificados.

### 6. Utilização obrigatória

Substituir todos os campos texto por `LocationSelector` em: Revisão, Compradores, Imóveis, Active Searches, Radar, Importação Manual. Nenhum campo de localização poderá continuar a utilizar texto livre.

### 7. Pipeline único

Todos os canais utilizam exatamente o mesmo fluxo:

```
Canal → parseLocations() → resolved → location_ids → Motor
                        └→ unresolved → pending_geo → Revisão
```

Aplica-se a: Excel, WhatsApp, PDF, API, Manual, `extractAndMatch`.

### 8. Revisão inteligente

A Revisão passa a apresentar: texto original → resultado do parser → aliases utilizados → localizações → IDs → motivo → decisão → "Guardar Alias?".

Se o utilizador escolher "Guardar esta interpretação", executar `promoteAlias()`. Aprendizagem sempre explícita, nunca automática.

### 9. Backfill

Executar sobre `properties`, `buyer_clients`, `active_searches`. Popular `location_id` / `location_ids`. Tudo o que não puder ser resolvido fica `pending_geo`.

---

## Fase C — Motor

Reescrever completamente o matching. Nunca comparar texto. Comparar apenas IDs.

Comparações suportadas:

- Match direto
- Relações parent/child
- Zona funcional
- Adjacência

Eliminar definitivamente: `KNOWN_CONCELHOS`, `ADJACENT`, `.includes()`, `.toLowerCase()` sobre campos de zona. Toda a lógica geográfica passa a viver exclusivamente na biblioteca geográfica.

---

## Testes permanentes

Criar: `geo-parser.test`, `geo-parser.cross-channel.test`, `matching-engine.geo.test`.

Adicionar guarda estática que impede qualquer comparação textual de localização.

---

## Critério de conclusão

- existir uma única biblioteca geográfica;
- existir um único parser;
- existir um único componente de seleção;
- existir um único pipeline;
- existir um único motor;
- todas as localizações forem armazenadas como IDs;
- o motor deixar definitivamente de comparar texto;
- o mesmo input produzir exatamente o mesmo resultado em qualquer canal;
- as correções efetuadas na Revisão forem automaticamente reutilizadas através da biblioteca de aliases;
- toda a suite de regressão estiver verde.

## Fora do âmbito

- Fuzzy Matching.
- Outras especializações do `EntitySelector`.
- Alterações ao `search-acceptance`.
- Alterações ao `bedrooms-normalize`.

Esses módulos permanecem inalterados e serão tratados em sprints próprias.
