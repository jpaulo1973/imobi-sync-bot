# Correção do separador decimal nas áreas importadas por URL

## 1. Corrigir a leitura de números (raiz do bug)

`parsePtNumber` em `src/lib/property-import.server.ts` apaga todos os pontos,
tratando-os sempre como separador de milhares. Resultado: `143.45` → `14345`.

Nova regra (locale PT tolerante):
- Se existe vírgula: pontos são milhares → remover pontos; a **última** vírgula
  passa a ponto decimal e as anteriores são removidas (`1.234,5` → `1234.5`).
- Se não existe vírgula e existe **um único** ponto seguido de 1–2 dígitos:
  é decimal → manter (`143.45` → `143.45`, `120.7` → `120.7`).
- Caso contrário (pontos com grupos de 3 dígitos, ex. `1.234`, ou vários pontos):
  milhares → remover pontos.
- Inteiros sem separadores continuam iguais (`91` → `91`).

Nada mais no fluxo de importação muda: o campo `area_m2` continua derivado da
área escolhida em `buildPropertyInsert`.

## 2. Correção imediata dos 2 casos confirmados

Migração pontual, valores da fonte, sem re-scraping:

| Referência | area_util_m2 | area_bruta_m2 | area_m2 |
|---|---|---|---|
| C0440-01028 | 120.7 (era 1207) | 143.45 (era 14345) | 120.7 |
| C0440-00951 | 124.45 (era 12445) | 386.85 (era 38685) | 124.45 |

## 3. "Simular revalidação de áreas" (só leitura)

Novo painel em **Manutenção** (`ValidateAreasPanel`), padrão igual ao
`ExpiryRecalcPanel`: botão **Simular**, sem qualquer botão de aplicar nesta fase.

Server function `simulateAreaRevalidation` (admin, `src/lib/area-revalidation.functions.ts`):
1. Lê os imóveis com área preenchida (40 registos; os 2 já corrigidos ficam de fora
   por já coincidirem com a fonte).
2. Para cada um, obtém a página da fonte e volta a extrair as áreas com
   `extractStructuredAreasFromHtml` já corrigido.
3. Devolve por imóvel: referência, campo, área atual, área revalidada e um sinal
   de divergência.

**Ponto que precisa da tua decisão:** a tabela `properties` não guarda o URL do
anúncio, por isso não há como o servidor saber sozinho qual a página de cada
imóvel. Duas formas de resolver:
- **(A) Colar a lista** — no painel colas `referência;URL` (uma por linha, ou só
  URLs, casando a referência extraída da página). Sem custos extra e determinístico.
- **(B) Procura automática** — o sistema pesquisa cada referência no site da
  Century 21 e usa o primeiro resultado. Não exige trabalho manual, mas pode
  falhar/apanhar a página errada em referências sem resultado, e gasta créditos
  de scraping em 38 pesquisas + 38 páginas.

A tabela de simulação destaca apenas as linhas que mudam, e mostra à parte as
que não foi possível revalidar (página inacessível ou sem etiqueta de área).

## 4. Testes

Em `src/lib/property-import.server.test.ts`:
- `parsePtNumber`: `"143.45"→143.45`, `"1.234,5"→1234.5`, `"120.7"→120.7`,
  `"91"→91`, `"1.234"→1234`, e um caso com múltiplas vírgulas
  (`"1,234,5"→1234.5`).
- Regressão de extração: HTML com `Área útil 120,7 m²` / `Área bruta 143.45 m²`
  devolve 120.7 e 143.45.
- Os testes existentes de áreas (C0440-01018) continuam verdes.

## Notas técnicas
- `parsePtNumber` passa a ser exportado para teste direto.
- A simulação não escreve nada: nenhuma migração, nenhum update.
- A aplicação em massa das correções fica para uma sprint seguinte, depois de
  validares a lista.
