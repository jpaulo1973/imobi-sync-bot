# Sugestão automática de telefone na aba "Sem telefone" a partir de um ficheiro de contactos pessoal

Funcionalidade nova e isolada. O painel "Reimportar ficheiro preenchido" **não é alterado**.
O ficheiro de contactos **nunca é gravado** — é lido no browser, parseado em memória e usado só
para gerar sugestões nesta sessão. Nenhuma server function recebe a lista completa de contactos.

## Estado atual medido na base de dados (procuras vivas, não descartadas)

- 79 procuras sem telefone válido, agrupadas em **74 consultores** (chave = nome normalizado).
- Apenas **4 grupos** têm mais de uma procura (máximo 3) — a propagação existe mas é pequena.
- 0 grupos sem nome (todos têm nome para comparar).
- Referência de cobertura: só **3** destes 74 nomes têm correspondência exata na tabela interna
  `contacts`. Não é possível estimar melhor sem o ficheiro real do Google Contacts — a estimativa
  fiável sai do próprio ecrã de simulação, que mostrará contagens de exatos / parecidos / ambíguos
  / sem sugestão antes de qualquer gravação.

## 1. Parsing do ficheiro (novo `src/lib/contacts-file.ts`, puro e testável)

Sem biblioteca nova. Duas funções:

- `parseVcf(text)` — dessdobra linhas continuadas (linha seguinte começando por espaço/tab),
  separa blocos `BEGIN:VCARD`…`END:VCARD`, lê `FN` (ou compõe de `N:` apelido;nome), e todas as
  linhas `TEL` (com parâmetros, ex. `TEL;TYPE=CELL:+351 91…`). Trata `CHARSET`/`ENCODING=QUOTED-PRINTABLE`
  básico e ignora propriedades desconhecidas.
- `parseContactsCsv(text)` — CSV do Google Contacts: usa o leitor de CSV já existente do projeto
  (`src/lib/review-export.ts`), mapeia `First Name`/`Middle Name`/`Last Name` (fallback a
  `Name`) e todas as colunas `Phone N - Value` (múltiplos números separados por `:::`).

Saída comum: `ContactEntry { nome: string; telefones: string[] }`, com telefones passados por
`normalizePhone` (`src/lib/dedup.ts`) e descartados abaixo de 9 dígitos. Contactos sem nome ou
sem telefone válido são contados como ignorados.

## 2. Correspondência de nome — mesmo padrão dos Duplicados

Reutiliza o critério existente, não inventa um novo:

- normalização: `normalizeTextKey` (`src/lib/dedup.ts`) — minúsculas, sem acentos, espaços colapsados;
- similaridade: **Jaccard de tokens**, a mesma fórmula de `textJaccard`;
- limiar: **`DUPLICATE_SIM_THRESHOLD` = 0,80**, importado de `src/lib/duplicates.server.ts`.

Única adaptação necessária, documentada no código: `textJaccard` descarta tokens com ≤ 3 letras
(afinado para textos longos), o que apagaria nomes como "Ana", "Rui", "Sá". A nova
`nameSimilarity(a, b)` usa exatamente a mesma fórmula Jaccard com o limite de token em ≥ 2
caracteres. Nome idêntico após normalização dá 1,00 (exato).

Classificação por procura/consultor:
- **exato** — 1,00;
- **parecido** — ≥ 0,80 e < 1,00 (sugerido, com % visível);
- **sem sugestão** — melhor candidato < 0,80;
- **ambíguo** — (a) o contacto correspondente tem mais de um telefone distinto, ou (b) dois ou mais
  contactos empatam no mesmo melhor score ≥ 0,80, ou (c) dois grupos "Sem telefone" diferentes
  competem pelo mesmo contacto. Ambíguos **não** recebem valor pré-preenchido; mostram os candidatos.

## 3. UI — `src/components/review/ContactSuggestPanel.tsx`

Card próprio no topo da aba "Sem telefone", abaixo do painel de reimportação existente:

- botão **"Sugerir telefones a partir de contactos"** → `input type=file` (`.vcf,.csv`);
- resumo do ficheiro lido: contactos válidos, ignorados, e contagens exato / parecido / ambíguo /
  sem sugestão (é isto que responde à estimativa real);
- tabela de sugestões (padrão "Simular", **nada gravado**): procura(s), nome atual, telefone sugerido,
  nome do contacto de origem, **% de correspondência**, e badge para ambíguos;
- botão **"Aplicar sugestão"** por linha, que apenas pré-preenche o campo do `ContactoCard`
  correspondente com o número sugerido. A gravação continua a ser o **"Guardar" existente**.

O `ContactoCard` passa a aceitar `sugestao?: { telefone, contacto, score }` e mostra
"Sugerido de <contacto> (87%)" junto ao input. Sem sugestão, comportamento atual inalterado.

## 4. Propagação para as outras procuras do mesmo consultor

Já é o comportamento do backend atual e não precisa de RPC nova: a aba agrupa por nome normalizado
e `setConsultorTelefone` recebe `search_ids[]` do grupo inteiro, fazendo um único
`update … .in("id", search_ids)`. Conta como update em massa, por isso a confirmação visual é
reforçada:

- o cartão passa a indicar explicitamente, antes de gravar: "este número vai ser aplicado a N
  procuras deste consultor";
- quando N > 1, "Guardar" abre um `AlertDialog` a listar as procuras afetadas (data/origem/resumo)
  e exige confirmação;
- a propagação limita-se ao grupo já visível (mesma chave de nome usada na sugestão). Nunca se
  estende a nomes apenas "parecidos" entre si — grupos distintos gravam-se separadamente.

## 5. Testes (`src/lib/contacts-file.test.ts`)

- vCard: bloco simples, linhas dobradas, `N:` sem `FN`, vários `TEL`, `TEL` inválido, ficheiro vazio;
- CSV Google Contacts com `Phone 1/2 - Value` e nome composto;
- `nameSimilarity`: idêntico = 1; acentos/maiúsculas irrelevantes; nome curto ("Ana Sá") não colapsa
  para 0; nomes diferentes < 0,80; limiar 0,80 partilhado com os Duplicados;
- ambiguidade: contacto com 2 telefones distintos e empate de dois contactos → sem pré-preenchimento.

## Notas técnicas

Sem migração de base de dados, sem tabela nova, sem alterações a `setConsultorTelefone`,
`bulkSetConsultorTelefone`, ao painel de reimportação ou ao motor de match.
