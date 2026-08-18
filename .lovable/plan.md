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

## Reimportação do ficheiro preenchido (mesma sprint)
Na mesma página, um bloco **"Reimportar ficheiro preenchido"**:

1. Escolher o CSV/XLSX exportado e preenchido na coluna `telefone_novo`.
2. O ficheiro é lido no browser (`xlsx` lê ambos os formatos) e transformado em linhas `{ id_linha, search_ids[], telefone_novo }`.
3. **Pré-visualização antes de gravar**: quantas linhas vão ser atualizadas, quantas ignoradas (sem `telefone_novo`), e quantas inválidas (telefone com menos de 9 dígitos após normalização PT, ou `search_ids` vazio/desconhecido).
4. Botão **"Atualizar procuras"** aplica em lote; no fim mostra o resumo (procuras atualizadas, linhas ignoradas, erros por linha) e recarrega a lista.

Regras de segurança e integridade:
- Só linhas com telefone válido são gravadas; o resto é reportado, nunca gravado a meio.
- `search_ids` são validados contra procuras existentes e não expiradas; IDs desconhecidos são reportados como erro dessa linha e não bloqueiam as restantes.
- Reutiliza a mesma lógica de gravação já usada pelo botão "Guardar" de cada cartão (mesma normalização de telefone e mesmos efeitos a jusante), agora numa nova server function em lote com validação admin.
- Processamento em blocos para ficheiros grandes, com barra de progresso, ao estilo da página Importar.

## Notas técnicas
- Geração/leitura no browser: `xlsx` (já dependência do projeto) para .xlsx; CSV escrito à mão com BOM UTF-8 e separador `;` para abrir corretamente no Excel PT.
- Novo utilitário `src/lib/review-export.ts`: construção das linhas, download CSV/XLSX e parse do ficheiro preenchido (tolerante a variações de cabeçalho e a maiúsculas/acentos).
- Nova server function em `src/lib/review.functions.ts`: `bulkSetConsultorTelefone` (autenticada + admin), recebe as linhas validadas e devolve resumo por linha.
- `revisao.tsx` liga o botão de exportar e o painel de reimportação; sem alterações à base de dados nem ao motor de match.
