# Importação por URL fora do Lovable (erro "FIRECRAWL_API_KEY não configurado")

## Diagnóstico

O scraping vive em `src/lib/property-import.server.ts` (`firecrawlScrape`), chamado pela server function `importPropertyFromUrl`. Lê `process.env.FIRECRAWL_API_KEY`.

A ligação Firecrawl deste projeto é **API direta gerida pela Lovable** (não passa pelo gateway). Isso tem duas consequências importantes:

1. A chave real (`fc-...`) é gerida pela Lovable e **não é visível** — não há forma de a colar manualmente no Vercel.
2. A chave é injetada no runtime servidor da Lovable. Só existe em deploys Lovable.

## Por que a solução pedida (Edge Function) não resolve

Duas razões, ambas bloqueantes:

- O ambiente de build deste projeto **não permite criar novas Edge Functions** (o projeto não tem nenhuma; a stack é TanStack Start com server functions). Não é uma escolha de estilo — a criação está vedada.
- Mesmo que existisse, os secrets dos conectores **não são injetados nos secrets das Edge Functions**. A Edge Function ficaria exatamente com o mesmo `FIRECRAWL_API_KEY` em falta. Este ponto é diferente do caso `SUPABASE_SERVICE_ROLE_KEY`, onde a chave existia mesmo do lado da Supabase.

Ou seja: mover o código para uma Edge Function não faria a chave aparecer.

## Opções reais (escolhe uma)

### Opção 1 — Publicar na Lovable (recomendada, zero código)
Usar `imobi-sync-bot.lovable.app` (ou domínio próprio apontado à Lovable) como runtime da app. A chave Firecrawl é injetada automaticamente e a importação por URL passa a funcionar. Nada a alterar no código.

### Opção 2 — Firecrawl BYOK + variável no Vercel
1. Criar uma **nova ligação Firecrawl em modo "própria chave"** com uma API key tua da Firecrawl (assim conheces o valor).
2. Adicionar `FIRECRAWL_API_KEY=fc-...` nas Environment Variables do projeto Vercel (Production + Preview) e redeploy.
3. Código: sem alterações funcionais; apenas melhoro a mensagem de erro para indicar exatamente onde configurar a chave em cada ambiente.

### Opção 3 — Proxy no runtime Lovable
Criar em `src/routes/api/public/scrape-property.ts` um endpoint que corre no deploy Lovable (onde a chave existe) e que a app no Vercel chama por HTTP, com um segredo partilhado (`SCRAPE_PROXY_SECRET`) definido nos dois lados.

- Novo ficheiro: `src/routes/api/public/scrape-property.ts` (valida `Authorization: Bearer <SCRAPE_PROXY_SECRET>`, valida o URL contra allowlist Century21/Idealista/Imovirtual, chama Firecrawl, devolve o objeto de imóvel extraído).
- `src/lib/property-import.server.ts`: se `FIRECRAWL_API_KEY` existir → caminho atual; senão, se `SCRAPE_PROXY_URL` + `SCRAPE_PROXY_SECRET` existirem → delega no proxy; senão erro explicativo.
- Sem alterações no frontend nem em `importPropertyFromUrl`.

Custo: mantém uma dependência do deploy Lovable estar vivo, e é mais uma superfície pública a proteger.

## Recomendação

Opção 1 se o Vercel não for obrigatório. Se for obrigatório, Opção 2 (mais simples e sem infraestrutura extra). Opção 3 só se não quiseres gerir uma chave Firecrawl própria.

Diz-me qual segues e implemento.
