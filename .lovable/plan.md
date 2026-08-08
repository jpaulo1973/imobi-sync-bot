# Bug: clique na notificação não abre o match específico

## Causa confirmada

A notificação guarda o par completo (`buyer_source`, `buyer_ref`, `property_id`), mas o link gerado só leva a `/imoveis?open=<property_id>` ou a `/clientes` sem parâmetros.

- `src/routes/_authenticated/imoveis.tsx` declara `validateSearch` com `open`, mas o handler que abria o match a partir desse parâmetro foi removido numa sprint anterior (comentário na linha 297: "já não precisamos do handler ?open="). Resultado: chega-se à aba de Imóveis e nada abre.
- `src/routes/_authenticated/clientes.tsx` não tem `validateSearch`, pelo que `/clientes` nunca pode abrir o drawer de um comprador específico.

A marcação como lida funciona porque é feita no `onClick`, independente do destino.

## Correção

### 1. Link da notificação aponta para o par, não para a aba
`listMatchNotifications` (`src/lib/match-notifications.functions.ts`) passa a devolver o destino já resolvido com os dois lados do par:
- Imóvel é do consultor → `/imoveis?open=<property_id>&match=<buyer_source>-<buyer_ref>`
- Caso contrário (o comprador é dele) → `/clientes?buyer=<buyer_ref>&property=<property_id>`
- Procuras (`buyer_source = "search"`) que não são do consultor caem sempre no lado do imóvel.

### 2. Imóveis abre o match e destaca o comprador
- Restaurar o handler de `?open=`: ao montar (e quando o parâmetro muda), carregar o imóvel e abrir o diálogo Property Match desse imóvel — o mesmo caminho que o botão "compradores compatíveis" já usa.
- Com `?match=` presente, destacar visualmente o cartão do comprador correspondente e fazer scroll até ele. A chave já existe e coincide: os cartões usam `key = ${source}-${id}` (ex. `cliente-<uuid>`, `search-<uuid>`), exactamente o formato guardado na notificação.
- Se o par já não for compatível (dados mudaram entretanto), abre o match normalmente e mostra um aviso curto de que esse comprador já não consta da lista.

### 3. Clientes abre o drawer e destaca o imóvel
- Adicionar `validateSearch` com `buyer` e `property`.
- Com `?buyer=` presente, abrir o drawer "Imóveis compatíveis" desse comprador; com `?property=`, destacar e fazer scroll até o cartão desse imóvel.
- Fechar o drawer limpa os parâmetros do URL, para um refresh não voltar a abrir.

### 4. Sino
`NotificationBell` deixa de construir o destino localmente com `to="/imoveis"` fixo: usa o destino devolvido pelo servidor, com `search` completo. O comportamento de marcar como lida fica igual.

## Validação
- Teste automatizado novo que confirma o destino gerado para os casos possíveis (imóvel próprio vs comprador próprio, cliente vs procura), incluindo o formato da chave de match.
- Verificação manual no browser: clicar numa notificação abre o diálogo/drawer certo com o par destacado.
- Testes existentes, typecheck e build sem regressões.
- Commit e push no fim.

## Notas técnicas
- Nada é alterado em `matching-engine.ts`, nas regras de compatibilidade, no crawler ou na varredura — a mudança é de navegação/UI mais o cálculo do destino na listagem.
- Os parâmetros de URL são validados de forma permissiva (string ou `undefined`), sem enums fechados, para um link antigo nunca quebrar a página.