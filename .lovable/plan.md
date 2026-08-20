# Categorias de procura — captura, inferência e backfill

Objetivo: nenhuma procura entra no Motor Match sem categoria decidida, e as indecidíveis deixam de "aceitar tudo".

## 1. Importador Excel escreve `categorias`

Em `src/lib/excel-import.functions.ts`, no objeto `criteria` de cada split (e no `baseCriteria`), passa a gravar:

- `categorias`: derivadas de `tipo_imovel` via `resolveCategories()`.
- `categoria_origem`: `"tipo_imovel"` quando vieram da coluna.

Isto fecha os 88 casos "com_tipo + sem_cat" para o futuro. O mesmo bloco é aplicado ao canal WhatsApp para manter um único formato de `criteria`.

## 2. Inferência determinística (sem LLM)

Novo módulo `src/lib/category-infer.ts` com uma função pura:

```
inferSearchCategories({ tipo_imovel, tipologia, texto_original, categorias })
  -> { categorias, origem: "existente" | "tipo_imovel" | "tipologia" | "inferido_texto" | "indecidivel" }
```

Ordem de decisão (para na primeira que resolve):
1. `categorias` já presentes -> devolve tal e qual, origem `existente` (**nunca sobrepõe**).
2. `tipo_imovel` -> `resolveCategories()`.
3. `tipologia` com padrão `T0..T9` / estúdio -> `casas_apartamentos`.
4. Palavras-chave no `texto_original` -> `resolveCategory()` (hotéis, armazém, terreno, herdade, loja, escritório, prédio…).
5. Nada resolve -> `categorias: []`, origem `indecidivel`.

O resultado é gravado em `criteria.categorias` + `criteria.categoria_origem` (campo de auditoria, visível na Revisão). `inferCondition()` continua a preencher `estado_desejado` quando o texto o indica.

## 3. Política para indecidíveis no Motor

Em `tipoFilter()` (`src/lib/matching-engine.ts`): quando a procura está marcada como indecidível (`categoria_origem === "indecidivel"`) e não tem `tipo_imovel` nem `categorias`, o filtro passa a **falhar** com `rejectReason: "TIPO_IMOVEL"` e detalhe "Tipo de imóvel da procura indeterminado — requer revisão", em vez de aceitar qualquer imóvel.

O comportamento atual (sem tipo indicado = aceita tudo) mantém-se apenas para procuras que não foram marcadas, para não alterar registos legítimos.

Essas procuras aparecem numa aba **"Sem tipo de imóvel"** na página de Revisão, com a mensagem original e um seletor de categoria para resolução manual (individual e em bloco), reutilizando o padrão já existente na aba "Sem localização".

## 4. Backfill com simulação

Nova server function em `src/lib/category-backfill.functions.ts` (admin-only, padrão do `geo-backfill`):

- `simulateCategoryBackfill()` — percorre as procuras ativas sem `categorias`, aplica a inferência e devolve: totais por origem (`tipo_imovel`, `tipologia`, `inferido_texto`, `indecidivel`) e amostra por registo com **antes/depois** (nome, texto truncado, tipo, categorias antes -> depois, origem).
- `applyCategoryBackfill()` — escreve as mesmas decisões, sem tocar em registos que já tenham `categorias`.

Card novo em `/manutencao`: "Simular" primeiro (tabela de amostra + contagens), botão "Aplicar" só ativo depois da simulação.

## 5. Testes

`src/lib/category-infer.test.ts`:
- os 4 estados do diagnóstico: `com_tipo+com_cat` (mantém), `com_tipo+sem_cat` (deriva de tipo), `sem_tipo+sem_cat` (infere de tipologia/texto ou marca indecidível), `com_cat+sem_tipo` (mantém categorias).
- regra "não sobrepor": `categorias` existentes nunca são substituídas, mesmo com texto a sugerir outra coisa.

`src/lib/matching-engine.regressions.test.ts` (novo caso):
- procura marcada `indecidivel` **falha** o filtro de tipo (`rejectReason: "TIPO_IMOVEL"`);
- procura sem tipo e sem marca continua a passar (sem regressão).
