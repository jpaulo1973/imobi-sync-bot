# Editor de procura na Revisão (painel lateral)

## Objetivo

Permitir ao admin corrigir uma procura existente sem reimportar: orçamento, área mínima,
quartos mínimos, tipologia, tipo de imóvel, localização e contactos — a partir de qualquer
aba da Revisão. Caso prioritário: numa procura multi-uso, limpar/ajustar `area_min` no mesmo
momento em que se atribuem as categorias.

## Como se usa

Cada cartão/linha das três abas ("Sem telefone", "Sem localização", "Sem tipo de imóvel")
ganha um botão **Editar**. Abre um `Sheet` lateral com:

1. **Contexto (read-only)**: nome, origem, data, mensagem original (`OriginalMessage`),
   badges de multi-uso quando existirem.
2. **Categorias**: os mesmos toggles da aba "Sem tipo de imóvel", pré-marcados com o valor atual.
3. **Critérios**: `budget_min`, `budget_max`, `area_min`, `quartos_min` (numéricos, vazio = limpar),
   `tipologia` (texto), `tipo_imovel` (chips editáveis a partir da taxonomia).
4. **Localização**: `LocationSelector` (múltiplo), pré-preenchido com `location_ids`.
5. **Contactos**: `contact_nome`, `contact_telefone`.
6. **Ações**: `Guardar` (mantém em revisão) e `Guardar e resolver` (sai da Revisão e recruza).

Campo numérico vazio grava `null` — é isto que resolve o caso "limpar area_min". Um campo
não tocado não é enviado, para não sobrescrever nada por acidente.

## Alterações técnicas

**Backend (`src/lib/review.functions.ts`)**
- Estender `CriteriaPatch` com `categorias: PropertyCategory[]` e `categoria_origem: "manual"`,
  para que uma única chamada grave categorias + critérios de forma atómica (hoje as categorias
  passam por `setSearchCategories`, separado).
- Nova server fn `getReviewSearch({ id })` (admin) devolvendo a linha completa
  (`criteria`, `location_ids`, contactos, `texto_original`, `resumo`, `origem`, datas) para
  preencher o formulário sem depender do payload reduzido de cada aba.
- `updateReviewSearch` mantém a semântica atual: merge do patch em `criteria`, recálculo de
  `dedup_key`, expiração via `computeExpiresAt`, `recomputeForSearch`. Só se acrescenta
  `resolve: false` como caminho suportado (já existe no schema) para "Guardar" sem resolver.
- Quando `categorias` chega com ≥1 valor, `motivo_indecidivel` é removido do `criteria`
  (deixa de ser indecidível/multi-uso pendente).

**Frontend**
- Novo componente `src/components/review/SearchEditSheet.tsx` — recebe `searchId`, carrega
  via `getReviewSearch`, submete via `updateReviewSearch`, chama `onSaved()` para as listas
  recarregarem.
- `src/routes/_authenticated/revisao.tsx`: estado `editingId` ao nível da página, um único
  `SearchEditSheet` montado, e botão "Editar" nas três listas.

**Testes**
- `src/lib/review-edit.test.ts`: patch numérico `null` limpa o campo; campo ausente preserva
  o valor antigo; gravar categorias limpa `motivo_indecidivel`; `dedup_key` recalculado quando
  nome/telefone/tipologia mudam.
- Suite completa + typecheck no fim.

## Fora de âmbito

Sem migração de base de dados. Sem alterações ao Motor Match (incluindo a área insensível a
categoria — continua um `area_min` global; este ecrã é o remédio manual). `setSearchCategories`
mantém-se para a atribuição em bloco.
