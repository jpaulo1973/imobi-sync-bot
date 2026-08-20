# Reimportação por URL — Upsert por referência (sem duplicados)

## 1. Problema

`importPropertyFromUrl` faz sempre `INSERT`. Reimportar o mesmo imóvel cria um segundo registo com a mesma `referencia` (é o caso do `C0440-00927`, com 2 registos), o que duplica oportunidades e notificações de match.

## 2. Comportamento proposto

Ao importar um URL:
1. Extrair os dados da fonte (como hoje).
2. Se a extração devolver `referencia` e já existir um imóvel **do mesmo consultor** com essa referência: **atualizar** esse registo.
3. Se não existir (ou a fonte não der referência): criar novo, como hoje.
4. A resposta passa a indicar se foi criação ou atualização, e quais os campos alterados, para a interface mostrar "Imóvel atualizado (3 campos)".

Se por acidente existirem 2 registos com a mesma referência, a atualização aplica-se ao mais recente e o utilizador é avisado do duplicado.

## 3. Regra proposta: o que é atualizado vs preservado

Não existe hoje marca de "editado à mão". A regra proposta é simples e conservadora:

**Sempre atualizados (dados factuais da fonte, é o objetivo da reimportação):**
- Áreas: útil, bruta, terreno
- Preço
- Tipo de imóvel, subtipo, tipologia
- Finalidade (venda/arrendamento)
- Localização: distrito, concelho, freguesia, zona e `location_id`
- Características booleanas: garagem, elevador, jardim, piscina

**Nunca sobrepostos por valor vazio:** se a fonte não devolver um campo (vem `null`/vazio), o valor atual é preservado. A reimportação só escreve o que conseguiu ler.

**Nunca tocados (campos de gestão interna, não vêm da fonte):**
- `ativo`, `user_id`, `created_at`, `referencia`
- `descricao` e `caracteristicas` (texto livre onde tipicamente se escreve à mão)
- `categoria`, `estado`

**Proteção de edições manuais:** para os campos factuais, a reimportação assume que a fonte é a verdade — é exatamente o que resolve o bug das áreas. Antes de gravar, a interface mostra a lista de diferenças (campo / valor atual / valor novo) e só grava depois de confirmar. Assim nenhuma edição manual é perdida sem o utilizador ver.

Se preferires o oposto para o preço (nunca sobrepor preço manual), digo-o na implementação — é uma linha de configuração.

## 4. Duplicado do C0440-00927

Os dois registos são idênticos nos dados (preço 345 000 €, 70/72 m²). Diferem no histórico:

```text
A (Jul/16)  ad828bbf…  15 oportunidades, 19 notificações
B (Ago/18)  015bc66e…  14 oportunidades, 32 notificações
```

Apagar um é seguro do ponto de vista técnico: as tabelas de match apontam para o imóvel e as oportunidades/notificações do registo apagado desaparecem com ele (não há registos "órfãos" nem erros). Não há estados de match ativos em nenhum dos dois.

Recomendação: **manter o registo A (Jul/16)** — é o original e tem histórico mais antigo — e apagar o B. As oportunidades perdidas são recalculadas automaticamente pelo motor de match na próxima passagem, pelo que não há perda funcional. As 32 notificações do B deixam de existir; se alguma estiver por ler, é perda apenas do aviso, não do match.

Alternativa se preferires zero perda de notificações: transferir as oportunidades/notificações do B para o A antes de apagar, ignorando as que ficariam repetidas. Dá mais um passo, faço-o se quiseres.

## 5. Detalhes técnicos

- `src/lib/properties.functions.ts`: `importPropertyFromUrl` passa a ter modo `dry-run` (devolve diff) e modo `apply` (grava). Procura por `referencia` + `user_id` via cliente autenticado (RLS aplica-se).
- `src/lib/property-import.server.ts`: novo helper puro `buildPropertyUpdate(atual, valoresExtraidos)` que devolve só os campos alterados, aplicando a regra "não sobrepor com vazio" e a lista de campos protegidos. Testado em `property-import.server.test.ts`.
- `src/routes/_authenticated/imoveis.tsx`: diálogo de confirmação com a tabela de diferenças quando a referência já existe.
- Limpeza do duplicado: operação de dados pontual, sem alteração de esquema.
