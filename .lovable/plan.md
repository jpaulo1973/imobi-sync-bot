# Correção do "Fundir no selecionado" (Duplicados existentes)

Objetivo: tornar a fusão de duplicados uma ação previsível e auditável — simular primeiro,
confirmar depois, e não deixar lixo a apontar para procuras apagadas.

Mantém-se intencionalmente: só o conteúdo da procura selecionada sobrevive (sem fusão de
critérios), e a ação continua a ser grupo a grupo (sem ação em bloco).

## 1. Nova função de base de dados (SECURITY DEFINER)

`admin_merge_duplicate_group(p_keep_id uuid, p_remove_ids uuid[], p_apply boolean)`

Motivo: hoje a fusão corre com as permissões do administrador via API. As notificações
têm política de admin, mas os **estados de match não têm** — um admin a fundir procuras de
outro consultor não consegue apagar esses estados, e ficariam órfãos de forma silenciosa.
A função centraliza a operação com o mesmo padrão já usado em `admin_purge_expired_searches`.

Comportamento:
- Valida que quem chama é administrador e que `keep_id` existe e não está na lista a remover.
- `p_apply = false` (Simular): não escreve nada; devolve contagens e amostra.
- `p_apply = true` (Aplicar): apaga, pela ordem, `match_notifications` e `match_states`
  (`buyer_source = 'search'` e `buyer_ref` nas procuras removidas), `match_opportunities`
  dessas procuras, e por fim as próprias procuras; incrementa `merged_from_count` na
  mantida e limpa `flagged_for_review`.

Devolve, em ambos os modos:
`{ aplicado, mantida, remover, oportunidades_removidas, notificacoes_removidas, estados_removidos, amostra }`
onde `amostra` lista, por procura a remover: nome, origem, data, nº de oportunidades e de notificações.

## 2. Server functions

Em `src/lib/duplicates.functions.ts`:
- `simulateMergeDuplicateGroup` — nova, chama a função acima com `p_apply = false`.
- `mergeDuplicateGroup` — passa a chamar a mesma função com `p_apply = true` em vez de
  fazer os `delete` diretos. Mantém o recruzamento da procura mantida (`recomputeForSearch`)
  no fim, como hoje.

## 3. Interface (`src/components/DuplicatesPanel.tsx`)

O botão "Fundir no selecionado" deixa de apagar de imediato:
1. Clicar → corre a simulação e abre um diálogo de confirmação.
2. O diálogo mostra: qual a procura que fica, quantas são apagadas, e quantas oportunidades,
   notificações e estados de match desaparecem — mais a lista das procuras a remover.
3. Aviso claro de que a ação é definitiva e não reversível.
4. Só o botão "Fundir definitivamente" aplica. "Cancelar" não grava nada.

O botão "Manter separadas" fica como está.

## 4. Testes

Novo teste de regressão SQL (`supabase/tests/merge_duplicates_regression.sql`), no mesmo
formato dos existentes:
- cria duas procuras da mesma pessoa, com oportunidades, notificações e estados em ambas;
- corre em modo Simular → confirma que **nada** foi apagado e que as contagens devolvidas
  correspondem à realidade;
- corre em modo Aplicar → confirma que a procura mantida sobrevive e que **não sobra
  nenhuma notificação nem estado** a apontar para as procuras removidas (o caso do órfão);
- confirma que `merged_from_count` foi incrementado.

Mais um teste unitário para a construção do resumo apresentado no diálogo.

## Notas

- Sem alterações ao motor de match, à deduplicação da importação ou a qualquer outro painel.
- A função antiga não é removida do código; é a mesma server function, com o interior a
  passar pela nova função de base de dados.
