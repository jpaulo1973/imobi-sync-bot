# Lote de melhorias — 17/08/2026

## 1. Perfil do consultor com campos obrigatórios

Campos obrigatórios: **nome, telemóvel, agência, email, WhatsApp**. AMI fica opcional.

- Nova coluna `whatsapp` e `ami` em `profiles` (migração).
- No formulário de Perfil: telemóvel + checkbox "WhatsApp é o mesmo número". Se desmarcada, aparece campo WhatsApp próprio e é obrigatório.
- Email: hoje vem da autenticação e não é editável. Passa a campo do perfil pré-preenchido com o email da conta e obrigatório (guardado em `profiles.email` para efeitos de contacto entre consultores).
- Validação com Zod no cliente e no servidor (`updateMyProfile`); botão Guardar bloqueado e mensagens de erro por campo enquanto faltar algum obrigatório.
- Aviso no topo do Perfil quando faltam campos obrigatórios, para quem já tem conta antiga.

## 2. Botão "Ajuda / Sugestão"

- Botão no cabeçalho da área do consultor (junto ao sino) que abre um diálogo com um único campo de texto livre e botão Enviar.
- Nova tabela `support_requests` (mensagem, autor, nome, email, data, estado lido) com RLS: cada consultor insere/lê os seus; admins leem todos.
- Server function autenticada grava o pedido, incluindo automaticamente nome e email do consultor.
- Confirmação ao consultor: "Mensagem enviada, obrigado!".
- Admins veem os pedidos num painel na página Manutenção, com contador de não lidos.
- Envio por email ao Admin fica implementado mas desativado (ainda não existe domínio de email configurado). Quando o domínio for configurado, basta ligar a flag — nunca WhatsApp.

## 3. Notas / Observações na procura de Cliente

O campo já existe em Clientes; passa a estar claro e a ser reutilizado:

- Rótulo "Notas / Observações" com texto de ajuda a explicar o objetivo (critérios subjetivos ou informais).
- Continua opcional e disponível na criação e na edição.

## 4. Mensagem original nos cartões de match/notificação

- Procuras WhatsApp: mostrar o texto completo da mensagem original (campo já guardado na importação) no cartão de match, no Radar e na vista do consultor, dentro de um bloco recolhível "Mensagem original".
- Procuras de origem Cliente: mostrar as Notas / Observações no mesmo bloco, quando preenchidas.
- Sem alterações ao motor de match nem às regras de privacidade do proprietário.

## 5. Foco do cartão a partir da notificação WhatsApp

- Ao chegar via notificação, o Radar abre um painel lateral dedicado com essa procura em detalhe (critérios, mensagem original, contactos e imóveis compatíveis), em vez de apenas destacar o cartão na lista.
- Mantém-se o destaque visual e o scroll até ao cartão por baixo, e o aviso quando a procura não existe/expirou.
- Cliques em notificações diferentes na mesma sessão continuam a funcionar.

## Notas técnicas

- Migração: `profiles.whatsapp`, `profiles.ami`, `profiles.email`; nova tabela `public.support_requests` com GRANTs, RLS e política de admin via `has_role`.
- Ficheiros principais: `src/lib/profile.functions.ts`, `src/routes/_authenticated/perfil.tsx`, `src/routes/_authenticated.tsx`, novo `src/components/SupportDialog.tsx` + `src/lib/support.functions.ts`, `src/routes/_authenticated/manutencao.tsx`, `src/routes/_authenticated/clientes.tsx`, `src/routes/_authenticated/radar.tsx`, `src/lib/active-searches.functions.ts` e `src/lib/buyer-opportunities.functions.ts` (expor texto original / notas).
- Validação: typecheck, testes existentes e verificação manual de cada ponto; depois Publish.
