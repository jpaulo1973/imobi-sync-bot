# Correção da deteção de duplicados por subgrupo + filtro de expiração no backfill de categorias

## Problema

1. `groupTextSimilarity()` devolve a **média Jaccard de todos os pares** de textos distintos de um telefone.
   Um único texto legítimo diferente do mesmo consultor arrasta a média abaixo de 0,80 e esconde
   duplicados byte-a-byte idênticos dentro do mesmo grupo.
2. `runCategoryBackfill` não filtra `expires_at`, ao contrário do painel de Duplicados — os cartões de
   Manutenção contam leads mortos.

## Alteração 1 — subagrupamento por similaridade (src/lib/duplicates.server.ts)

Substituir a decisão "média do grupo" por clustering dentro de cada chave (telefone ou nome):

```text
para cada chave (user_id + telefone|nome):
  1. normalizar texto de cada membro (normalizeTextKey)
  2. union-find sobre os membros: unir i,j quando textJaccard(txt_i, txt_j) >= 0,80
  3. cada componente com >= 2 membros = um grupo de duplicados
  4. membros isolados (nenhum par >= 0,80) são descartados
```

Novas funções exportadas (mantendo `groupTextSimilarity` para os testes/relatórios existentes):

- `clusterByTextSimilarity(members)` — devolve `Array<{ membros, similaridade_minima }>`, usando
  `DUPLICATE_SIM_THRESHOLD` (0,80, inalterado) e `textJaccard` já existentes.
- `shouldSuggestGroup()` deixa de decidir a inclusão do grupo inteiro (fica só para compatibilidade dos
  testes atuais); a decisão passa a ser "o cluster tem ≥ 2 membros".

## Alteração 2 — listDuplicateGroups (src/lib/duplicates.functions.ts)

- Query e filtros mantidos exatamente como estão (`descartado = false`, `expires_at > now()`,
  chave telefone→nome, `keepSeparate`).
- Depois de construir os membros de cada chave, correr `clusterByTextSimilarity` e emitir **um grupo por
  cluster**, com chave `"<key>#<n>"` quando a chave gera mais de um cluster (o sufixo garante que
  "manter separado" continua a funcionar por cluster e não silencia o telefone todo).
- Chaves que já eram um único cluster mantêm a chave original — decisões "manter separado" existentes
  continuam válidas.
- `similaridade_texto` passa a ser a similaridade mínima dentro do cluster (mais honesta que a média).
- `total_excedentes` = soma de `membros - 1` por cluster.

## Alteração 3 — expiração no backfill de categorias (src/lib/category-backfill.functions.ts)

- O `fetchAllRows("active_searches", ...)` passa a filtrar `descartado = false` e `expires_at > now()`
  (via parâmetro de filtro no repositório, ou fallback a paginação explícita com `.gt("expires_at", ...)`).
- Aplica-se a **todos os scopes** (`sem_categorias` e `multi_uso_features`), para os números baterem com
  o painel de Duplicados.

## Testes

`src/lib/duplicates-cluster.test.ts` (novo) com os 4 grupos reais confirmados — Comprarcasa Rede Serviços
Imobiliários, Flávio Ferreira, Manuela Rodrigues da Silva Imobiliária, Tânia Caratão — cada um modelado
como telefone único com textos idênticos repetidos + procuras legítimas distintas:

- cada caso produz ≥ 1 cluster de duplicados (antes: 0, porque a média ficava < 0,80);
- as procuras legítimas divergentes ficam fora do cluster;
- textos idênticos continuam a dar similaridade 1;
- caso "consultora Isabel Santos" (3 textos todos diferentes) continua a **não** produzir cluster —
  não-regressão da 1.2.11;
- `duplicates-threshold.test.ts` mantém-se intacto.

## Estimativa de impacto (procuras ativas, não descartadas)

- Hoje: 0 grupos sugeridos.
- Depois: **6 grupos** com texto normalizado idêntico (24 linhas, **18 excedentes**) — medido diretamente
  na base de dados; inclui os 4 grupos reportados. Com o limiar de 0,80 (quase-idênticos, não só
  idênticos) espera-se marginalmente mais alguns grupos/excedentes.
- Cartões de Categoria: as contagens descem para o universo de procuras vivas (leads expirados deixam de
  contar).

## Notas técnicas

Sem migração de base de dados. Sem alteração ao limiar, à RPC `admin_merge_duplicate_group`, nem ao fluxo
Simular → Aplicar do `DuplicatesPanel`. Complexidade O(n²) por chave, sobre grupos pequenos — irrelevante.
