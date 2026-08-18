# Exportar lista da Revisão (CSV / Excel)

## Objetivo
Descarregar a lista atual da página **Revisão — Contactos sem telefone** para poder tratar os contactos fora da app e voltar a cruzar/atualizar depois.

## Identificador único de cada linha
Cada cartão da Revisão é um **grupo** de procuras do mesmo consultor/contacto. Para permitir o cruzamento de volta, a exportação inclui:

- `id_linha` — a chave de agrupamento já usada internamente (estável para o mesmo nome/contacto)
- `search_ids` — lista das procuras afetadas, separadas por `;`
- `procuras_afetadas` — quantidade

Assim, uma futura reimportação pode atualizar exatamente as mesmas procuras (por `search_ids`), sem ambiguidade.

## Colunas do ficheiro
| Coluna | Conteúdo |
|---|---|
| id_linha | identificador único da linha/grupo |
| nome | nome do consultor/contacto (ou vazio) |
| telefone_atual | valor bruto existente (inválido) se houver |
| telefone_novo | **coluna vazia**, para preencher fora da app |
| email | email conhecido, se existir |
| agencia | agência, se conhecida |
| procuras_afetadas | número de procuras |
| search_ids | IDs separados por `;` |
| exportado_em | data/hora da exportação |

## Comportamento na página
- Botão **"Exportar"** no cabeçalho, com dois formatos: **Excel (.xlsx)** e **CSV**.
- Exporta exatamente o que está em ecrã (a lista carregada), sem novo pedido ao servidor.
- Desativado enquanto carrega ou se a lista estiver vazia.
- Nome do ficheiro: `revisao-contactos-YYYY-MM-DD.xlsx` / `.csv`.

## Notas técnicas
- Geração no browser: `xlsx` (já dependência do projeto) para .xlsx; CSV escrito à mão com BOM UTF-8 e separador `;` para abrir corretamente no Excel PT.
- Novo utilitário `src/lib/review-export.ts` com a construção das linhas + as duas funções de download; `revisao.tsx` só liga o botão (dropdown existente do shadcn).
- Sem alterações a server functions, base de dados ou motor de match.

## Fora de âmbito (nesta sprint)
Reimportação do ficheiro preenchido para atualizar telefones em massa — fica preparada pela presença de `search_ids` e `telefone_novo`, mas implementa-se num pedido seguinte se quiser.
