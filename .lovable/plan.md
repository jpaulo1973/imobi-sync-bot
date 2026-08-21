# Correção: "compradores compatíveis" = 0 em imóveis de outros consultores

## Problema
`countPropertyOpportunities` calcula contagens só para imóveis com `user_id` = sessão. A vista de Imóveis do Admin lista imóveis de todos os donos, e a UI faz `matchCounts[p.id] ?? 0` — logo, imóveis de terceiros mostram "0" por ausência de chave, não por cálculo. Hoje: 4 imóveis (C0440-00927, C0440-00951, C0440-01027, C0440-01028).

## Regra de negócio a fixar
A contagem de um imóvel é feita **na perspetiva do dono real do imóvel**:
- compradores próprios (`buyer_clients`) do `user_id` da linha do imóvel;
- mais toda a Base Global de `active_searches` (já é global hoje);
- descartes (`match_states` = `nao_interessado`) continuam a ser aplicados apenas aos pares do utilizador da sessão, porque esses estados são pessoais e não são legíveis para outros consultores.

Para o Consultor não há mudança: o conjunto de imóveis que vê continua a ser o seu, e os compradores usados continuam a ser os seus.

## Onde mexer

1. **Novo módulo puro `src/lib/property-match-counts.ts`**
   - `countMatchesForProperties({ properties, buyersByOwner, searches, geoIndex, dismissed })` → `Record<propertyId, number>`.
   - Move para aqui a lógica atual do loop (dedup por identidade via `buyerIdentityKey`, melhor score por identidade, `criteriaToBuyer` para procuras).
   - Módulo sem `createServerFn`, portanto testável em isolamento.

2. **`src/lib/property-match.functions.ts` (`countPropertyOpportunities`, linhas ~378-448)**
   - Substituir `supabase.from("properties").select("*").eq("user_id", userId)` por `poolProperties()` (mesma fonte global que a página já usa), mantendo apenas `ativo`.
   - Substituir a query de `buyer_clients` filtrada pela sessão por `poolBuyerClients()` e agrupar por `user_id` num `Map<string, Buyer[]>`.
   - Para cada imóvel, usar `buyersByOwner.get(p.user_id) ?? []`.
   - Manter `match_states` como está (filtrado por `userId`), documentando a limitação em comentário.
   - `totalBuyers` devolvido passa a ser o nº de compradores **do utilizador da sessão** (mantém o significado atual na UI); `totalGlobal` inalterado.
   - Handler fica um wrapper fino: carrega dados, constrói `geoIndex`, delega no módulo puro.

3. **`src/routes/_authenticated/imoveis.tsx`** — sem alterações de lógica. Opcionalmente distinguir "sem cálculo" de "0", mas não é necessário depois da correção.

## Impacto noutros ecrãs
`countPropertyOpportunities` é chamado apenas em `src/routes/_authenticated/imoveis.tsx:216`. Nenhum outro ecrã afetado. `countBuyerOpportunities` (Clientes) e `runPropertyOpportunities`/`auditPropertyMatches` (ficha do imóvel) ficam intactos — estes últimos já operavam sobre a Base Global e por isso já mostravam o número real (os 15 do caso C0440-00927).

## Custo
O cálculo passa a percorrer todos os imóveis ativos da base (45 hoje) em vez de só os do utilizador; o `geoIndex` continua a ser construído uma única vez. Sem novas queries por linha.

## Plano de testes
Novo `src/lib/property-match-counts.test.ts`:
1. **Caso do bug**: imóvel com `user_id` ≠ sessão, com compradores compatíveis do seu próprio dono → contagem > 0 (falharia com a implementação atual).
2. Imóvel do dono A não recebe contagem de compradores do dono B (isolamento por dono).
3. Imóvel próprio: comportamento igual ao atual (mesma contagem que antes).
4. Dedup por identidade: dois compradores com o mesmo telefone/nome contam como 1.
5. `match_states` = `nao_interessado` do utilizador da sessão continua a excluir o par.
6. Procuras (`active_searches`) globais contam para imóveis de qualquer dono.

Validação final: suite completa (`bunx vitest run`) e typecheck `bunx tsgo --noEmit`, mais verificação manual na vista de Imóveis do Admin de que os 4 imóveis passam a mostrar um número real.
