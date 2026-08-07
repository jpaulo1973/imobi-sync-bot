# Notificações de Match — tabela leve + sino na app

Sem persistir matches. Os matches continuam a ser calculados na hora pelo motor atual. Guarda-se apenas o registo de "já notifiquei este par cliente+imóvel".

## O que vai ser feito

### 1. Tabela de notificações
Nova tabela `match_notifications`:
- `user_id` — consultor destinatário
- `pair_key` — identifica o par cliente+imóvel (chave única por consultor, evita duplicados)
- `buyer_source` (`buyer` ou `search`), `buyer_ref`, `property_id`
- `buyer_label` (nome do cliente / referência da procura), `property_label`, `score`, `reason_summary` (resumo curto do critério que bateu)
- `read_at` (nulo = não lida), `created_at`
- Restrição de unicidade `(user_id, pair_key)`: reprocessar o mesmo par nunca cria segunda notificação
- Regras de acesso: cada consultor vê, marca como lida e apaga apenas as suas notificações

### 2. Varredura de matches novos
Nova função de servidor `sweepMatchNotifications`:
- Usa exactamente o motor existente (`scoreMatch`), sem qualquer alteração ao `matching-engine.ts` nem às regras de compatibilidade
- Para o consultor autenticado: cruza os seus imóveis activos com os seus compradores activos e com as procuras activas da base global
- Para cada par compatível com score ≥ 60 monta o `pair_key` e faz inserção ignorando conflitos — só pares nunca notificados geram notificação
- Notifica o dono do cliente e o dono do imóvel; se for o mesmo consultor, apenas uma notificação
- É chamada quando o utilizador entra na app e periodicamente (a cada ~5 min) pelo próprio sino

### 3. Sino na barra existente
- Novo componente `NotificationBell` acrescentado à barra de navegação actual (Consultor e Admin), sem mexer em abas nem permissões
- Contador de não lidas; ao abrir mostra as mais recentes primeiro com cliente/imóvel, score e resumo do critério
- Cada item abre o match directamente na página de cruzamento
- Marca como lida ao abrir o item; botão "Marcar todas como lidas"

### 4. Email — fica preparado, não activado
O envio de email exige um domínio de envio próprio, que este projecto ainda não tem configurado. Nesta sprint fica:
- A coluna que registará o envio (`emailed_at`) já criada
- A lógica de agrupamento por "onda" (um único email por consultor por varredura, com os matches novos e link directo) escrita mas desligada
Assim que o domínio de email estiver configurado, activa-se numa sprint curta sem mexer no resto.

### 5. Validação final
- Typecheck e build
- Suite de testes existente sem regressões
- Teste novo que confirma que a segunda varredura sobre os mesmos dados não cria notificações adicionais

## Notas técnicas
- `pair_key` = `${buyer_source}:${buyer_ref}:${property_id}`; a unicidade é garantida na base de dados, não em código
- Inserção em lote com `upsert` + `ignoreDuplicates`, para a varredura ser idempotente e barata
- A varredura reutiliza um único `GeoMatchIndex` por execução (mesmo padrão já usado na importação em lote)
- Nada do crawler nem da extensão Companion é tocado
