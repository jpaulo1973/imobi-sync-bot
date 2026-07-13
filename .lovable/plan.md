
# Release 1.3 — Colaboração Inteligente e Estabilidade Operacional

Implementar apenas o que está descrito abaixo. Preservar Hard Filters 1.2.1, motor de scoring, Privacy Layer e schema existente sempre que possível.

---

## 1. Bugs

### 1.1 Nome do consultor sempre "jpaulo73"

- Causa: em `active_searches` a coluna `consultor_nome` foi preenchida no passado com um valor fixo e o Privacy Layer usa `search.consultor_nome` como fallback (`opportunity-privacy.ts` L168). Além disso `loadConsultorMeta` só lê `profiles.full_name` (sem `agency`).
- Correção:
  - `sanitizeSearchForViewer` passa a usar **exclusivamente** `consultor?.nome` (obtido via `loadConsultorMeta(owner_id)`), ignorando o campo legado. Mesmo tratamento para `sanitizeBuyerForViewer` e `sanitizePropertyForViewer`.
  - `loadConsultorMeta` passa a devolver também `agency` (novo campo da meta) via `profiles.agency`.
  - Em `property-match.functions.ts` e `buyer-opportunities.functions.ts` remover os fallbacks `?? q.consultor_nome` / `?? q.consultor_telefone`. A fonte única é `loadConsultorMeta`.
  - Migração leve: definir `active_searches.consultor_nome/telefone` como *deprecated* (mantidos por compatibilidade; nunca lidos daqui em diante). Sem alterações destrutivas.

### 1.2 Botão "Oportunidades" ignora WhatsApp/Excel

- Verificado: `countPropertyOpportunities` já inclui `buyer_clients` + `active_searches` (Excel/WhatsApp). O botão em `imoveis.tsx` está a mostrar `countPropertyMatches` (só `buyer_clients`).
- Correção: no card do imóvel usar `countPropertyOpportunities` como fonte única; `countPropertyMatches` deixa de ser chamado pela UI (mantém-se exportado). O drawer já usa `runPropertyOpportunities` (unificado).

---

## 2. Estado por Match (Imóvel ↔ Comprador)

Nova tabela `match_states` (uma entrada por par):

```
id uuid pk
user_id uuid    -- dono do imóvel (quem gere o estado)
property_id uuid not null
buyer_source text not null check in ('cliente','search')
buyer_ref uuid not null              -- buyer_clients.id OU active_searches.id
state text not null check in ('novo','contactado','nao_interessado')
updated_at timestamptz
unique (property_id, buyer_source, buyer_ref)
```

- Grants + RLS: `authenticated` faz CRUD apenas onde `user_id = auth.uid()`; `service_role` ALL.
- `runPropertyOpportunities`: faz LEFT JOIN em memória com `match_states` e:
  - anexa `state` ("novo" por defeito) e `state_updated_at` a cada oportunidade;
  - filtra fora as marcadas `nao_interessado` da lista ativa (mas conta-as num `hiddenCount` devolvido).
- `countPropertyOpportunities`: subtrai `match_states` com `state='nao_interessado'` do par respectivo.
- Novo `updateMatchState({ propertyId, buyerSource, buyerRef, state })` server fn (upsert; verifica ownership do imóvel via RLS).
- UI drawer de oportunidades em `imoveis.tsx`: cada linha ganha selector "Novo / Contactado / Não interessado" + toggle "Mostrar dispensados".
- Regras:
  - Estado pertence ao par → não afeta outros imóveis nem elimina o comprador.
  - Comprador continua elegível para outros imóveis compatíveis (é só uma linha em `match_states`).
  - Não expira: se o buyer sair da base (30 dias Excel/WhatsApp), a linha é irrelevante.

Fora de âmbito nesta release: exposição do estado no lado do comprador (radar/clientes) — o estado é interno do angariador.

---

## 3. Contacto entre Consultores

Componente novo `<ConsultorContactActions>` reutilizado em: drawer de oportunidades do imóvel, drawer de compradores compatíveis (radar/clientes), lista de matches WhatsApp.

Dois botões:
- **WhatsApp** — abre `https://wa.me/<telefone_normalizado>` (sem mensagem pré-preenchida). Desativado se sem telefone.
- **Contacto** — abre popover/dialog **apenas de leitura** com Nome, Telemóvel, Email e Agência (quando disponíveis). Não inicia chamada nem `tel:` link.

Fonte de dados: `loadConsultorMeta(owner_id)` (ver §1.1) — devolve `{ nome, telefone, email, agency }`. Aplicado sempre via Privacy Layer.

Remover / substituir qualquer botão actual que abra `tel:` a partir de oportunidades entre consultores. Contactos directos do próprio cliente do consultor (compradores manuais próprios) mantêm o comportamento actual.

