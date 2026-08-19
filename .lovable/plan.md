# Corrigir expiração das procuras Excel (data_publicacao + 30 dias)

## Diagnóstico confirmado (dados reais, agora)

- Procuras Excel não descartadas: **2.971** (2.950 com `data_publicacao`, 21 sem).
- Ativas hoje (`expires_at > now()`): **2.188**.
- Passariam a expiradas imediatamente com a regra correta: **1.189** (amostra: 8 procuras publicadas a 21/06/2026, importadas a 08/07, com expiração atual 24/08).
- Ativas sem `data_publicacao`: **21** (quase todas têm `data_origem` preenchida).

Causa: `startExcelImport` calcula um único `expires_at = agora + 30 dias` e passa-o a todos os chunks; `insertNew` e `mergeInto` gravam esse valor tal e qual — logo, reimportar renova a validade.

## Cobertura do filtro `expires_at`

- Property Match / Radar: usam a leitura partilhada `pool_active_searches`, que já filtra `expires_at > now()` (e `descartado = false`). OK.
- Revisão: as listagens principais filtram `expires_at > now()`. OK.
- Sem job de expiração: nada precisa de ser criado — o filtro na leitura é suficiente e reversível.
- A rever no âmbito desta sprint: garantir que **todas** as listagens de revisão (incluindo "sem localização", duplicados e exportação) aplicam o mesmo filtro, para não voltar a mostrar leads expirados.

## Regra nova (única fonte de verdade)

`expires_at = base + 30 dias`, com `base` por ordem:
1. `data_publicacao`
2. `data_origem` (data da mensagem no ficheiro, quando não houve timestamp completo)
3. `created_at` / momento da importação — comportamento atual, só como último recurso

Reimportação: `expires_at` passa a ser sempre recalculado a partir da base do registo fundido (nunca "agora"), pelo que reimportar o mesmo ficheiro deixa a data inalterada.

## Alterações técnicas

1. **`src/lib/expiry.ts` (novo, puro)**: `computeExpiresAt({ data_publicacao, data_origem, fallbackNow })` + `DURATION_DAYS`. Sem dependências de rede, testável.
2. **`src/lib/excel-import.functions.ts`**: deixa de propagar um `expires_at` global; cada linha calcula o seu a partir da data que extraiu. O campo do chunk passa a ser apenas fallback.
3. **`src/lib/active-searches.functions.ts`** (`mergeInto`): `expires_at` deriva da base efetiva (data de publicação/origem preferida entre existente e nova), nunca do valor "agora" recebido. Manual/WhatsApp mantêm o comportamento atual quando não há data de publicação.
4. **Recálculo em massa** — server function admin `previewExpiryRecalc` / `applyExpiryRecalc` (dry-run por omissão), exposta no painel **Manutenção**:
   - "Simular": total afetado, quantas ficam expiradas, distribuição por mês de publicação e amostra de 20 linhas (nome, publicação, expiração atual → nova).
   - "Aplicar": só após confirmação explícita; grava por lotes, apenas para `origem = 'excel'`, e regista o total atualizado.
   - As procuras ficam expiradas (deixam de aparecer nas vistas), **não** são apagadas nem marcadas como descartadas — reversível.
5. **Testes de regressão** (`src/lib/expiry.test.ts` + casos no teste de importação): `expires_at` usa `data_publicacao`; reimportação do mesmo ficheiro não estende a data; sem `data_publicacao` usa `data_origem`; sem nenhuma das duas mantém o comportamento atual.

## Sequência de entrega

1. Código + testes (nada muda nos dados).
2. Corre "Simular" na Manutenção e mostro-te os números e a amostra.
3. Só depois da tua confirmação é que "Aplicar" toca em produção.
