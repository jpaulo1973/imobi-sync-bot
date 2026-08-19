# Backfill único da tabela `contacts` (regra restrita)

Semear `contacts` com os pares (nome, telefone) do histórico de `active_searches`, **apenas quando o nome normalizado tem um único telefone distinto em todo o histórico**. Nomes ambíguos não são escritos — são devolvidos numa lista para decisão manual.

## 1. Números confirmados (medidos na base de dados)

| Métrica | Valor |
|---|---|
| Linhas com nome + telefone válido (9 dígitos) | 2 570 |
| Nomes normalizados distintos | 920 |
| Nomes com **um único** telefone → elegíveis | **900** |
| Nomes com mais do que um telefone → excluídos | **20** |
| **Pares a semear em `contacts`** | **1 272** |
| Linhas de histórico cobertas por esses pares | 2 039 |
| Pares que ficariam de fora vs. plano anterior | 440 (1 712 → 1 272) |

O total é 1 272 (e não 900) porque o mesmo nome pode existir para consultores diferentes — `contacts` é por utilizador, e a chave é (utilizador, nome normalizado, telefone).

Estado atual de `contacts`: 8 registos (`origem='revisao'`). O backfill acrescenta os que faltam e reforça contadores dos existentes, sem sobrescrever telefone ou nome de exibição já gravados pela Revisão.

Exclusões automáticas: linha sem nome utilizável, sem telefone em nenhuma das duas colunas, telefone que normaliza para menos de 9 dígitos, ou nome que tenha mais do que um telefone distinto no histórico.

## 2. Regra única de segurança

**Um nome só é semeado se tiver exactamente um telefone distinto em todo o histórico.** Não há desempate por frequência nem por recência — a ambiguidade nunca é resolvida automaticamente.

Motivo (validado nos dados de hoje): a regra "mais frequente" erraria mesmo sem empate. `bernardo santos` e `cristina oliveira` têm dois telefones com emails de domínios diferentes (pessoas distintas), e em `rui ferreirinha` o número mais frequente é o que **não** tem email confirmado. Os rótulos genéricos `club member` (163 telefones), `colega` (50) e `item` (41) envenenariam o lookup com números de terceiros.

Consequência prática: para os nomes excluídos, uma importação sem telefone continua a cair na Revisão — comportamento actual, sem regressão.

## 3. O que o backfill faz

- Server function de administração invocada do painel de Manutenção: botão "Semear contactos do histórico", com contadores no fim (linhas lidas, pares semeados, pares reforçados, linhas ignoradas, nomes ambíguos excluídos).
- Lê `active_searches` em páginas (paginação já usada no backfill geográfico, para não truncar às 1 000 linhas).
- Por linha: nome = `contact_nome` ?? `consultor_nome`; telefone = `contact_telefone` ?? `consultor_telefone` (o mesmo "telefone efetivo" da deduplicação).
- Agrega em memória por (utilizador, nome normalizado, telefone); depois **descarta todos os nomes com mais de um telefone** e só então grava — uma escrita por par.
- `times_seen` = nº de procuras históricas do par; `last_seen_at` = data mais recente (`greatest(created_at, updated_at)`).
- Escrita via RPC `SECURITY DEFINER` (`contacts_upsert`) com `origem='backfill'`. **Não altera nenhuma coluna de `active_searches`.**

## 4. Relatório de nomes ambíguos (em vez de escrita)

A mesma função devolve, sem gravar nada, a lista dos nomes excluídos com: nome normalizado, nome como aparece no texto, cada telefone distinto, nº de procuras por telefone, primeira/última data, e as pistas disponíveis (emails de contacto distintos, zonas dos pedidos). Mostrada numa tabela no painel de Manutenção e exportável, para resolução manual caso a caso via Revisão → telefone novo.

## 5. Idempotência

Correr duas vezes não duplica: o índice único (utilizador, nome normalizado, telefone) força `ON CONFLICT DO UPDATE`. O upsert de backfill grava `times_seen` como valor **absoluto** (`GREATEST(existente, contagem_histórica)`) em vez de incrementar, e `last_seen_at` como o mais recente dos dois — segunda execução deixa a tabela byte-a-byte igual.

## 6. Testes de regressão

- Agregador puro: acentos/caixa diferentes e formatos PT distintos (`+351…`, `00351…`, `9…`) colapsam num único par.
- Nome com dois telefones (com e sem empate nas contagens) → **zero** escritas e uma entrada no relatório de ambíguos.
- Rótulo genérico com dezenas de telefones → excluído pela mesma regra, sem lista especial de nomes.
- Idempotência: aplicar duas vezes mantém nº de registos e `times_seen`.
- Linhas sem telefone ou com telefone curto contam como ignoradas e não escrevem.
- Suite existente (131 testes) continua verde.

## Detalhes técnicos

- Migração: `contacts_upsert` passa a aceitar `p_times_seen integer default null` e `p_last_seen_at timestamptz default null`; com valores presentes aplica-os em absoluto, sem eles mantém o `times_seen + 1` actual (importação e Revisão inalteradas).
- Novo `src/lib/contacts-backfill.functions.ts`: server function com `requireSupabaseAuth` + guarda de admin; agregador e regra de exclusão num módulo puro testável.
- `src/routes/_authenticated/manutencao.tsx`: cartão com o botão, resumo de contadores e tabela de nomes ambíguos.
