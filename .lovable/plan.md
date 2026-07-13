## Objetivo

Corrigir os 5 comportamentos observados na validação da Release 1.3, corrigindo a causa real em cada caso.

## Diagnósticos (causas confirmadas por auditoria)

**1. Edição do imóvel não atualiza compradores compatíveis**
O `handleSave` em `src/routes/_authenticated/imoveis.tsx` já chama `runMatch(savedRow)` + `recomputeForProp(savedRow.id)`. O `runMatch` calcula ao vivo (buyers + Base Global) e `recomputeFn` persiste no Radar. **O que falta**:
- `load()` (que preenche `matchCounts`) corre antes do `runMatch`, mas a contagem só é atualizada após o `countsFn` async; após uma edição o card do imóvel na lista mantém o número antigo (`compradores compatíveis: 0`) até refresh manual. Forçar `countsFn` a re-executar imediatamente após `runMatch`, e definir `matchCounts[savedRow.id] = res.opportunities.length` (já feito dentro de `runMatch` para o próprio id — reforçar após save).
- Confirmar com teste real (Marinha Grande): se o buyer continua a não aparecer no dialog após save+runMatch, a causa é no motor (`matching-engine`), não no gatilho — investigar o caso e corrigir a regra de zona/freguesia.

**2. "Consultores por Completar" continua vazio**
`listIncompleteConsultores` (`review.functions.ts`) usa `resolveConsultor` com `uploaderMap` como fallback. Quando o registo tem `consultor_nome`/`consultor_telefone` a null, o consultor efetivo cai no dono do upload (admin) e "empresta-lhe" nome+telefone+email+agência → nada aparece como em falta. **Fix**: no audit, avaliar exclusivamente o que está gravado na procura + hit direto na diretoria por nome/telefone; NUNCA usar o uploader como fallback. Regra: se `consultor_nome` OU `consultor_telefone` da procura estão vazios, o campo conta como em falta; email/agência só contam presentes se vierem do hit direto na diretoria (match por nome ou telefone) — não do uploader.

**3. Nome do consultor incorreto nas oportunidades**
`resolveConsultor` em `opportunity-privacy.ts` faz `fallback?.nome`/`fallback?.telefone` quando o registo não traz consultor. Isso mostra o utilizador autenticado/uploader como consultor. **Fix**: alinhar com o critério do user — o uploader só é usado quando a procura não tem QUALQUER informação do consultor (nem nome nem telefone). Concretamente:
- Se `perRecordNome` ou `perRecordTelefone` existir: nome/telefone/email/agência vêm apenas do registo + hit direto na diretoria; NUNCA do fallback.
- Se ambos forem null: apenas então usar `fallback` (mantém compatibilidade histórica). Alternativa mais estrita (a validar): devolver tudo a null, deixando o UI mostrar "Consultor por completar".

**4. Telefones não normalizados**
Migration + `upsertOne` + `whatsapp-leads` já normalizam. Falta uma via:
- `src/routes/_authenticated/clientes.tsx` linha 122: `telefone: form.telefone || null` grava o valor do formulário sem normalizar. **Fix**: aplicar `normalizePhone(form.telefone)` no `insert` (e no `update` se existir).
- Auditar consultas de comparação em `dedup.ts` e `resolveConsultor` — já usam `normalizePhone`, ok.
- Adicionar backfill defensivo simples em `buyer_clients` (a migration anterior já corre; se o formulário do cliente escreveu depois, basta corrigir o writer — sem nova migration).

**5. Abrir oportunidade muda de página**
Botão "Abrir" no Radar (`radar.tsx` L175-179) usa `<Link to="/imoveis" search={{ open: p.id }}>`, causando navegação para /imoveis. O comportamento pedido é "abrir apenas o detalhe da oportunidade sem alterar navegação". **Fix**: substituir a navegação por um painel/Sheet inline dentro do Radar que mostra o detalhe do imóvel + razões do match, mantendo o utilizador em `/radar`. Reutilizar o padrão do `BuyerOpportunitiesDrawer` (já existe em `clientes.tsx`).

## Alterações por ficheiro

- `src/lib/opportunity-privacy.ts` — `resolveConsultor`: usar `fallback` apenas quando `perRecordNome` e `perRecordTelefone` forem ambos vazios; nunca "misturar" fallback com per-record.
- `src/lib/review.functions.ts` — `listIncompleteConsultores`: remover uso de `uploaderMap` como fallback; passar `null` como fallback ao `resolveConsultor`; regra de missing baseada no per-record + hit direto na diretoria.
- `src/routes/_authenticated/clientes.tsx` — normalizar telefone antes de inserir buyer_client (import de `normalizePhone` de `@/lib/dedup`).
- `src/routes/_authenticated/imoveis.tsx` — após `handleSave` bem-sucedido, forçar `countsFn()` para atualizar imediatamente o badge no card do imóvel editado (além do `runMatch` já existente).
- `src/routes/_authenticated/radar.tsx` — substituir `<Link to="/imoveis" search={{ open: p.id }}>` por um handler que abre um Sheet inline com o detalhe do imóvel + razões do match; remover a navegação automática.
- `src/routes/_authenticated/imoveis.tsx` — remover o handler `?open=` + `useEffect` que auto-navega/auto-abre (já não é usado). Manter apenas o comportamento normal de abrir dialog via botão local.

## Testes de aceitação

1. Editar imóvel (mudança de zona para Marinha Grande) → dialog de compradores compatíveis abre imediatamente com o comprador esperado; badge do card atualiza.
2. Procuras com consultor incompleto passam a aparecer em "Consultores por Completar" (Revisão).
3. Oportunidades mostram o consultor real da procura; quando a procura não tem consultor, mostrar "—" / "Consultor externo" — nunca o utilizador autenticado.
4. Adicionar cliente via formulário grava telefone normalizado.
5. Clicar "Abrir" numa oportunidade do Radar abre um painel de detalhe SEM sair de `/radar`.

## Fora de âmbito

- Sem novas features. Sem alterações em RLS, schema, ou motor de matching, exceto se o teste 1 (Marinha Grande) demonstrar bug no `matching-engine` — nesse caso corrigir a causa concreta encontrada, sem refactor.