## Plano revisto — Encerramento da Fase 2

Incorpora as três correcções: sem alias para "Foros de Amora", expressão de teste sintética, `times_used` só incrementado em reutilização.

### 1. Foros de Amora — verificação, não alias

Confirmado por query directa: `locations` só tem `Amora` (freguesia). Não existe `Foros de Amora`.

**Contexto administrativo importante:** "Foros de Amora" **não é uma freguesia oficial**. É uma localidade (aglomerado populacional) dentro da freguesia de Amora, concelho do Seixal. A tabela `locations` actualmente só modela `distrito | concelho | freguesia | zona_funcional` — não tem nível "localidade/lugar".

**Decisão para esta sprint:**

- **Não criar alias** (respeita a regra: aliases são para sinónimos/abreviaturas de entidades reais, não para preencher lacunas de biblioteca).
- **Não inserir em `locations`** como freguesia (seria factualmente incorrecto).
- **Não introduzir novo tipo `localidade`** nesta sprint — expandir a taxonomia do modelo geográfico é uma decisão arquitectural que merece a sua própria sprint (com definição de regras de contenção, matching de proximidade, e migração das freguesias que também contêm localidades relevantes: Barreiro, Almada, Setúbal, etc.).
- **Deixar cair naturalmente na Revisão:** na primeira ocorrência real em produção, o consultor resolve manualmente para `[Amora]`. Se o padrão se repetir, sinaliza a necessidade de introduzir o nível "localidade" numa sprint dedicada.

Registar esta pendência no relatório final como *known gap*, não como bug.

### 2. Testes end-to-end via Playwright autenticado

Script em `/tmp/browser/fase2/`, sessão Supabase restaurada via `LOVABLE_BROWSER_SUPABASE_*`, screenshots por passo em `/tmp/browser/fase2/screenshots/`.

**Teste 1 — Aprendizagem de alias (expressão sintética)**

Usar uma expressão claramente inventada, garantindo que se testa a *aprendizagem* e não uma lacuna geográfica:

1. Via `psql`: inserir uma `active_search` de teste em `revisao_pendente` com `texto_original = "Procuro apartamento na Urbanização XPTO"`.
2. Chamar `resolveLocationText({ text: "Urbanização XPTO" })` **antes** — deve devolver `resolved=[]`, `unresolved=["Urbanização XPTO"]` (baseline).
3. Navegar `/revisao`, localizar o cartão, adicionar manualmente `[Amora]` (ou outra freguesia arbitrária que sirva de "interpretação humana") no `LocationSelector`, guardar.
4. Aceitar o `window.confirm` da aprendizagem via `page.on("dialog", d => d.accept())`.
5. Validar via `psql`:
   - novo registo em `location_aliases`: `alias_text = "urbanizacao xpto"` (normalizado), `location_ids = [<id Amora>]`, `approved = true`, `origem = "revisao"`, **`times_used = 0`**, `last_used_at = NULL`.
6. Chamar `resolveLocationText({ text: "Urbanização XPTO" })` **depois** e confirmar `resolved=[<id Amora>]`, `via="alias"`.
7. Re-validar via `psql`: **agora sim** `times_used = 1` e `last_used_at IS NOT NULL`.
8. Limpar: `DELETE` do alias e da search de teste.

**Verificação de código adicional (Teste 1a):** antes de correr o Playwright, ler `promoteAlias` em `src/lib/geo/geo.functions.ts` para confirmar que **não** incrementa `times_used` no `INSERT`. Se estiver incorrecto (a incrementar na criação), tratar como bug de âmbito da Fase 2 e corrigir antes do Playwright — o comportamento esperado é `times_used=0` na criação, incremento na primeira resolução via `LocationRepository`/parser.

**Teste 2 — Persistência UI de `location_ids` / `location_id`**

*Compradores:*
1. `/clientes` → criar comprador (nome sintético `__TEST_FASE2_BUYER__`), seleccionar `Alverca` + `Parque das Nações`, guardar.
2. Reabrir → confirmar 2 chips pré-preenchidos.
3. Editar: remover `Alverca`, adicionar `Oeiras`, guardar. Reabrir → confirmar chips = `[Parque das Nações, Oeiras]`.
4. Validar via `psql`: `buyer_clients.location_ids` reflecte IDs esperados.
5. Limpar: `DELETE`.

*Imóveis:*
1. `/imoveis` → criar imóvel de teste (referência sintética), seleccionar `Carcavelos` (single), guardar.
2. Reabrir → confirmar chip.
3. Editar para `Cascais`, guardar, reabrir → confirmar.
4. Validar via `psql`: `properties.location_id`.
5. Limpar: `DELETE`.

Screenshots críticos: formulário aberto, chips após reabertura, prompt de aprendizagem, estado pós-edição.

### 3. Relatório final estruturado

- Resultado por teste (✅/❌) com evidência (screenshot + linha de query SQL).
- Falhas: causa raiz, ficheiro/linha, correcção aplicada (se dentro da Fase 2).
- Estado de `promoteAlias` re `times_used` (comportamento actual + correcção se aplicável).
- *Known gap* documentado: "Foros de Amora" e outras localidades sub-freguesia dependem de uma futura sprint de expansão da taxonomia geográfica.
- Confirmação explícita de que a Fase 2 pode ser encerrada.

### Critério de encerramento

Todos os testes verdes → aguardar autorização escrita para Fase 3 (reescrita do `matching-engine` para consumir exclusivamente `location_id`/`location_ids`; remoção de `location-graph.ts`, `KNOWN_CONCELHOS`, `ADJACENT`; activação da guarda estática anti-texto-livre).

### Detalhes técnicos

- Sem migrações SQL nesta sprint (não se toca em `locations` nem se cria alias seed).
- Correcção pontual em `promoteAlias` (se necessária) via `apply_patch` — mudança isolada de uma linha.
- Playwright: `headless=True`, `viewport 1280×1800`, cookies + `localStorage` restaurados, `page.on("dialog")` para o prompt.
- Limpeza garantida mesmo em caso de falha (bloco `try/finally` no script).
