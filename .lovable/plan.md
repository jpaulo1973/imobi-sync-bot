# Plano — 7 correções/funcionalidades independentes

Cada item é uma sprint isolada, implementada e validada separadamente. Ordem sugerida por risco: 1 → 7 → 2 → 4 → 3 → 6 → 5.

## 1. Radar (e restantes páginas Admin) exclusivas de Admin

- **Navegação**: mover o link `Radar` para dentro do bloco `isAdmin` em `src/routes/_authenticated.tsx` (o contador de não vistos também deixa de correr para consultores).
- **Rota**: o gate actual só verifica sessão. Criar um guard de papel reutilizável: server function `requireAdmin()` (via `has_role(auth.uid(),'admin')`) e usá-la no `beforeLoad` de cada rota Admin (`radar`, `cruzar`, `importar`, `revisao`, `utilizadores`, `manutencao`) com `redirect({ to: "/imoveis" })` quando não for admin. Corrige o acesso por URL directo em todas — hoje todas têm a mesma falha (só o menu esconde).
- **Backend**: auditar as server functions consumidas por essas páginas e adicionar verificação de admin nas que hoje só exigem sessão (radar/oportunidades globais, importação, revisão, backfill, manutenção). RLS/RPC: garantir que as RPC de pool/oportunidades filtram por `user_id` para não-admin.
- **Validação**: testes de que as funções admin rejeitam consultor; verificação manual com conta consultor a tentar `/radar` por URL.

## 2. Alerta de perfil incompleto

- `getMyProfile` passa a devolver `missingFields` (telemóvel, agência, WhatsApp).
- Novo componente `ProfileCompletionGate` no layout autenticado: quando há campos em falta, mostra diálogo/banner persistente com CTA para `/perfil`. Bloqueia navegação de forma suave (diálogo não descartável até completar, com opção "Ir para o perfil").
- Após gravar perfil, o evento `pm:profile-updated` já existente refresca o estado e o alerta desaparece.

## 3. Ajuda/Sugestões — estados e respostas

- **Migração**: em `support_requests` adicionar `status text not null default 'aberto'` (`aberto`|`resolvido`), `arquivado boolean not null default false`, `resolved_at`, `resolved_by`; nova tabela `support_replies` (id, request_id, author_id, mensagem, created_at) com GRANTs + RLS (autor do pedido lê as suas; admin lê/escreve todas). `read_at` mantém-se para compatibilidade mas deixa de ser o estado.
- **Server functions**: `listSupportRequests` (filtros estado/arquivado, com respostas), `replyToSupportRequest` (admin), `resolveAndArchiveSupportRequest` (soft-delete), `listMySupportRequests` (consultor).
- **UI**: em Manutenção, lista com badge Aberto/Resolvido, caixa de resposta e botão "Marcar resolvido e arquivar" (substitui eliminar); filtro para ver arquivados. No `SupportDialog` do consultor, aba/histórico das suas mensagens e respostas do admin.
- **Opcional (incluído)**: inserir `match_notifications`-like entrada no sino quando o admin responde — reutilizar a tabela de notificações com um tipo `suporte`, ou tabela genérica se o esquema actual não permitir sem quebrar o Radar; decisão tomada na implementação para não degradar as notificações de match.

## 4. Revisão "Sem localização" — eliminar/rejeitar

- **(a)** Botão "Não é uma procura / descartar" em cada cartão da aba Sem localização: server function `discardSearch(id)` que faz soft-delete (nova coluna `descartado boolean` + `descartado_motivo`) e limpa oportunidades/notificações associadas. Soft-delete preserva auditoria e evita reimportação (fica na chave de dedup).
- **Origem**: auditar amostra de leads classificados como procura mas que são oferta (anúncios). Se houver padrão, reforçar o prompt do splitter/extração com um classificador oferta-vs-procura e descartar ofertas na ingestão, com contagem no relatório.
- **(b)** Query de identificação das ~52 procuras `origem = 'excel'` com texto Dubai/EAU → apresentar lista (id, texto, contacto) para confirmação antes de aplicar o descarte em lote.
- **(c)** Filtro "fora de Portugal" na aba Sem localização (heurística por termos/país não resolvido) com acção de descarte em lote, aplicável a qualquer geografia futura.

## 5. Nova taxonomia de Tipo de imóvel + orçamento condicional

- **Taxonomia** (`src/lib/property-taxonomy.ts`, fonte única): categorias de topo `casas_apartamentos`, `predios`, `escritorios`, `comercial_armazens`, `trespasses`, `terrenos`, `herdades_quintas`, com subtipos e mapa de sinónimos/normalização (resolve o CamelCase das procuras vs minúsculas dos imóveis).
- **(a) Migração**: colunas `categoria` em `properties` e `criteria.categorias` nas procuras; script mostra a contagem por categoria nova antes de aplicar; texto original preservado em características/notas.
- **(b) Motor**: hard filter por categoria de topo (default: só mesma categoria), substituindo a comparação textual actual em `matching-engine.ts`. Elimina o caso T3 vs lar de idosos.
- **(c)** Correcções pontuais: lar de idosos (`a181fdb7…`) → `trespasses`; prédio de Miragaia mantém `predios` com distrito corrigido para Porto; moradia T2 para recuperar mantém `casas_apartamentos`.
- **(d)** Campo opcional `estado_desejado` na procura (`novo`|`bom`|`recuperar`|null) + campo equivalente/inferido no imóvel.
- **(e)** `budget_max_obras` e `budget_max_pronto` opcionais; o motor escolhe conforme o estado do imóvel candidato, com fallback ao orçamento único. Prompts da IA (import por URL, Excel, splitter WhatsApp) actualizados para extrair os dois valores e o estado desejado.
- **(f)** Testes de regressão por categoria e por orçamento condicional; relatório antes/depois com contagens de mudança de categoria.

## 6. Zona funcional "Costa Vicentina"

- Selecção por freguesias litorais (não concelhos inteiros), de Sines a Sagres, usando `location_metadata` (centróides) com corte a ~10 km da linha de costa, restrito a Sines, Odemira, Aljezur e Vila do Bispo.
- Apresentar a lista exacta de freguesias proposta para confirmação; só depois criar a zona (`locations` tipo `zona_funcional` + `functional_zone_members`) e incrementar `geo_library_version`.

## 7. Aliases + rótulo do painel

- **(a)** Inserir aliases aprovados `gaia` → Vila Nova de Gaia e `vilamoura` → Loulé (`origem = 'manual'`), validando que não criam ambiguidade.
- **(b)** Em `src/routes/_authenticated/manutencao.tsx` linha ~265: rótulo passa a "Total de procuras analisadas" e acrescenta-se "Sem localização: {resolvidas + por resolver}" para os números somarem de forma legível. Só texto, cálculos intactos.

## Notas técnicas

- Itens 3, 4 e 5 exigem migrações de esquema (aprovação de migração); 6 e 7 são dados geográficos.
- Item 5 é o de maior impacto no Motor de Match: implementado por último, com testes de regressão a correr antes e depois.
- Nenhum item altera a arquitectura geográfica (Canal → Repo → Parser → IDs → Motor).
