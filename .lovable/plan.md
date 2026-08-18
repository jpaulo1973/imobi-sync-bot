# Diagnóstico — "LOVABLE_API_KEY not configured" na Importação por URL (Vercel)

## 1. Onde o código usa LOVABLE_API_KEY

Só existe um ponto de leitura da chave:

- `src/lib/ai-gateway.server.ts` — `callLovableAI()` lê `process.env.LOVABLE_API_KEY` e chama
  `https://ai.gateway.lovable.dev/v1/chat/completions` (modelo `google/gemini-2.5-flash`).
  Sem a variável, lança exatamente `LOVABLE_API_KEY not configured`.

No fluxo "Importar por URL":

```text
URL -> Firecrawl (scrape HTML/markdown)  [FIRECRAWL_API_KEY]
    -> callLovableAI (estruturar anúncio em JSON)  [LOVABLE_API_KEY]  <-- falha aqui
    -> validação Zod + merge de áreas + resolução geográfica -> imóvel
```

Ficheiro/linha: `src/lib/property-import.server.ts` (chamada à IA no fim da extração, para
converter o texto do anúncio em campos: tipo, tipologia, preço, áreas, localização, extras).

O mesmo `callLovableAI` é usado por mais 5 módulos (WhatsApp leads, dedup, splitter de procuras,
normalização de localizações, matching), logo a decisão aqui afeta todo o produto, não só a
importação por URL.

## 2. Formato da chave: gateway vs BYOK

`LOVABLE_API_KEY` é uma chave interna do Lovable (gateway), emitida automaticamente para o
projeto e usada para faturação/rate-limit no runtime Lovable. Não é uma chave de fornecedor de
IA e não é o mesmo caso do Firecrawl:

- Firecrawl: a chave `fc-...` é emitida pelo fornecedor, logo pode ser colada no Vercel (BYOK).
- Lovable AI Gateway: não existe "chave própria" equivalente. O que existe é o caminho BYOK
  real: falar diretamente com um fornecedor (OpenAI/Anthropic/Google) com chave própria.

Ou seja: para produção no Vercel sem depender do runtime Lovable, é preciso trocar o transporte
de IA, não apenas configurar uma variável.

## 3. Caminhos possíveis

### Opção A — Copiar LOVABLE_API_KEY para o Vercel (mais rápido)
- Uma variável de ambiente no Vercel, zero alterações de código.
- Continua a depender do gateway Lovable (disponibilidade + créditos do projeto).
- Nota: é uma chave gerida pelo Lovable; se for rotacionada, tem de ser reposta no Vercel.

### Opção B — Camada de IA com fornecedor próprio (recomendada para produção)
Transformar `ai-gateway.server.ts` num adaptador com dois transportes, escolhidos por env:

```text
AI_PROVIDER = "lovable" | "openai"
OPENAI_API_KEY = sk-...        (Vercel: Production + Preview)
AI_MODEL = openai/gpt-5.6-sol  (default)
```

- `callLovableAI()` mantém a mesma assinatura (`messages`, `response_format`), pelo que os 6
  módulos consumidores não mudam.
- Se `AI_PROVIDER=openai` (ou só existir `OPENAI_API_KEY`), usa a API do fornecedor; caso
  contrário mantém o gateway Lovable. Preview Lovable continua a funcionar sem configuração.
- Erros passam a indicar claramente qual variável falta em cada ambiente (Lovable Cloud vs
  Vercel), no mesmo estilo já aplicado ao Firecrawl.
- Mapeamento de erros preservado: 402 -> `CREDITS_EXHAUSTED`, 429 -> `RATE_LIMITED`.

### Recomendação
Opção B, com Opção A como desbloqueio imediato se precisares de testar hoje. A Opção B é a única
que remove a dependência do runtime Lovable em produção, e é isomórfica à decisão que já tomámos
para o Firecrawl.

## Âmbito da implementação (se aprovares a Opção B)
- `src/lib/ai-gateway.server.ts`: adaptador multi-transporte + mensagens de erro por ambiente.
- Nenhuma alteração nos 6 módulos consumidores nem em regras de negócio/Motor de Match.
- Pedido da chave `OPENAI_API_KEY` via formulário seguro (não fica em código).
- Validação: importação por URL end-to-end no preview com cada transporte.
