# Multi-uso: excluir do backfill automático

## A) Diagnóstico (leitura, já feito)

Procuras ativas (não descartadas, não expiradas): **911**.

| Métrica | Valor |
|---|---|
| `categorias` com **mais de 1 valor** | **0** |
| `categorias` com exatamente 1 valor | 754 |
| `categorias` vazio | 157 |
| Com `area_min` definido | 148 |
| Com >1 categoria **E** `area_min` | **0** |

Não há exemplos a mostrar: hoje nenhuma procura ativa tem mais do que uma categoria. Todos os importadores e a inferência gravam sempre uma única categoria, e o backfill ainda não foi aplicado.

Conclusão: o problema do "filtro de área não sensível à categoria" é **prospetivo, não atual** — só passa a existir no momento em que começarmos a gravar multi-categoria (backfill ou resolução manual na Revisão). Isso reforça a tua decisão: em vez de atribuir automaticamente categorias a casos ambíguos, mandá-los para revisão manual.

## B) Plano — deteção robusta de multi-uso

### Regra central (reutilizável)

Criar `detectMultiUse(input)` em `src/lib/category-infer.ts`, que corre **sempre**, independentemente de a inferência já ter resolvido por `tipo_imovel` ou `tipologia`:

1. Recolher **todos** os sinais de categoria em paralelo (sem parar no primeiro sucesso):
   - `sinaisTipo` = categorias resolvidas de `tipo_imovel`
   - `sinaisTipologia` = habitacional, se `tipologia` for T0–T9/estúdio
   - `sinaisTexto` = `categoriesFromText(texto_original + resumo)`
2. Aplicar **supressão de falsos multi-uso** ao conjunto de sinais de texto, por padrões de finalidade:
   - `terreno (para|destinado a|com viabilidade|com projeto) <habitacional/comercial>` → conta só `terrenos`
   - `<X> para (AL|alojamento local|hostel|investimento|rentabilidade)` → conta só `X`
   - `moradia|apartamento` dentro de expressão de "construção" após terreno → ignorado
3. União dos sinais restantes. Se **≥ 2 categorias distintas** → `multiUso = true`.

### Impacto na inferência

`inferSearchCategories` passa a devolver também `multi_uso: boolean` e a lista `sinais` (auditoria). Quando `multiUso === true` e não havia `categorias` existentes:
- `categorias: []`
- `categoria_origem: "indecidivel"`
- `motivo_indecidivel: "multi_uso"` (distingue de indecidível puro, que fica `"sem_sinal"`)

A regra "nunca sobrepor `categorias` já existentes" mantém-se intacta e tem prioridade absoluta — multi-uso nunca apaga uma decisão humana ou prévia.

### Backfill

`runCategoryBackfill` (Simular/Aplicar):
- casos multi-uso deixam de receber categoria automática; gravam `categoria_origem: "indecidivel"` + `motivo_indecidivel: "multi_uso"`, caindo na aba **Sem tipo de imóvel** da Revisão
- restantes (~122) aplicam-se sem qualquer alteração de comportamento
- a simulação passa a mostrar uma linha nova nas estatísticas: `indecidivel (multi_uso)` com contagem, e a amostra indica os sinais detetados por registo

### Revisão

Na aba "Sem tipo de imóvel", os registos multi-uso ganham um badge "Multi-uso" e a lista dos usos detetados no texto, para acelerares a escolha manual (podes marcar várias categorias, como já hoje).

### Testes

- `category-infer.test.ts`: os 4 estados atuais continuam verdes; novos casos — "Imóvel urbano, industrial ou habitacional" (Luísa Tinoco) → multi-uso; "Armazém ou loja 200 a 400m2" → multi-uso; "Prédio c/ AL ou Hostel" → multi-uso; "terreno para moradia" → **não** multi-uso (só `terrenos`); registo com `categorias` já preenchido → `existente`, nunca multi-uso.
- Regressão do motor: procura multi-uso marcada indecidível falha o `tipoFilter` (comportamento igual aos indecidíveis puros).

### Notas técnicas

Ficheiros tocados: `src/lib/category-infer.ts` (deteção + tipos), `src/lib/category-backfill.functions.ts` (estatística e escrita), `CategoryBackfillPanel.tsx` (nova linha na simulação), `revisao.tsx` (badge), `category-infer.test.ts` e `matching-engine.regressions.test.ts`. Sem migração de base de dados: `motivo_indecidivel` vive dentro de `criteria` (jsonb).
