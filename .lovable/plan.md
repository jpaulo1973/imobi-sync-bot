# Enriquecimento geográfico a partir do texto original (com fiscalização de divergências)

## Parte A — Os 3 números pedidos

### 1. Procuras ancoradas só a distrito ou sem localização

Universo: 865 procuras activas (não descartadas). **113 (13,1%)** estão só a nível distrito (112) ou sem localização nenhuma (1). As restantes 752 já têm concelho/freguesia/zona funcional.

Por distrito gravado:

```text
Lisboa 37 · Leiria 23 · Porto 23 · Setúbal 7 (+2 "Setubal") · Faro 6
(vazio) 4 · Braga 3 · Portalegre 2 · Santarém 1 · Viseu 1 · Beja 1
Viana do Castelo 1 · Vila Real 1 · lisboa 1
```

Nota de dados: `criteria.municipio` e `criteria.freguesia` estão **vazios em 100%** destas 113; 34 têm `criteria.zona` preenchida (micro-zona não reconhecida, ex. "Vale Flores") e 111 têm `texto_original` utilizável. Confirma-se que a informação boa existe, mas só no texto livre.

### 2. Quanto é recuperável (estimativa por nome de concelho presente no texto)

| Classe | Nº | Leitura |
|---|---|---|
| Preenche (1 concelho no texto, coerente com o distrito) | **58** | preenchimento automático |
| Ambíguo (>1 concelho candidato no texto) | **24** | maioria deve resolver com o resolutor hierárquico (contexto do distrito + escolha do mais específico); o resto vai a revisão |
| Divergência de distrito (concelho no texto pertence a outro distrito) | **6** | nunca sobrepor — lista de revisão |
| Sem concelho no texto | **25** | fica como está (sem info) |

Ou seja: ~58 seguras + até ~24 recuperáveis com desambiguação, ~6 divergências para fiscalização, ~25 sem informação. O número exacto por classe sai da Simulação do painel (que usa o resolutor real, não esta aproximação SQL).

### 3. As outras origens têm a mesma limitação?

**Sim — todas.** A cascata que ignora o texto livre não é exclusiva do Excel:

- `excel-import.functions.ts`: tenta freguesia → zona → concelho → distrito e **pára no primeiro que resolve** (por isso acaba no distrito). Nunca lê `texto_original`.
- `active-searches.functions.ts` (origem `cliente`/WhatsApp gravado): escolhe **um único** campo candidato (zona, senão município, senão freguesia) e ignora os restantes e o texto original.
- `whatsapp-leads.functions.ts` (pré-visualização de matches): usa só `lead.zona`.
- Nenhuma destas usa `resolveRecordLocation` (o resolutor hierárquico do Comando 3/3), e **nenhuma usa o `confidence`** devolvido pelo parser.

Conclusão: o ponto 4a aplica-se às **três origens**, num único ponto partilhado — não só ao importador Excel.

## Parte B — Plano

### B1. Núcleo puro: `src/lib/geo/geo-enrich-from-text.ts`

Uma função pura `enrichRecordGeo({ campos, texto_original, location_ids_atuais }, snap, opts)` que:

1. Corre `resolveRecordLocation` com os campos estruturados (comportamento actual, inalterado).
2. Se o resultado for **só distrito ou vazio**, extrai candidatos do `texto_original`: `splitConnectors` (geo-context.ts) sobre o texto + `parseLocations` por segmento, restringido ao contexto do distrito gravado via `isWithin`.
3. Classifica o registo em:
   - `preenche` — exactamente um candidato coerente com o distrito (ou distrito ausente), com `confidence >= 90` (limiar configurável; 90 = concelho por nome exacto, 100 = freguesia/alias, <90 = fuzzy/parcial → não preenche).
   - `divergencia` — há candidato mas contradiz um valor já gravado (conflito de distrito, reutilizando a regra do Comando 3/3) **ou** há vários candidatos incompatíveis. Nunca escreve.
   - `baixa_confianca` — candidato abaixo do limiar → revisão manual.
   - `sem_info` — nada extraível.
   - `mantem` — já tem concelho/freguesia; nunca toca.
4. Devolve `location_ids` propostos, classe, `confidence`, candidatos descartados e `audit` (para o registo poder ser fiscalizado a partir do texto original).

Invariante: **só preenche o que está em falta**. Nunca substitui um ID de nível ≥ concelho já gravado.

### B2. Ingestão (ponto 4a) — as três origens

Chamar `enrichRecordGeo` como passo final da resolução geográfica em:

- `excel-import.functions.ts` (usa `rawText` da linha, já disponível),
- `active-searches.functions.ts` (`data.texto_original ?? data.resumo`),
- `whatsapp-leads.functions.ts` (texto do lead).

Classe `preenche` → grava os IDs mais finos. Classes `divergencia`/`baixa_confianca` → grava o que já havia (distrito) e marca o registo para revisão (`flagged_for_review` + motivo), sem alterar a geografia.

### B3. Backfill retroactivo + painel (ponto 4b)

- `src/lib/geo-text-enrich-backfill.functions.ts` — server fn admin, mesmo padrão de `backfillHomonymGeo`: `{ apply, min_confidence, sample }`, dry-run por omissão, contagens por classe (Preenche / Divergência / Baixa confiança / Sem info / Mantém), amostra com `antes`, `depois`, texto original e motivo.
- `src/components/GeoTextEnrichPanel.tsx` — Simular / Aplicar, na página Manutenção a seguir ao `HomonymGeoBackfillPanel`. "Aplicar" só grava a classe `preenche`.
- Após Aplicar: recompute de matches das procuras afectadas (reutiliza o mesmo caminho do backfill de homónimos).

### B4. Lista de divergências (fiscalização — ponto 2)

O painel mostra a lista completa das divergências (procura, texto original, ID actual, candidato do texto, motivo) com **exportação CSV**, para revisão manual. Cada linha é accionável a partir da Revisão/editor de procura já existente — não se cria um novo fluxo de edição.

### B5. Testes

- Unitários do núcleo puro: preenche / divergência / baixa confiança / sem info / mantém; conflito de distrito; nunca sobrepõe concelho existente; limiar de confiança.
- Regressão: as 752 procuras já com nível fino têm de ficar **inalteradas** (classe `mantem`).
- Casos reais: "Vale Flores, Almada" → concelho Almada; o par C0440-00927 deixa de dar match após o enriquecimento.

### B6. Fora de âmbito

Não se altera o motor de matching, nem a cascata de adjacência/zona funcional, nem se criam aliases automáticos (a promoção de alias continua explícita, via `promoteAlias`).

## Riscos

- Extrair localizações de texto livre é mais permissivo que campos estruturados: mitigado pelo limiar de confiança, pela restrição ao contexto do distrito e por Aplicar só depois de Simular.
- Efeito nos matches: ao passar de distrito para concelho, procuras perdem falsos positivos (o mesmo efeito benéfico já medido no Comando 3/3). Os números aparecem no recompute.
