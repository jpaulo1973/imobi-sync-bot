# Release 1.2.1 — Consolidação do Motor de Oportunidades

Objetivo: eliminar falsos positivos e devolver total confiança nos resultados. Sem features novas — só consolidação.

---

## 1. Hard Filters estritos e configuráveis (`src/lib/matching-engine.ts`)

Nova arquitetura baseada em **registo configurável** de filtros:

```
HARD_FILTERS: HardFilter[] = [
  finalidadeFilter, tipoFilter, localizacaoFilter,
  areaMinFilter, precoMaxFilter,
  ...featureFilters (garagem, elevador, ...)
]
```

Cada filtro devolve `{ ok: true } | { ok: false, reason } | { ok: false, needsReview: true, reason }`. Acrescentar futuros hard filters = juntar entrada ao array; motor não muda.

Filtros iniciais, por ordem:

1. **Finalidade** — venda/arrendamento tem de coincidir. `indefinido` em qualquer lado → falha.
2. **Tipo de imóvel** — declarado em ambos e coincidente.
3. **Localização** — ver §2.
4. **Área mínima**:
   - `buyer.area_min` existe e `imóvel.area < area_min` → falha eliminatória.
   - `buyer.area_min` existe e imóvel sem área → `needsReview: "Área do imóvel em falta"`.
5. **Preço máximo** — `price > budget_max * 1.10` → falha.
6. **Características obrigatórias** (garagem, elevador, futuras) — declarativas via `REQUIRED_FEATURES` map; se pedidas e ausentes → falha.

Só depois: score soft (tipologia, preço dentro do intervalo, área acima do mínimo, extras opcionais, nível de localização).

## 2. Localização por freguesia (`src/lib/location-graph.ts` + engine)

- Mesma freguesia → Nível 1 (compatível).
- Freguesia limítrofe configurada em `ADJACENT` → Nível 2 (compatível, score reduzido).
- Qualquer outra combinação — **incluindo mesmo concelho sem adjacência** → incompatível.
- **Procura pede freguesia, imóvel só tem concelho** → `needsReview: "Freguesia do imóvel em falta"`. Não gera oportunidade automática, mas surge na Revisão.
- Removido Nível 3 e o toggle `expandSearch`.
- Grafo `ADJACENT` inicial: freguesias de Lisboa, Cascais, Oeiras, Sintra, Setúbal. Editável sem tocar em código.

## 3. Revalidação obrigatória em tempo real (`src/lib/property-match.functions.ts`)

- Listagens de oportunidades deixam de confiar em `match_opportunities` persistidas: cada linha é **re-executada nos Hard Filters em tempo real** com os dados atuais do imóvel e da procura.
- Se deixar de passar → linha apagada de `match_opportunities` e não é devolvida ao consultor.
- Se o motivo for `needsReview`, oportunidade não é devolvida como match e o registo é marcado `flagged_for_review = true` com o motivo apropriado.
- Igual comportamento em recomputações após edição de imóvel, procura, split ou dedup.

## 4. Splitter determinístico + eliminação do original (`search-splitter.server.ts`, `excel-import.functions.ts`, `whatsapp-leads.functions.ts`, `active-searches.functions.ts`)

- `mayContainMultipleSearches` reforçada: separadores (`\n-`, `•`, `1)`), múltiplos verbos de procura, múltiplos `até XXX €`, tipologias distintas, localizações distintas.
- **IA (`splitBuyerSearches`) só é chamada quando o pré-detector devolve `true`**. Procura simples → zero IA.
- Quando splitter devolve N ≥ 2: cria N novos registos e **elimina o registo original**. Nunca coexistem pai + filhos.
- Aplicado em Excel, WhatsApp e página Cruzar.

## 5. Deduplicação inteligente (`src/lib/dedup.ts` + migração + `review.functions.ts`)

