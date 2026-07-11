# Release 1.2 — Colaboração Inteligente + Motor Geo Funcional

Matches visíveis para ambos os lados, privacidade decidida no servidor, motor geo com zonas funcionais e estrutura para proximidade. Sem alterar scoring, tolerâncias, Hard Filters 1.2.1 ou schema de `match_opportunities`.

---

## 1. Visibilidade Bidirecional

`match_opportunities` continua fonte única.

- **Angariador** (`property-match.functions.ts`): comportamento atual preservado; toda a saída passa pelo Privacy Layer.
- **Comprador** — novo `src/lib/buyer-opportunities.functions.ts`:
  - `runBuyerOpportunities({ buyerId })` — lê o buyer via RLS (só o dono), corre o **mesmo** motor + Hard Filters 1.2.1 contra `properties` da base global via `supabaseAdmin`, devolve DTO sanitizado com contactos do angariador.
  - `countBuyerOpportunities()` — mapa `buyerId → count` para as badges.

UI:
- `clientes.tsx` — badge **"Imóveis compatíveis (N)"** por linha e drawer **"Ver imóveis compatíveis"**.
- `radar.tsx` — novo bloco **"Os meus compradores"**, espelho exato de "Os meus imóveis".

Contactos sempre entre consultores.

## 2. Privacy Layer (server-only)

Novo `src/lib/opportunity-privacy.ts` — obrigatório em qualquer server fn que devolva `buyers`, `active_searches` ou `properties`. Nenhuma linha bruta chega ao cliente.

Exports:
- `sanitizeBuyerForViewer(buyer, viewerId)`
- `sanitizeSearchForViewer(search, viewerId)`
- `sanitizePropertyForViewer(property, viewerId)`

Quando `viewerId !== owner_id`:

| Recurso | Devolve | Nunca devolve |
|---|---|---|
| Buyers / active_searches | critérios, score, resumo, comunidade, grupo_whatsapp, data_origem, consultor_nome/_email/_telefone | nome, telefone, email, notas, contact_*, `owner_id`/`user_id`, qualquer PII |
| Properties | tipologia, preço, área, localização, descrição pública, fotografias, consultor_nome/_email/_telefone | proprietário, telefone/email proprietário, notas privadas, `owner_id`/`user_id` |

Quando é o dono: comportamento atual (registo completo).

`property-match.functions.ts` e `active-searches.functions.ts` que exponham estes objetos passam a atravessar o sanitizador.

## 3. Gestão Interna dos Compradores

Reutiliza `buyer_clients.nome` e `.telefone`. Sem alteração de schema.
- `clientes.tsx`: badge **"Interno • Apenas visível para si"** junto a Nome e Telefone (lista + formulário).
- `sanitizeBuyerForViewer` remove sempre estes campos para viewers externos.

## 4. Motor Geo Funcional

Nova tabela `functional_zones`:

```
id uuid pk
nome text unique
aliases text[]
coverage jsonb              -- { freguesias: text[], municipios: text[] }
approved boolean default true
created_by uuid
created_at, updated_at
```

Grants: `SELECT` a `authenticated`; escrita apenas admins via `has_role(auth.uid(),'admin')` na policy.

Novo `src/lib/functional-zones.ts` (helpers puros, sem `createServerFn` no ficheiro — respeita `tss-serverfn-split`):
- `resolveZone(input, ctx?): { freguesias[], municipios[], source: "admin"|"functional"|"unknown", unknown }`
- Fluxo: administrativo → funcional (`nome` ou `aliases[]` normalizados) → `unknown` sinaliza `flagged_for_review` motivo `zona_desconhecida`.

`matching-engine.ts` — filtro de localização aceita imóvel cuja freguesia ou concelho pertença à `coverage`. Regras estritas 1.2.1 mantêm-se para procura freguesia-administrativa.

`search-splitter.server.ts` — ao extrair `zona`, chama `resolveZone`; se `unknown`, mantém texto e sinaliza para Revisão.

## 5. Revisão Administrativa