---

## 4. Modo de Manutenção

Nova tabela `app_settings` (key/value simples, singleton):

```
key text pk
value jsonb
updated_at timestamptz
updated_by uuid
```

- Seed: `('maintenance', '{"enabled": false, "message": null}')`.
- RLS: SELECT para `authenticated`; UPDATE apenas se `has_role(auth.uid(),'admin')`.
- Server fns em novo `src/lib/maintenance.functions.ts`:
  - `getMaintenanceStatus()` — público (authenticated), devolve `{ enabled, message }`.
  - `setMaintenanceMode({ enabled, message? })` — admin only (verifica `has_role`).
- Middleware de gate: novo `requireMaintenanceOpen` (server fn middleware) que, para chamadas **não-admin**, lê `getMaintenanceStatus` (cache curto em memória por request) e devolve 503 com `{ maintenance: true }`. Aplicado a todas as server fns de negócio (imoveis, buyers, searches, matches, revisao). Admins passam sempre. Não aplicado a `getMaintenanceStatus`, auth, ou `admin.functions.ts`.
- UI:
  - Novo separador em `utilizadores.tsx` (ou nova página `/manutencao` admin-only) com toggle + textarea da mensagem + aviso claro.
  - Novo `MaintenanceGate` no `_authenticated/route.tsx`: em cada match consulta `getMaintenanceStatus` (via TanStack Query com `staleTime` curto); se `enabled && !isAdmin` mostra página cheia "Sistema em manutenção" com a mensagem. Admin continua a ver o resto da app com badge "Manutenção ativa".
  - Interceptor global de erros server-fn: se resposta `{ maintenance: true }`, força re-render do gate.

---

## Migração SQL (única)

1. `CREATE TABLE public.match_states (...)` + grants (`authenticated` CRUD, `service_role` ALL) + RLS scoped a `user_id`.
2. `CREATE TABLE public.app_settings (...)` + grants (SELECT `authenticated`, ALL `service_role`) + RLS (SELECT true, UPDATE admin).
3. Trigger `updated_at` em ambas.
4. Seed `app_settings` com `maintenance` desligado.
5. Sem alterações a `active_searches`/`buyer_clients`/`match_opportunities`/`properties`.

## Ficheiros

**Novos**
- `src/lib/match-states.functions.ts` — `updateMatchState`, `listMatchStates(propertyId)`.
- `src/lib/maintenance.functions.ts` — get/set + middleware `requireMaintenanceOpen`.
- `src/components/ConsultorContactActions.tsx` — botões WhatsApp / Contacto.
- `src/components/MaintenanceGate.tsx` — bloqueio full-page.
- `src/routes/_authenticated/manutencao.tsx` — painel admin (gate por `isCurrentUserAdmin`).
- Migração SQL.

**Alterados**
- `src/lib/opportunity-privacy.ts` — remover fallback `consultor_nome`; adicionar `agency` à meta.
- `src/lib/property-match.functions.ts` — usar só `loadConsultorMeta`; integrar `match_states`.
- `src/lib/buyer-opportunities.functions.ts` — mesmo tratamento de consultor (só meta); expor `agency`.
- `src/lib/active-searches.functions.ts` — deixar de ler `consultor_nome` legado para output.
- `src/routes/_authenticated/imoveis.tsx` — substituir `countPropertyMatches` por `countPropertyOpportunities`; drawer com selector de estado, filtro "Dispensados", `ConsultorContactActions`.
- `src/routes/_authenticated/radar.tsx` e `clientes.tsx` — usar `ConsultorContactActions` no lado dos compradores compatíveis.
- `src/routes/_authenticated/_authenticated.tsx` (layout) — montar `MaintenanceGate`.
- Server fns de negócio — anexar middleware `requireMaintenanceOpen`.

## Fora de Âmbito

- Estado do match visível ao lado do comprador.
- Notificações push/email para mudanças de estado ou manutenção.
- Auditoria de mudanças de estado.
- Motor de interpretação WhatsApp / OCR / classificação (Release seguinte).

## Acceptance Criteria

- Nome/telefone/email/agência do consultor exibidos correspondem ao dono real da procura/imóvel; "jpaulo73" nunca aparece a menos que seja de facto o dono.
- Card do imóvel mostra contagem incluindo Excel + WhatsApp + manuais.
- Marcar "Não interessado" remove o par apenas do imóvel visado; comprador reaparece noutro imóvel compatível; "Mostrar dispensados" reexibe-o.
- Botão WhatsApp abre conversa correta; botão Contacto mostra dados sem iniciar chamada.
- Modo manutenção: não-admins veem página de manutenção e todas as server fns respondem `maintenance:true`; admin continua a operar; desligar restaura acesso imediato.
