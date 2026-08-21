# Release 1.3.2 — Apagar procura + Tipo de negócio editável na Revisão

## Conflito a validar antes de construir (item 2)

O desenho pede o seletor com "comprador / arrendatário / trespasse". Na base de dados o campo `criteria.finalidade` só tem dois valores reais (`venda` = 839 linhas, `arrendamento` = 29) mais o sentinela `indefinido`, e o motor (`finalidadeFilter`) compara `finalidade` da procura com a `finalidade` do imóvel (`venda`/`arrendamento`). **"Trespasse" não é finalidade — é uma categoria da taxonomia** (`property-taxonomy.ts` → `trespasses`), já editável no bloco "Tipo de imóvel (categorias)" do editor.

Recomendação: o seletor grava `venda | arrendamento | indefinido` com etiquetas "Comprador", "Arrendatário", "Indefinido". Trespasse continua a ser tratado como categoria. Adicionar "trespasse" a `finalidade` obrigaria a mexer no filtro do motor e nos imóveis (que nunca têm essa finalidade) → todos os matches de trespasse passariam a falhar. Confirma esta leitura; o resto do plano assume-a.

## 1. Apagar procura (permanente)

### Migração (nova RPC SECURITY DEFINER)

`admin_delete_search(p_id uuid, p_apply boolean default false) returns jsonb`, no molde de `admin_merge_duplicate_group`:

- `SET search_path = public`, `SECURITY DEFINER`, primeira instrução `IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Sem permissões de administrador.'`.
- Modo simulação (`p_apply = false`): devolve contagens de dependentes sem apagar.
- Modo aplicação, nesta ordem exata (igual a `purge_expired_searches_exec`):
  1. `match_notifications` onde `buyer_source='search' AND buyer_ref = p_id`
  2. `match_states` onde `buyer_source='search' AND buyer_ref = p_id`
  3. `match_opportunities` onde `active_search_id = p_id`
  4. `active_searches` onde `id = p_id`
- Devolve `jsonb`: `{ aplicado, encontrada, nome, origem, notificacoes_removidas, estados_removidos, oportunidades_removidas, apagada }`.
- Não toca em `buyer_clients`, `profiles`, `properties`, `contacts` nem noutras procuras.
- `GRANT EXECUTE ... TO authenticated;` (o guard interno faz a autorização).

### Server function

`src/lib/review.functions.ts` — nova `deleteReviewSearch` (padrão de `discardSearches`, linha ~1156): `createServerFn({method:"POST"})` + `requireSupabaseAuth`, `inputValidator` com `{ id: uuid, apply: boolean default false }`, `assertAdmin(supabase, userId)` (defesa dupla) e `supabase.rpc("admin_delete_search", { p_id, p_apply })`. Devolve o jsonb tipado como `DeleteSearchResult`.

### UI

`src/components/review/SearchEditSheet.tsx`:
- Botão `variant="destructive"` "Apagar procura" no rodapé, separado dos dois botões de gravar.
- `AlertDialog` (`@/components/ui/alert-dialog`) com resumo do impacto obtido pela chamada em modo simulação (`apply:false`) ao abrir o diálogo: nome, origem, nº de oportunidades/notificações/estados que serão removidos, e aviso "ação permanente".
- Confirmar → chama com `apply:true`, `toast.success`, `onClose()` e novo callback `onDeleted(id)`.

`src/routes/_authenticated/revisao.tsx`: passa `onDeleted` para remover o item das listas em memória (mesmo tratamento já usado após descartar) e invalidar as queries da Revisão.

`src/integrations/supabase/types.ts`: regenerado automaticamente com a nova função.

## 2. Tipo de negócio editável

- `SearchEditSheet.tsx`: `FormState` ganha `finalidade: "venda" | "arrendamento" | "indefinido"`; `toFormState` lê `d.criteria.finalidade ?? "indefinido"`; `buildUpdatePayload` só inclui `criteria.finalidade` quando difere do inicial (mesma disciplina de diff dos restantes campos).
- Controlo: três botões toggle (mesmo padrão visual das categorias) ou `Select` — Comprador / Arrendatário / Indefinido, colocado no topo do formulário, antes das categorias.
- Nenhuma alteração no backend: `CriteriaPatch` (review.functions.ts:70) já aceita `finalidade: z.enum(["venda","arrendamento","indefinido"])`, e o `updateReviewSearch` já recalcula `dedup_key` com a nova finalidade e recruza quando `resolve=true`. Sem migração, sem alteração de schema.

## Testes

Novos (`src/lib/review-edit.test.ts`, puros):
1. Alterar finalidade envia `{ criteria: { finalidade: "arrendamento" } }` e nada mais.
2. Não tocar na finalidade não a envia (protege as 839 linhas `venda`).
3. `toFormState` mapeia `finalidade: null` → `"indefinido"`.
4. Finalidade + área alteradas em conjunto → ambos no mesmo patch (um só write/recompute).

Novo `supabase/tests/delete_search_regression.sql` (molde de `merge_duplicates_regression.sql`):
5. Não-admin → exceção.
6. Simulação não apaga nada e devolve contagens corretas.
7. Aplicação remove a procura + os 3 tipos de dependentes.
8. Uma procura vizinha do mesmo utilizador, com as suas oportunidades/notificações, fica intacta.
9. `id` inexistente → `encontrada:false`, sem erro.

Não-regressão: suite completa (`bunx vitest run`, 291 testes atuais) + `bunx tsgo --noEmit`; confirmar que os 6 testes existentes de `review-edit.test.ts` continuam a passar com o novo campo no `FormState`, e que `search-acceptance` / `matching-engine` não são afetados.

## Fora de âmbito

Apagar em lote na lista da Revisão, lixeira/undo, e qualquer alteração ao `finalidadeFilter` do motor.
