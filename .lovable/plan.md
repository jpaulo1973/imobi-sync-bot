# Correção da deteção de duplicados por subgrupo + filtro de expiração no backfill de categorias

## Problema

1. `groupTextSimilarity()` devolve a **média Jaccard de todos os pares** de textos distintos de um telefone.
   Um único texto legítimo diferente do mesmo consultor arrasta a média abaixo de 0,80 e esconde
   duplicados byte-a-byte idênticos dentro do mesmo grupo.
2. `runCategoryBackfill` não filtra `expires_at`, ao contrário do painel de Duplicados — os cartões de
   Manutenção contam leads mortos.

## Alteração 1 — subagrupamento por similaridade (src/lib/duplicates.server.ts)

Substituir a decisão "média do grupo" por clustering de **ligação completa** (não union-find) dentro de
cada chave (telefone ou nome). Ligação simples/cadeia é explicitamente rejeitada: repetiria o problema
histórico (Sandra de Sousa Alves / Isabel Santos), em que A~B=0,85 e B~C=0,82 juntavam A~C=0,60.

```text
para cada chave (user_id + telefone|nome):
  1. normalizar o texto de cada membro (normalizeTextKey)
  2. calcular a matriz de pares textJaccard(i, j)
  3. ordenar membros por completeness (desc) e, guloso:
       - abrir um cluster com o primeiro membro ainda livre
       - juntar um membro ao cluster SÓ SE textJaccard >= 0,80 contra
         TODOS os membros já dentro desse cluster (ligação completa)
  4. clusters com >= 2 membros = grupos de duplicados; membros isolados são descartados
```

Garantia resultante: **todos** os pares internos de um cluster estão ≥ 0,80. Nenhum cluster é formado por
cadeia transitiva.

Novas funções exportadas (mantendo `groupTextSimilarity` para relatórios e testes existentes):

- `clusterByTextSimilarity(membros)` — devolve `Array<{ membros, similaridade_minima }>` usando
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

`src/lib/duplicates-cluster.test.ts` (novo):

- os 4 grupos reais confirmados — Comprarcasa Rede Serviços Imobiliários, Flávio Ferreira,
  Manuela Rodrigues da Silva Imobiliária, Tânia Caratão — modelados como telefone único com textos
  idênticos repetidos + procuras legítimas distintas: cada um produz ≥ 1 cluster (antes: 0);
- as procuras legítimas divergentes ficam fora do cluster;
- textos idênticos continuam a dar similaridade 1;
- **não-regressão Isabel Santos** (3 textos todos diferentes, mesmo telefone) → 0 clusters;
- **não-regressão Sandra de Sousa Alves** (grupo historicamente agrupado por engano) → não forma cluster
  com as procuras que não são realmente iguais;
- **teste de cadeia (ligação completa)**: A~B = 0,85, B~C = 0,82, A~C = 0,60 → o cluster fica {A,B} (ou
  {B,C}), nunca {A,B,C}. Este teste falha com union-find e passa com ligação completa;
- `duplicates-threshold.test.ts` mantém-se intacto.

## Estimativa de impacto (procuras ativas, não descartadas)

- Hoje: 0 grupos sugeridos.
- Depois: **6 grupos** (24 linhas, **18 excedentes**), medidos na base de dados por texto **normalizado**
  idêntico.
- Diferença face aos "4 grupos / 20 linhas / 16 excedentes" do diagnóstico anterior: esse número usava
  hash do texto **cru** (byte-a-byte). Os 2 grupos extra (telefones 911022838 e 913861684, 2 linhas cada)
  têm 2 variantes cruas mas 1 única variante normalizada — ou seja, diferem apenas em espaços/maiúsculas.
  `normalizeTextKey` só remove acentos, colapsa espaços e passa a minúsculas; não altera palavras nem
  ordem, portanto não junta textos com conteúdo diferente. Comportamento esperado e desejado.
- Cartões de Categoria: as contagens descem para o universo de procuras vivas (leads expirados deixam de
  contar).


## Notas técnicas

Sem migração de base de dados. Sem alteração ao limiar, à RPC `admin_merge_duplicate_group`, nem ao fluxo
Simular → Aplicar do `DuplicatesPanel`. Complexidade O(n²) por chave, sobre grupos pequenos — irrelevante.
