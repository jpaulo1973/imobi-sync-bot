# Backfill único da tabela `contacts`

Semear `contacts` com os pares (nome, telefone) já presentes no histórico de `active_searches`, para que o preenchimento automático do telefone na importação passe a cobrir contactos conhecidos desde sempre — e não apenas os vistos depois do deploy de ontem.

## 1. Números confirmados (medidos agora na base de dados)

| Métrica | Valor |
|---|---|
| Linhas de `active_searches` com nome + telefone válido (9 dígitos) | 2 570 |
| Pares distintos (utilizador + nome normalizado + telefone) → registos em `contacts` | **1 712** |
| Nomes normalizados distintos | 1 309 |
| Nomes com mais do que um telefone no histórico | **24** |

Estado atual de `contacts`: 8 registos (todos `origem='revisao'`). O backfill cria ~1 704 novos e reforça os 8 existentes (incremento de `times_seen`), sem os sobrescrever.

Regras de exclusão: linhas sem nome utilizável, sem telefone em nenhuma das duas colunas, ou com telefone que normaliza para menos de 9 dígitos são ignoradas.

## 2. Regra de desempate quando o mesmo nome tem vários telefones

O lookup existente (`contacts_lookup`) devolve as linhas ordenadas por **`times_seen` desc, depois `last_seen_at` desc**, e `knownPhoneFor` fica com a primeira. Ou seja, hoje a regra é:

1. **Mais frequente** (o telefone que aparece em mais procuras desse nome);
2. **Empate → mais recente** (`last_seen_at` mais alto).

O backfill alimenta exatamente esta regra:
- `times_seen` = número de procuras históricas em que aquele par (nome, telefone) aparece;
- `last_seen_at` = data mais recente (`greatest(created_at, updated_at)`) dessas procuras.

Consequência para os 24 nomes ambíguos: ganha o número usado mais vezes; só quando há empate decide a recência. Nenhum telefone é apagado — todos os variantes ficam gravados, o lookup apenas escolhe o preferido. O ranking não é alterado por este plano.

## 3. O que o backfill faz

- Nova server function de administração, invocada do painel de Manutenção (mesmo padrão da deduplicação já aprovada): botão "Semear contactos do histórico" com contadores no fim (linhas lidas, pares criados, pares reforçados, ignorados).
- Percorre `active_searches` em páginas (paginação já usada no backfill geográfico, para não bater no limite de 1 000 linhas).
- Para cada linha: nome = `contact_nome` ?? `consultor_nome`; telefone = `contact_telefone` ?? `consultor_telefone` (o mesmo "telefone efetivo" que a deduplicação usa).
- Agrega em memória por (utilizador, nome normalizado, telefone) somando ocorrências e guardando a data mais recente, e só depois grava — uma escrita por par, não uma por linha.
- Escrita via RPC `SECURITY DEFINER` (`contacts_upsert`, estendida com `origem='backfill'`, `p_times_seen` e `p_last_seen_at`), respeitando o `ON CONFLICT` existente. Não altera nenhuma coluna de `active_searches`.

## 4. Idempotência

Correr duas vezes não duplica: o índice único (utilizador, nome normalizado, telefone) força `ON CONFLICT DO UPDATE`. Para que a segunda execução não inflacione contagens, o upsert de backfill grava `times_seen` como **valor absoluto** (`GREATEST(existente, contagem_histórica)`) em vez de incrementar, e `last_seen_at` como o mais recente dos dois. Contactos aprendidos pela Revisão mantêm o telefone e o nome de exibição já gravados.

## 5. Testes de regressão

- Agregador puro: nome com acentos/caixa diferentes e telefones em formatos PT distintos (`+351…`, `00351…`, `9…`) colapsam num único par.
- Nome com dois telefones históricos: gera dois registos, e a ordenação `times_seen desc, last_seen_at desc` devolve o mais frequente; com empate, devolve o mais recente.
- Idempotência: aplicar o mesmo conjunto duas vezes mantém `times_seen` e o número de registos.
- Linhas sem telefone ou com telefone curto são contadas como ignoradas e não escrevem nada.
- Suite completa existente (131 testes) tem de continuar verde.

## Detalhes técnicos

- Migração: `contacts_upsert` passa a aceitar `p_times_seen integer default null` e `p_last_seen_at timestamptz default null`; quando presentes, aplica valores absolutos em vez de `times_seen + 1`. Sem argumentos novos, o comportamento atual mantém-se intacto (importação/revisão continuam a incrementar).
- Novo ficheiro `src/lib/contacts-backfill.functions.ts` com a server function protegida por `requireSupabaseAuth` + guarda de admin, e o agregador puro num módulo testável.
- `src/routes/_authenticated/manutencao.tsx`: cartão novo com o botão e o resumo dos contadores.
