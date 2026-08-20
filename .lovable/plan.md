# Fusão de duplicados: seleção por subconjunto

## Objetivo
No painel "Duplicados existentes", deixar de assumir que uma fusão abrange o grupo inteiro. O administrador escolhe **quais** procuras entram na fusão (checkboxes) e, entre essas, **qual fica**.

Caso real: "Sandra de Sousa Alves" tem uma procura T2 (Amial/Prelada) e várias T3+1/T4 (Antas). Mesma pessoa, mesmo telefone, necessidades diferentes — só as T3+1/T4 devem fundir entre si.

## Comportamento

- Cada membro do grupo passa a ter **checkbox** (todas marcadas por defeito) + **rádio "fica"** ativo apenas nos membros marcados.
- O membro marcado como "fica" nunca pode ser desmarcado sem que a escolha salte para outro marcado (regra: se desmarcar o escolhido, o "fica" passa para o primeiro marcado restante).
- Botão "Fundir no selecionado" fica desativado se houver menos de 2 marcadas (nada a fundir).
- Contagem visível no botão/legenda: "vão ser apagadas N procura(s)" = marcadas − 1.
- Procuras **desmarcadas** não são tocadas: continuam no painel após a fusão, disponíveis para nova fusão ou para "Manter separadas".
- Depois de fundir um subconjunto, o grupo é **recarregado/atualizado localmente** em vez de removido: se sobrar ≥ 2 membros (a mantida + as desmarcadas) o grupo permanece visível; se sobrar 1, desaparece.
- "Manter separadas" mantém-se ao nível do grupo inteiro (sem alteração).

## Simulação e confirmação
Sem alteração de contrato: a simulação já recebe `keep_id` + `remove_ids`. Passa a receber apenas os **IDs marcados** (menos o mantido), pelo que o diálogo mostra exatamente o subconjunto — contagens de oportunidades, notificações, estados e amostra. O texto do diálogo passa a dizer explicitamente que as procuras não incluídas ficam inalteradas.

## Detalhes técnicos
- Ficheiro alterado: `src/components/DuplicatesPanel.tsx` apenas.
- Estado novo: `selected: Record<groupKey, Set<memberId>>` inicializado com todos os membros ao carregar; `keep` mantém-se e é validado contra `selected`.
- `removeIdsOf(g, keepId)` passa a filtrar por `selected[g.key]`.
- Após aplicar: em vez de `filter(x => x.key !== grupo.key)`, remover das membros do grupo os IDs fundidos e descartar o grupo se ficar com < 2 membros; recalcular `excedentes` e o total.
- Sem alterações na RPC `admin_merge_duplicate_group`, nas server functions (`src/lib/duplicates.functions.ts`) nem nos testes SQL — já operam sobre listas explícitas de IDs.
