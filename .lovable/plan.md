# Lote 19/08 — 6 zonas novas, 2 bugs, sugestões na Revisão, importação múltipla

Cada item é independente e será implementado e validado isoladamente, pela ordem abaixo.

## A. Zonas geográficas (itens 1-6)

Todas as zonas entram como `locations` de tipo `zona_funcional` (mesmo padrão da Costa Vicentina), com membros em `functional_zone_members` e aliases em `location_aliases`. Uma única migração por zona, seguida de um incremento final de `geo_library_version` para **5**.

1. **Centro** — membros: os 6 distritos inteiros (Aveiro, Coimbra, Leiria, Viseu, Guarda, Castelo Branco). Aliases: `centro`, `zona centro`, `regiao centro`.
2. **Vale do Sousa** — membros: 6 concelhos (Castelo de Paiva, Felgueiras, Lousada, Paços de Ferreira, Paredes, Penafiel). Aliases: `vale do sousa`, `vale sousa`.
3. **Margens do Rio Douro** — zona ao nível de freguesia, com as 22 freguesias exatas indicadas (8 margem norte, 14 margem sul). Cada nome é resolvido contra `locations` pelo par (freguesia, concelho) antes de inserir; qualquer freguesia que não exista com esse nome exato é reportada no relatório final em vez de ser inventada. Aliases: `margens do rio douro`, `margens do douro`, `rio douro`.
   - Notas de mapeamento: "Cinfães", "Castelo de Paiva", "Souselo", "Espadanedo", "Barrô", "Paus", "Samodães", "Penajóia" etc. são resolvidos como freguesia do respetivo concelho (nunca como concelho homónimo).
4. **Costa da Prata** — concelhos: Nazaré, Caldas da Rainha, Óbidos, Peniche, Lourinhã, Torres Vedras, Bombarral, Alcobaça, Marinha Grande, Figueira da Foz, Mira. **São Martinho do Porto** e **Vieira de Leiria** são freguesias (de Alcobaça e Marinha Grande), já cobertas pelos concelhos; entram como membros de nível freguesia apenas se quiseres granularidade — por omissão ficam cobertas pelo concelho. Aliases: `costa da prata`.
5. **Algarve** — membros: os 16 concelhos do distrito de Faro. Aliases: `algarve`, `sul`, `barlavento`/`sotavento` não são adicionados (ambíguos). Só `algarve`.
6. **Portugal Continental** — zona nacional cujos membros são os 18 distritos do continente (exclui Açores e Madeira). Aliases: `portugal continental`, `continente`, `todo o pais`, `qualquer zona do continente`, `portugal`. Fica selecionável no `LocationSelector` como qualquer outra zona; o Motor Match já expande membros de zona funcional, pelo que uma procura marcada com esta zona passa o filtro de localização para qualquer imóvel do continente.

Validação das zonas: testes de matching por ID (procura com a zona ↔ imóvel numa freguesia membro = OK; imóvel fora = FAIL), e contagem de membros por zona confirmada em base de dados.

## B. Bug — notificação não abre o cartão da procura (item 8)

Causa: notificações de procuras (`buyer_source = "search"`) apontam para `/radar`, mas o Radar passou a ser exclusivo de Admin — o consultor é redirecionado para `/imoveis` sem parâmetros e nada abre.

Correção: o destino passa a depender do perfil de quem lê a notificação. Em `listMatchNotifications`, quando o utilizador não é Admin, uma notificação de procura aponta para `/imoveis?open=<property_id>&match=search-<buyer_ref>` (o par abre no diálogo Property Match do imóvel dele, com o cartão da procura destacado). Admins continuam a ir para o Radar. Teste novo em `match-notifications.target.test.ts` a cobrir admin vs não-admin.

## C. Bug — "Sem sinal de investidor/bulk" nas notificações (item 9)

O filtro de investidor devolve essa frase como motivo positivo, e ela entra no `reason_summary` das notificações. Correção: o filtro deixa de produzir texto quando não há sinal (categoria neutra sem descrição), e o `reasonSummary` filtra motivos vazios. Não altera decisões de match, apenas o texto. Regressão coberta por teste.

## D. Sugestão automática de localizações semelhantes na Revisão (item 7)

Ao guardar uma resolução manual, o sistema procura outras procuras pendentes cujo texto geográfico normalizado seja igual ou muito próximo (mesma forma normalizada, ou distância de edição pequena / prefixo comum) e propõe aplicar a mesma resolução em bloco: "Encontrámos N entradas com localização parecida — aplicar a mesma interpretação?". Nada é aplicado sem confirmação. Ao confirmar, as N entradas recebem os mesmos `location_ids` e o alias é promovido uma única vez.

## E. Importação de múltiplos ficheiros Excel (item 10)

A função de juntar ficheiros é removida e substituída por seleção múltipla na página Importar:

- O input aceita vários ficheiros; cada um é lido e processado com o mesmo pipeline atual (deteção de cabeçalhos, chunks, progresso), partilhando um único `batch_id`.
- Progresso passa a mostrar ficheiro atual e total agregado.
- **Deduplicação automática, sem lista prévia nem confirmação**, usando o critério já existente (`buildDedupKey`: nome/telefone/localização/tipo) mais o desempate por similaridade já implementado: dentro da mesma sessão (entre ficheiros) e contra o que já existe na base de dados. Duplicado exato funde no registo existente; alta similaridade atualiza; o resto entra como novo.
- O relatório final é agregado com uma coluna extra de ficheiro de origem, e os contadores atuais mantêm-se (novas, atualizadas, duplicados fundidos, ignoradas, erros).

Recomendação sobre o critério: manter o critério atual como base (é o mesmo que já garante idempotência no WhatsApp), reforçado com o telefone normalizado como chave dominante quando existe — é o sinal mais fiável e evita fundir compradores diferentes com nomes parecidos.

## Validação final

Suite completa de testes (atualmente 123), com os novos testes de zonas, notificações e dedup multi-ficheiro. Relatório final por item com contagens reais em base de dados.
