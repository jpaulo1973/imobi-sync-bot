# Correção de nome em lote na Revisão (`nome_novo`)

Adicionar ao ficheiro de exportação/reimportação da Revisão uma coluna `nome_novo`, ao lado de `telefone_novo`, para corrigir o nome do contacto em lote — com a aprendizagem em `contacts` a usar sempre o nome já corrigido.

## 1. Impacto medido no lote atual (só leitura, hoje)

| Métrica | Valor |
|---|---|
| Linhas (procuras) na Revisão — telefone efetivo inválido | 56 |
| Grupos/linhas do ficheiro exportado | 53 |
| Grupos cujo nome traz ruído (agência, equipa, código, rótulo) | **25** (27 procuras) |
| Grupos com nome de pessoa aparentemente limpo | 28 |

Exemplos reais de nomes onde `nome_novo` seria aplicável: `Sofia Vaz C21N`, `Ângela Silva C21N5`, `Jorge humberto imobiliaria`, `Anabela Fonseca consultora Imobiliária`, `Joao Ferreira mais consultores`, `Predimed Like`, `Tiago Mixage Comprador`, `Baixa da Banheira` (nome de zona no campo de contacto).

Nota: os rótulos genéricos de grande volume (`club member`, `colega`, `item`) não aparecem neste lote porque essas procuras têm telefone válido e por isso não entram na Revisão. Continuam a ser corrigíveis por este mesmo caminho quando entrarem na lista, e são o motivo pelo qual o backfill de `contacts` os excluiu.

## 2. Ficheiro (exportação)

Nova coluna `nome_novo`, vazia, imediatamente depois de `nome` e antes de `telefone_atual`:

`id_linha | nome | nome_novo | telefone_atual | telefone_novo | email | agencia | procuras_afetadas | search_ids | exportado_em`

A leitura aceita `nome_novo` / `novo_nome` / `nome_corrigido` (tolerante a acentos e maiúsculas, como as restantes colunas).

## 3. Regras da reimportação

Por linha, com `search_ids` como chave (comportamento atual):

| `nome_novo` | `telefone_novo` | Efeito |
|---|---|---|
| vazio | preenchido | Comportamento atual, inalterado: grava telefone, aprende com o nome que está na base de dados |
| preenchido | vazio | Atualiza `contact_nome` das procuras e recalcula `dedup_key`; **não toca no telefone**; sem escrita em `contacts` (não há telefone para aprender) |
| preenchido | preenchido | Atualiza nome e telefone; a aprendizagem em `contacts` usa o **nome novo** |
| vazio | vazio | Linha ignorada (atual) |

Regras adicionais:
- `nome_novo` igual ao nome atual (comparado pela chave normalizada de contacto) → **nenhuma escrita**; a linha é reportada como "sem alteração de nome".
- `nome_novo` demasiado curto (menos de 2 caracteres úteis após normalização) → linha inválida, reportada, nada gravado.
- Uma linha só é resolvida (`flagged_for_review = false`) quando o telefone fica válido — corrigir apenas o nome mantém a procura na Revisão, como hoje.
- A `dedup_key` é recalculada por procura, com o telefone efetivo final e os critérios já gravados, usando a mesma `buildDedupKey` da correção individual.

## 4. Ordem de operações (ponto 3 do pedido)

A sequência por linha passa a ser explícita: **1)** gravar `contact_nome` + `dedup_key` → **2)** gravar telefone → **3)** aprender em `contacts` com `nome_novo ?? nome_na_bd`. Hoje a aprendizagem lê o nome do snapshot carregado antes das escritas, o que gravaria o par `nome antigo + telefone certo`; passa a receber o nome corrigido em memória, sem depender de nova leitura.

## 5. Testes de regressão

- `nome_novo` sozinho: atualiza `contact_nome` e `dedup_key`, telefone intacto, zero escritas em `contacts`.
- `telefone_novo` sozinho: idêntico ao comportamento atual, nome inalterado.
- Ambos: nome e telefone atualizados e o par aprendido em `contacts` usa o nome novo (assert explícito de que não usa o antigo).
- `nome_novo` igual ao atual (com acentos/caixa diferentes): nenhuma alteração.
- `nome_novo` inválido/vazio de conteúdo: linha reportada, nada gravado.
- Parser do ficheiro: cabeçalhos alternativos e coluna ausente (ficheiros antigos sem `nome_novo` continuam a funcionar).
- Suite completa (143 testes) continua verde.

## Detalhes técnicos

- `src/lib/review-export.ts`: `nome_novo` nos headers e larguras, alias de cabeçalho, `ParsedImportRow.nome_novo`, e o estado `pronto` passa a aceitar linha com só nome.
- `src/lib/review.functions.ts`: `bulkSetConsultorTelefone` passa a aceitar `{ linha, search_ids, telefone?, nome_novo? }` (telefone deixa de ser obrigatório) e devolve por linha também `nome_atualizado`. Reutiliza `buildDedupKey` e `saveContact`; sem service role key (continua no cliente autenticado com políticas de admin).
- `src/routes/_authenticated/revisao.tsx`: envia `nome_novo`, atualiza o texto de ajuda e o resumo de resultados.
- Sem alterações à base de dados nem ao motor de match. Fluxo do backfill de `contacts` não é tocado.
