# Comando 3/3 — Homónimos distrito/concelho: diagnóstico medido + plano de correção

## 1. Dimensão real (medida agora na base de dados)

Existem 18 concelhos homónimos do distrito (Aveiro, Beja, Braga, Bragança, Castelo Branco, Coimbra, Évora, Faro, Guarda, Leiria, Lisboa, Portalegre, Porto, Santarém, Setúbal, Viana do Castelo, Vila Real, Viseu).

Registos ancorados nesses concelhos homónimos e o que dizem os campos de texto:

| Fonte | Ancorados no concelho homónimo | Contradizem o texto (deveriam ser outro concelho) |
|---|---|---|
| Imóveis (`properties`) | 5 | **2** (ambos `C0440-00927`: texto concelho=Grândola, freguesia=Carvalhal, ID=concelho Setúbal) |
| Procuras (`active_searches`) | 255 (Porto 117, Lisboa 104, Setúbal 19, Santarém 4, Braga 4, Faro 3, Leiria/Beja/Bragança/Aveiro 1) | **0** |

Porque é que as 255 procuras dão 0 contradições: nenhuma tem `municipio` preenchido nem `freguesia`; só têm `distrito` + `zona` com o mesmo nome ("Lisboa", "Porto", "Setúbal"). Não há texto mais específico que o ID contrarie — não é erro de resolução, é a granularidade do próprio lead.

Achado adjacente (mesma família, medido): 26 imóveis têm `freguesia` em texto mas ficaram ancorados a concelho/distrito — perda de especificidade sem contradição direta. Inclui 3 imóveis Azeitão/Setúbal. Fica como métrica do backfill, não como correção obrigatória.

Conclusão: o erro **duro** é pequeno (2 linhas, 1 referência), mas a mecânica que o produziu continua ativa e volta a acontecer em qualquer registo cujo distrito seja homónimo do concelho.

## 2. Causa raiz

Dois defeitos distintos, nenhum deles no motor de match:

**(a) Origem histórica das 2 linhas erradas — prioridade por tipo sem campo de origem.** `resolveSegment` (`src/lib/geo/geo-parser.ts`) só passou a restringir a resolução ao nível do campo (`strictTipo`) mais tarde. Antes, o texto "Setúbal" percorria a ordem freguesia → **concelho** → distrito e parava no concelho Setúbal (confidence 95) antes de chegar ao distrito. O backfill de 18/08 gravou assim o `location_id` do `C0440-00927`. Hoje, com `field: "distrito"`, esse caminho já não existe.

**(b) Defeito que continua vivo — resolução por candidato independente, sem verificação cruzada nem contexto hierárquico.** Em `resolveLocationIdFromParsed` (`src/lib/property-import.server.ts`) e no backfill (`src/lib/geo-backfill.functions.ts`), os candidatos são testados em cascata (freguesia → concelho → zona → distrito) e **o primeiro que resolve ganha**, com dois problemas:
- **Falta de contexto de pai:** "Carvalhal" existe como freguesia em 5 concelhos; o passo 3 do parser devolve a **primeira** ocorrência encontrada na lista, sem filtrar pelas freguesias filhas do concelho já conhecido em texto (Grândola). Escolha arbitrária silenciosa.
- **`zona` é campo não estrito:** o texto de `zona` resolve por qualquer nível, logo `zona="Setúbal"` ou `zona="Porto"` volta a ancorar no concelho homónimo mesmo quando `concelho` em texto diz outra coisa (é exactamente o padrão de reincidência).
- **Nenhuma verificação cruzada final:** ninguém compara o ID escolhido com o resto do texto do registo. Um ID "concelho Setúbal" num registo com `concelho=Grândola` passa sem qualquer sinal.

Resposta direta à pergunta: é **ambos** — ordem/prioridade sem contexto hierárquico (a) + ausência de verificação cruzada entre texto e ID resolvido (b).

## 3. Plano de correção

### 3.1 Resolutor hierárquico (novo módulo puro)
`src/lib/geo/geo-resolve-record.ts` — função pura `resolveRecordLocation({ distrito, concelho, freguesia, zona }, snap)`:
1. Resolve **distrito** e **concelho** primeiro (campos estritos) para obter o contexto (`districtId`, `concelhoId`).
2. Resolve **freguesia** filtrando candidatos pelos que são descendentes do concelho/distrito conhecido; se sobrar >1 → ambíguo, não escolhe.
3. Resolve **zona** apenas dentro do contexto já fixado; um match de zona que caia fora do concelho/distrito conhecido é **descartado** (deixa de poder promover o registo para o concelho homónimo).
4. Devolve o ID mais específico coerente + `audit` (candidatos por nível, motivo do descarte) + `conflict: boolean`.

Guarda-rail explícito: se o texto de concelho resolve para X e o candidato final não é X nem descendente de X → conflito, mantém X e regista o motivo.

### 3.2 Ligar aos pontos de escrita
- `resolveLocationIdFromParsed` (import/reimport de imóveis por URL e criação manual) passa a delegar em `resolveRecordLocation`.
- `backfillGeoFromText` usa a mesma função (mantém o princípio de pipeline único).
- Sem alterações ao motor de match, ao `tipoFilter`, nem à taxonomia (fora de âmbito por indicação).

### 3.3 Backfill Simular/Aplicar
Nova server function `backfillHomonymGeo` em `src/lib/geo-backfill.functions.ts` (admin-only, `p_apply` estilo dos restantes backfills):
- Varre `properties` (todas, incluindo já com `location_id`) e `active_searches`, recalcula com `resolveRecordLocation` e classifica cada linha em: `corrige` (ID atual contradiz o texto), `especializa` (texto tem nível mais fino que o ID atual), `mantem`, `conflito` (para revisão humana).
- **Simular** devolve contagens por classe + amostra de até 30 linhas (referência, texto, ID atual → ID novo). **Aplicar** grava só `corrige`; `especializa` fica atrás de um segundo interruptor para não mexer nos 26 imóveis sem confirmação.
- Após aplicar, reexecuta o recompute de matches dos donos afetados (reutiliza `recomputeForBatch`) para as oportunidades falsas desaparecerem.
- Painel `HomonymGeoBackfillPanel.tsx` em `manutencao.tsx`, no mesmo padrão visual dos painéis existentes.

### 3.4 Testes
- `src/lib/geo/geo-resolve-record.test.ts`: caso Grândola/Carvalhal (não pode dar Setúbal), `zona="Setúbal"` com `concelho="Grândola"` (zona descartada), freguesia homónima em 5 concelhos (desambiguada pelo pai; ambígua sem pai), procura só com distrito+zona homónima (comportamento inalterado — não pode regredir as 255).
- Teste de classificação do backfill sobre linhas sintéticas (corrige / especializa / mantem / conflito).

### 4. Impactos e riscos
- As 255 procuras Lisboa/Porto/Setúbal **não** mudam de ID (só têm distrito+zona homónimos) — é a regressão a evitar e está coberta por teste.
- A correção altera 2 linhas de imóvel (`C0440-00927`) e remove os matches falsos daí resultantes (Juliana Lima, Miguel De Sousa, etc.).
- `especializa` (26 imóveis) fica opcional e desligado por omissão, porque torna o matching mais restrito e deve ser validado por ti antes.