`revisao.tsx` — novo separador **"Zonas por Aprovar"**:
- Agrupada por expressão normalizada com número de ocorrências.
- **Criar Zona Funcional** (modal: nome, aliases, freguesias, municípios) → insert em `functional_zones` → limpa flag apenas dos registos afetados → recruza apenas esses registos.
- **Ignorar** — limpa flag sem criar zona.

Endpoints em `review.functions.ts`: `listUnknownZones`, `createFunctionalZoneFromReview`, `recruzarZonaAffected`.

Nunca recruzar a base toda.

## 6. Critérios de Proximidade (estrutura + parser)

Novo campo `proximity jsonb` em `active_searches` e `buyer_clients`:

```json
[{ "poi": "aeroporto_lisboa", "minutes": 20 }]
```

- **Parser** em `search-splitter.server.ts` — regex determinística + mapa de POIs conhecidos (aeroporto Lisboa/Porto, centro Lisboa/Porto). Preenche `proximity[]` e não alimenta `zona`.
- **Motor** — novo `proximityFilter` **nunca** elimina nem confirma; devolve reason **"Critério de proximidade ainda não validado"**.
- Cálculo real de tempos fica fora de âmbito.

## 7. Melhorias do Motor

- Cache in-request de `resolveZone` (Map propagado no contexto do matching).
- Normalização única via `normalizeLocation`.
- Aliases geográficos aplicados aos dois lados.
- Log interno conciso das decisões descartadas (sem UI).
- Zero mudanças em scoring, tolerâncias e Hard Filters 1.2.1.

## 8. Segurança

- `supabaseAdmin` só dentro de server fns; resultado sempre sanitizado antes de sair.
- Nunca expor `owner_id`, `user_id` ou PII de terceiros.
- `functional_zones` — leitura authenticated, escrita restrita a admin via RLS.
- RLS existente de `properties`/`buyer_clients`/`active_searches` mantém-se.

---

## Migração SQL (única)

1. `CREATE TABLE public.functional_zones (...)` + trigger `updated_at`.
2. `GRANT SELECT ON public.functional_zones TO authenticated; GRANT ALL TO service_role`.
3. Enable RLS + policies: `SELECT USING (true)`; `INSERT/UPDATE/DELETE` com `has_role(auth.uid(),'admin')`.
4. `ALTER TABLE public.active_searches ADD COLUMN proximity jsonb`.
5. `ALTER TABLE public.buyer_clients ADD COLUMN proximity jsonb`.
6. Motivo `zona_desconhecida` (campo `decision_reason` é texto livre — só documentação).
7. Seed: Grande Lisboa, Margem Sul, Linha de Cascais, Linha de Sintra, Expo/Parque das Nações, Baixa de Lisboa, Zona Ribeirinha, Grande Porto, Costa da Caparica, Oeste.

## Ficheiros

**Novos**: `src/lib/opportunity-privacy.ts`, `src/lib/buyer-opportunities.functions.ts`, `src/lib/functional-zones.ts`, migração SQL.

**Alterados**: `src/lib/property-match.functions.ts`, `src/lib/matching-engine.ts`, `src/lib/location-graph.ts`, `src/lib/search-splitter.server.ts`, `src/lib/active-searches.functions.ts`, `src/lib/review.functions.ts`, `src/routes/_authenticated/radar.tsx`, `src/routes/_authenticated/clientes.tsx`, `src/routes/_authenticated/revisao.tsx`.

## Acceptance Criteria

- Consultor do comprador vê todos os imóveis compatíveis.
- Consultor da angariação continua a ver todos os compradores compatíveis.
- Nenhum consultor consegue ver PII de clientes de outro consultor.
- Zonas funcionais reconhecidas produzem matches corretamente.
- Zona desconhecida vai automaticamente para Revisão.
- Aprovar zona funcional recruza apenas registos afetados.
- Matches existentes permanecem compatíveis com 1.2.1.

## Fora de Âmbito

Motor de Interpretação de WhatsApp, classificação procura vs oferta, OCR, extensão WhatsApp Web, cálculo real de tempos, notificações push/email, novos campos internos em compradores.
