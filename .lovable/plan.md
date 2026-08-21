# Release 1.3.1 — Fim do fail-open de categoria no lado do imóvel

## Problema

Um imóvel sem `categoria` e sem `tipo_imovel` cruza hoje com procuras de qualquer
categoria: em `tipoFilter` o `pCat` fica `null`, o bloco de comparação por
categoria é saltado e o caminho textual devolve PASS por não haver nada para
comparar. Resultado real: imóvel `C0440-01014` (T1, 69 m², venda) com 88% de
compatibilidade com a procura "Lar de Idosos / ERPI, 60 camas"
(`categorias: [trespasses]`).

Dimensão: 5 de 45 imóveis ativos têm ambos os campos NULL.

Fora de âmbito (fica registado): não existe campo estruturado para
"capacidade / nº de camas"; continua a viver em `caracteristicas`.

## Parte 1 — Inferência de categoria para imóveis

Novo módulo puro `src/lib/property-category-infer.ts`, espelho de
`category-infer.ts` mas orientado a `properties`:

- `inferPropertyCategory({ categoria, tipo_imovel, subtipo_imovel, tipologia, referencia, titulo, descricao, caracteristicas })`
- Ordem de decisão determinística, para na primeira que resolve:
  1. `categoria` já preenchida → origem `existente` (nunca sobrepor)
  2. `subtipo_imovel` / `tipo_imovel` via `resolveCategory` → `tipo_imovel`
  3. `tipologia` T0–T9 / estúdio → `casas_apartamentos`, origem `tipologia`
  4. texto (título + descrição + características), reutilizando
     `categoriesFromText` + `stripNonTypeFeatures` de `category-infer.ts`
     → `inferido_texto`; se der mais de uma categoria distinta, considera-se
     ambíguo (não escolhe)
  5. nada resolve → `indecidivel` (categoria `null`)
- Devolve `{ categoria, origem, sinais }`. Sem I/O, 100% testável.

Pontos de escrita que passam a usar a inferência (fallback, nunca substituindo
uma decisão explícita já existente):

- `src/routes/_authenticated/imoveis.tsx:504` — hoje
  `resolveCategory(subtipo) ?? resolveCategory(tipo)`; passa a
  `inferPropertyCategory(form).categoria`.
- `src/lib/property-import.server.ts` (`buildPropertyUpdate` e criação por URL) —
  aplica a inferência quando a fonte não devolve categoria; mantém o diff
  selectivo actual (não sobrescreve categoria já definida manualmente).
- `src/lib/properties.functions.ts` — mesma inferência no upsert manual.

Backfill (admin, com simulação obrigatória):

- Nova server function `runPropertyCategoryBackfill` em
  `src/lib/property-category-backfill.functions.ts`, no mesmo molde de
  `category-backfill.functions.ts`: `apply: false` por omissão, devolve
  contagens por origem, total indecidível e amostra antes/depois.
- Painel reutiliza o padrão de `CategoryBackfillPanel.tsx` (novo
  `PropertyCategoryBackfillPanel`), colocado em `manutencao.tsx`.

## Parte 2 — Remover o fail-open em `tipoFilter`

`src/lib/matching-engine.ts` (`tipoFilter`, ~344-391):

- Se a procura declara categorias (`buyerCats.length > 0`) e o imóvel não tem
  categoria resolvida (`pCat === null`), passa a FAIL com
  `rejectReason: "TIPO_IMOVEL"`, detalhe "Categoria do imóvel indeterminada —
  requer revisão" e `needsReview: "categoria_imovel"` (novo valor no tipo
  `NeedsReview`, mesmo padrão já usado para localização/dedup).
- Mantém-se inalterado: procura sem categorias e sem tipo continua a aceitar
  todos os tipos (excepto `categoria_origem === "indecidivel"`, que já falha);
  o caminho textual só é usado quando a procura tem tipo textual mas não
  categoria resolúvel.
- `evaluateExhaustive` herda o comportamento sem alterações próprias (usa os
  mesmos filtros).

Visibilidade: os imóveis marcados `needsReview` aparecem no `MatchAuditPanel`
com o motivo, e o contador de compradores compatíveis desses imóveis passa a 0
até a categoria ser resolvida — comportamento correcto e intencional.

## Impacto em testes existentes

Verificado: em `matching-engine.test.ts`, `matching-engine.regressions.test.ts`,
`matching-engine.geo.test.ts`, `matching-engine.audit.test.ts`,
`property-taxonomy.test.ts` e `property-match-counts.test.ts` todos os imóveis
de teste declaram `tipo_imovel` (ou `categoria`) — nenhum depende do fail-open.
`match-notifications.test.ts:27` tem um imóvel com `tipo_imovel: null`; é preciso
confirmar se a procura correspondente declara categorias e, se sim, ajustar o
fixture (dar-lhe `tipo_imovel`), porque o cenário testado é notificação e não
o fail-open.

## Plano de testes

Novo `src/lib/property-category-infer.test.ts`:
1. `categoria` existente nunca é sobreposta.
2. `tipo_imovel: "moradia"` → `casas_apartamentos`, origem `tipo_imovel`.
3. `tipologia: "T1"` sem tipo → `casas_apartamentos`, origem `tipologia`.
4. Descrição "lar de idosos em funcionamento" → `trespasses`, `inferido_texto`.
5. "T3 com lugar de garagem" não vira `comercial_armazens` (usa
   `stripNonTypeFeatures`).
6. Sem qualquer sinal → `null` / `indecidivel`.

Em `src/lib/matching-engine.regressions.test.ts` (caso real):
7. Procura Marco Gomes (`categorias: ["trespasses"]`, sem tipologia, sem
   orçamento) × imóvel C0440-01014 (T1, 69 m², venda, `categoria: null`,
   `tipo_imovel: null`) → antes PASS/88%, depois `compatible === false`,
   `rejectReason === "TIPO_IMOVEL"`, `needsReview` de categoria.
8. Mesmo imóvel depois da inferência (`categoria: "casas_apartamentos"` via T1)
   × mesma procura → FAIL por categoria fora do pedido (não por revisão).
9. Regressão: imóvel com categoria válida e procura compatível continua PASS.

Validação final: suite completa (`bunx vitest run`), `bunx tsgo --noEmit` limpo,
e execução do backfill em simulação para confirmar que os 5 imóveis passam a ter
categoria (ou ficam explicitamente indecidíveis) antes de aplicar.
