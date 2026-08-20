# Correção — "garagem"/"estacionamento" deixam de ser sinal de tipo de imóvel em procuras

## 1. Onde corrigir (e onde NÃO tocar)

A lista de sinónimos em `src/lib/property-taxonomy.ts` (`resolveCategory` / `resolveCategories`) **é partilhada**:
- classificação de imóveis anunciados (`imoveis.tsx`, `matching-engine.ts` para `property.categoria`/`tipo_imovel`);
- campos estruturados de procuras (`clientes.tsx`, `review.functions.ts`);
- deteção de sinais em texto de procuras (`categoriesFromText` → `detectMultiUse`).

Por isso **não se remove nada da taxonomia**: um imóvel anunciado como "garagem" continua a ser `comercial_armazens`.

A correção fica só no lado do texto de procuras, em `src/lib/category-infer.ts`:
- nova constante `NON_TYPE_FEATURE_RE` com `garagem/garagens`, `estacionamento(s)`, `lugar(es) de garagem`, `box/boxes` (quando acompanhado de garagem), `parqueamento`;
- `categoriesFromText()` passa a apagar essas expressões do texto antes de resolver categorias (mesmo tratamento já dado a `suppressFalseMultiUse`);
- efeito: `detectMultiUse()` e o passo 4 de `inferSearchCategories()` deixam de ver estas palavras. Campos estruturados (`tipo_imovel: ["Garagem"]`) continuam a contar normalmente.

## 2. Caso legítimo "procuro uma garagem"

Fica coberto por duas vias:
- procura com `tipo_imovel`/`categorias` estruturado a dizer garagem/estacionamento → continua `comercial_armazens` (passo 2, não passa pelo texto);
- procura só em texto livre a pedir garagem como o imóvel em si → passa a ficar `indecidivel` com `motivo_indecidivel: "sem_sinal"` e aparece na aba Revisão para resolução manual.

Trade-off aceite: perdemos a classificação automática desse caso raro (nenhum dos 65 casos atuais é deste tipo), em troca de eliminar 33 falsos-positivos. Nunca gera um match errado — só pede um clique na Revisão.

## 3. Reprocessamento dos 33 falsos-positivos

Reaproveita o mecanismo existente `runCategoryBackfill` (`Simular` → `Aplicar`) em `src/lib/category-backfill.functions.ts`, com um novo modo de âmbito restrito:
- input passa a aceitar `scope: "sem_categorias" | "multi_uso_features"` (default mantém o comportamento atual);
- em `multi_uso_features` só entram procuras com `criteria.motivo_indecidivel = 'multi_uso'`, `categorias` vazias, cujo texto contenha garagem/estacionamento **e** cuja re-inferência resolva para exatamente uma categoria;
- procuras que continuem multi-uso depois da correção (as outras ~32) são contadas mas nunca escritas;
- ao aplicar, escreve `categorias`, `categoria_origem` e limpa `motivo_indecidivel`;
- `CategoryBackfillPanel.tsx` ganha um segundo cartão "Recategorizar falsos multi-uso (garagem)" com o mesmo par Simular/Aplicar e a amostra antes/depois.

## 4. Testes

Em `src/lib/category-infer.test.ts`, três casos reais passam a `casas_apartamentos` sem `indecidivel`:
- "T3 ou T4 ... com lugar de garagem" (Maia/Matosinhos);
- "T2 ... garagem ou lugar de garagem" (Porto);
- "Moradia T3, Garagem até 600 mil euros" (Terrugem/Magoito).

Mais:
- não-regressão: `tipo_imovel: ["Armazém"]` + tipologia habitacional continua `multi_uso`;
- "loja com armazém" continua `comercial_armazens`;
- imóvel anunciado "Garagem" continua `comercial_armazens` (teste em `property-taxonomy.test.ts`).

Fecho com contagem de testes e typecheck.