- `dedup_key` = telefone normalizado + finalidade + tipologia + tipo + freguesia + faixa de orçamento arredondada.
- Migração: `UNIQUE (user_id, dedup_key) WHERE dedup_key IS NOT NULL` em `active_searches` + `ON CONFLICT DO NOTHING` no insert.
- `mergeDuplicateSearches` (admin, botão na Revisão): para cada grupo `(user_id, dedup_key)` com >1 registo:
  1. **Preferir o mais completo** — `completeness_score` = soma ponderada de campos preenchidos (telefone, freguesia, tipologia, orçamento min+max, área, características, texto_original).
  2. **Empate → mais recente**.
  3. Apagar os restantes; re-cruzar o mantido.

## 6. Filtro de anúncios reforçado (`excel-import.functions.ts` + WhatsApp)

- Alargar `ofertaSignals` (novo/km0/vista mar/preço €/m²/inclui garagem/agende visita/T3 remodelado/etc.).
- Inverter a regra: passa a **exigir sinal explícito de procura** para importar. Sem sinal → `flagged_for_review = true` com motivo "Não parece procura de comprador", em vez de descartar silenciosamente.
- Sinais estruturais: `preço + área + tipologia + morada` sem verbo de procura → classificado como anúncio.

## 7. Botão WhatsApp corrigido (`src/components/PhoneButton.tsx` + call sites)

- Passa a usar sempre `https://wa.me/<E164 sem +>`; nunca `api.whatsapp.com`.
- Normalizador único (retira espaços/`+`/`00`; garante `351` para números PT sem indicativo).
- Link sempre `target="_blank" rel="noreferrer noopener"`.
- Botão WhatsApp adicionado ao popover do `PhoneButton`.
- Substituir os call sites que ainda constroem URL à mão (`radar.tsx`, `imoveis.tsx`).

## 8. Página Revisão (`src/routes/_authenticated/revisao.tsx` + `review.functions.ts`)

Colunas visíveis: origem, consultor, comunidade, grupo, texto original, motivo (novo enum: `multi_procura`, `freguesia_em_falta`, `area_em_falta`, `nao_parece_procura`, `revisao_manual`), data, telefone.

Ações:
- Editar / Dividir / Guardar / Eliminar (já existem).
- **"Guardar e reintegrar"** limpa `flagged_for_review` e recruza.
- **"Recruzar tudo"** (admin): corre `mergeDuplicateSearches` → reaplica hard filters → regenera `match_opportunities`.

## 9. Auditoria de dados existentes (migração + função única)

Migração:
- Índice único parcial descrito em §5.
- Coluna `decision_reason` já existe; documenta o enum de motivos.

Função executada via "Recruzar tudo":
- Marca `flagged_for_review = true` para registos multi-procura detectados pelo pré-detector.
- Purga `match_opportunities` que já não passem nos novos hard filters (via revalidação de §3).
- Corre `mergeDuplicateSearches`.

---

## Ficheiros afetados

Alterados: `src/lib/matching-engine.ts`, `src/lib/location-graph.ts`, `src/lib/search-splitter.server.ts`, `src/lib/dedup.ts`, `src/lib/excel-import.functions.ts`, `src/lib/whatsapp-leads.functions.ts`, `src/lib/active-searches.functions.ts`, `src/lib/property-match.functions.ts`, `src/lib/review.functions.ts`, `src/components/PhoneButton.tsx`, `src/routes/_authenticated/revisao.tsx`, `src/routes/_authenticated/radar.tsx`, `src/routes/_authenticated/imoveis.tsx`.

Novos: migração SQL (índice único parcial em `active_searches`).

## Notas técnicas

- Remoção do Nível 3 é intencional. Menos resultados, todos válidos. Badge "modo estrito" no Radar.
- Revalidação em tempo real assegura que edições a imóveis/procuras purgam automaticamente oportunidades obsoletas — sem jobs periódicos.
- IA só é invocada quando o pré-detector determinístico o justifica — poupa créditos.
- Helpers dos `HARD_FILTERS` vivem em módulo `.server.ts` importado pelo motor (evita `ReferenceError` do transform `tss-serverfn-split` quando reutilizados por server functions).

## Fora de âmbito

Sem novas features, sem alterações de UI/UX além do `PhoneButton`, badge "modo estrito" no Radar e enum de motivos na Revisão. Sem novas tabelas.
