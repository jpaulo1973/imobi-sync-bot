# Renovação de validade por reaparecimento em ficheiro/lote NOVO

## Objetivo

Quando uma procura já existente (`origem` `excel` ou `whatsapp`) recebe um **merge** vindo de um ficheiro/lote de importação **genuinamente novo**, `data_publicacao` passa a "hoje" e `expires_at` é recalculado a partir dessa nova data (via `computeExpiresAt`/`expiresFromBase`, sem duplicar a regra dos 30 dias).

Nunca se aplica a `origem = 'cliente'` (nem `texto`/`captura`).

## O ponto crítico: o que é um "lote novo"

Hoje `startExcelImport` gera `batch_id = xlsx_${Date.now()}` — **muda a cada upload, mesmo do mesmo ficheiro**. Usar isso como gatilho reabriria exatamente o bug antigo: reimportar 5x o mesmo Excel renovaria 5x a validade.

Solução: separar dois conceitos.

- `batch_id` (já existe): identificador da *execução* de importação. Continua a servir para `finalizeExcelImport`. Não é gatilho de renovação.
- `batch_key` (novo): **impressão digital determinística do conteúdo do ficheiro** — SHA-256 dos bytes do ficheiro (já disponíveis em base64 em `startExcelImport`), combinada com o `user_id`. O mesmo ficheiro dá sempre a mesma `batch_key`.

Regra de renovação, cumulativa:

```text
renova SE  origem ∈ {excel, whatsapp}
       E   a decisão foi um merge (action = "updated")
       E   batch_key nunca foi ingerida antes por este utilizador  (ficheiro novo)
       E   esta procura ainda não foi renovada por esta batch_key  (idempotência intra-lote)
```

Duas guardas, porque a primeira responde "o ficheiro é novo?" e a segunda garante que reprocessar/retomar o mesmo upload (chunks repetidos, retry de rede) não renova duas vezes.

Nota importante: a "impressão digital" é do **ficheiro**, não da linha. Um ficheiro novo que contenha a mesma linha renova (é o comportamento pedido: o comprador reapareceu). O mesmo ficheiro reenviado não renova nunca.

## Alterações técnicas

**Base de dados (migração)**
- `public.import_batches`: `batch_key text`, `user_id uuid`, `origem text`, `filename text`, `first_seen_at timestamptz`, `last_seen_at timestamptz`, `times_seen int`; PK `(user_id, batch_key)`. Com GRANTs e RLS por `auth.uid()`.
- RPC `SECURITY DEFINER` `import_batch_register(p_batch_key, p_origem, p_filename)` → devolve `boolean is_new` (true só na primeira vez; nas seguintes incrementa `times_seen` e devolve false). Decisão atómica no servidor, não no cliente.
- `active_searches`: nova coluna `renewed_by_batch_key text null` (idempotência por procura) e `renewed_at timestamptz null` (auditoria).

**`src/lib/excel-import.functions.ts`**
- `startExcelImport`: calcula `batch_key` (SHA-256 do base64 via `crypto`), chama `import_batch_register`, devolve `batch_key` e `batch_is_new` ao cliente.
- `ChunkInput` aceita `batch_key` + `batch_is_new`; ambos propagados para `UpsertRow`.

**`src/routes/_authenticated/importar.tsx`**
- Multi-ficheiro: cada ficheiro tem a sua `batch_key`/`batch_is_new` (um lote de 3 ficheiros em que 2 são repetidos só renova pelas linhas do ficheiro novo). Os chunks passam a levar os valores do ficheiro a que pertencem.
- No relatório final: "Renovadas: N" (e quantos ficheiros foram ignorados por repetição).

**`src/lib/active-searches.functions.ts` (`mergeInto`)**
- `UpsertRow` ganha `batch_key?: string | null` e `batch_is_new?: boolean`.
- Nova função pura `shouldRenewOnMerge({ origem, batchKey, batchIsNew, existingRenewedByBatchKey })` — testável isoladamente, sem BD.
- Quando renova: `data_publicacao = now()`, `expires_at = expiresFromBase({ data_publicacao: now })`, `renewed_by_batch_key = batch_key`, `renewed_at = now()`, e nota em `decision_reason` ("renovada por lote novo <key curta>").
- Quando não renova: comportamento atual intacto (deriva da data conhecida, senão mantém `expires_at`).
- `mergeInto` continua a nunca aceitar `data_publicacao` "hoje" por outra via.

**WhatsApp (`cruzar.tsx` / `whatsapp-leads.functions.ts`)**
- `batch_key` = SHA-256 do texto da conversa colada + `user_id`; mesma RPC, mesma regra. Colar a mesma conversa outra vez não renova.

## Testes

Novo `src/lib/renew-on-merge.test.ts` (lógica pura, sem BD):
- mesmo lote reprocessado **não** renova (`batch_is_new = false`) — regressão do bug antigo;
- procura já renovada por esta `batch_key` **não** renova outra vez (chunk repetido/retry);
- lote genuinamente novo **renova** e `expires_at = hoje + 30 dias`;
- `origem = 'cliente'` nunca renova, mesmo com lote novo;
- sem `batch_key` (fluxos `texto`/`captura`) nunca renova.

Regressão SQL em `supabase/tests/`: `import_batch_register` devolve `true` uma vez e `false` nas repetições; segundo utilizador com a mesma `batch_key` recebe `true` (isolamento por utilizador).

Também: `expiry.test.ts` continua a garantir que a renovação usa `expiresFromBase` e não uma segunda cópia da regra dos 30 dias.

## Impacto no recálculo de expiração (Simular/Aplicar)

`admin_recalc_excel_expiry` recalcula `expires_at = COALESCE(data_publicacao, data_origem) + 30 dias`. Como a renovação escreve a nova `data_publicacao`, o recálculo mantém-se **coerente e idempotente**: recalcular após uma renovação reproduz a mesma data e não a desfaz. Sem alterações à RPC.

Efeito colateral desejado a assinalar: procuras renovadas deixam de ser elegíveis para a limpeza automática das 04:00, que é precisamente o objetivo.

## Fora de âmbito

Não altera scores de deduplicação, motor de match, nem a limpeza de expiradas.
