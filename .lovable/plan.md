
# Sprint 1 — Property Match MVP

## 1. Rebranding: Cross Match → Property Match

Alterar todas as strings visíveis e referências internas de "Cross Match" / "cruzar" / "ImoMatch" (quando aplicável ao produto) para **Property Match**.

Alvos identificados:
- `public/manifest.webmanifest` — `name`, `short_name`, `description`.
- `src/routes/__root.tsx` — `<title>`, meta description, OG tags.
- `src/routes/_authenticated.tsx` — nome no header/sidebar.
- `src/routes/_authenticated/cruzar.tsx` — títulos, botões, mensagens (mantenho a rota `/cruzar` para não partir links; o label passa a "Property Match").
- Títulos de páginas em `imoveis.tsx`, `clientes.tsx`, `portais.tsx`, `utilizadores.tsx` (sufixo "— Property Match").
- `src/routes/auth.tsx` — nome do produto.
- Toasts / textos em `.functions.ts` que mencionem cruzamento passam a "Property Match".
- `AGENTS.md` e `.lovable/project.json` (nome descritivo apenas).

Não altero: nome do repo, IDs Supabase, nomes de tabelas/colunas, nome do package (`package.json` `name`) — evita rebuilds pesados sem valor funcional.

## 2. Importação Century 21 mais robusta + apenas campos essenciais

Reescrever `importPropertyFromUrl` em `src/lib/properties.functions.ts`:

**Extração (Firecrawl):**
- Chamar Firecrawl com `formats: ["markdown", "html"]`, `onlyMainContent: false`, `waitFor: 3500`, e passar `includeTags` úteis. Fallback: se markdown vier vazio, extrair texto do HTML como já faz.
- Aumentar limite de conteúdo para 60k chars (Century 21 tem páginas grandes).
- Se Firecrawl devolver 402/erro → mensagem clara em português.

**Schema essencial (novo):**
```
referencia, tipo_imovel (apartamento|moradia|terreno|outro),
tipologia (T0..T5+|Moradia),
preco (number),
distrito, concelho, freguesia, zona,
area_util_m2,
garagem (bool|null), elevador (bool|null),
jardim (bool|null), piscina (bool|null),
finalidade (venda|arrendamento)
```

**Prompt IA:** instruções específicas para Century 21 (padrões de URL, breadcrumb "Distrito › Concelho › Freguesia", label "Área útil", ícones de características). Devolver `null` quando não encontrar — nunca inventar. Modelo: `google/gemini-2.5-flash`.

**Importação parcial:**
- Nunca rejeitar por falta de campos. Só falha se **nem preço nem localização nem tipologia** vierem (imóvel vazio real).
- Devolver `{ property, missing_fields: string[] }` para o frontend indicar o que preencher.

**Alterações de schema (migração):**
Adicionar colunas a `public.properties`:
- `tipo_imovel text`
- `distrito text`, `freguesia text`
- `area_util_m2 numeric` (mantém `area_m2` para compatibilidade; nova coluna é a canónica para match)
- `garagem boolean`, `elevador boolean`, `jardim boolean`, `piscina boolean`

Todas nullable, sem defaults destrutivos. Não removo colunas existentes.

## 3. UI de imóveis: preenchimento manual dos campos em falta

Em `src/routes/_authenticated/imoveis.tsx`:
- Após importar, se `missing_fields.length > 0`, abrir automaticamente o diálogo de edição pré-preenchido com o que foi importado e destacar os campos em falta (badge "em falta").
- Formulário de criação/edição passa a incluir os novos campos essenciais (distrito, freguesia, zona, área útil, tipo, checkboxes garagem/elevador/jardim/piscina).

## 4. Property Match automático após criar/importar

Novo server fn `runPropertyMatch({ propertyId })` em `src/lib/property-match.functions.ts`:
- Carrega o imóvel e todos os `buyer_clients` ativos do user.
- Score determinístico (finalidade, tipo, tipologia, preço dentro do budget, área ≥ min, quartos, localização hierárquica distrito→concelho→freguesia→zona, garagem/elevador obrigatórios do comprador).
- Devolve top 20 compradores com `score` e `reasons[]`.

Fluxo automático:
- No `imoveis.tsx`, após `save()` bem sucedido ou após `importFn()`, chamar `runPropertyMatch` com o id do imóvel criado e mostrar um **painel de resultados imediato** (drawer/dialog) com a lista ordenada e contactos (nome, telefone, email, botão "abrir WhatsApp").
- Sem botão manual para lançar o match; o botão só existe para **re-executar** num imóvel já existente (ícone Sparkles no cartão).

## 5. Localização — estrutura pronta para futuro

- Guardar `distrito`, `concelho`, `freguesia`, `zona` separadamente (feito em §2).
- Score de localização hierárquico com pesos decrescentes: freguesia exata > mesma zona > mesmo concelho > mesmo distrito. Ainda sem "zonas vizinhas" — apenas correspondência textual normalizada (lowercase + strip acentos).
- Deixar helper `normalizeLocation()` isolado para futura expansão (proximidade por lista de zonas relacionadas).

## 6. Página `/cruzar`

Mantém-se para o fluxo WhatsApp (leads → imóveis), mas renomeada para "Property Match — Leads WhatsApp" para deixar claro que é o caminho inverso. Sem alterações funcionais nesta Sprint.

## Critérios de aceitação
- App inteira diz "Property Match".
- Importar link Century 21 com campos parciais cria sempre o imóvel e sinaliza o que falta.
- Após criar/importar imóvel, resultados de compatibilidade aparecem sem clique adicional.
- Compradores ordenados por score, com razões visíveis.

## Fora do âmbito (Sprint 2+)
- Proximidade por zonas vizinhas / geocoding.
- Importação de outros portais (Idealista, Imovirtula, etc.) com o mesmo nível de robustez.
- Notificações automáticas ao comprador.
