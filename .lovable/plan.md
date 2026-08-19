# Contactos persistentes + dedup mais forte na importação Excel

## Diagnóstico (feito agora, sobre dados de produção)

**Porque é que a dedup não apanhou o caso Casa Bella**

O `buildDedupKey` não decide nada — é só um *hint* guardado em `dedup_key`. A decisão real está em `upsertOne()`:

1. Candidatos são procurados **exclusivamente por `contact_telefone` normalizado** (telefone do comprador).
2. Sem `contact_telefone` → devolve imediatamente `"sem telefone — criada como nova"`. Nunca compara nada.
3. Com telefone: curto-circuito `isExactDuplicate` (nome + texto + assinatura de critérios), depois score 0-100, depois IA entre 80-94.

O caso Casa Bella cai no ponto 2: as 4 procuras têm `contact_telefone` vazio e o número (920505485) está em `consultor_telefone`, que a dedup **ignora por completo**. Não há janela de tempo envolvida — o problema é a chave.

Nota importante que encontrei: as 4 linhas "Casa Bella" **não são o mesmo pedido** (Torres Vedras / espaço comercial Lisboa / moradia Lisboa / prédio Fontes). São procuras distintas do mesmo consultor — logo não devem ser fundidas entre si. O que falta é o telefone ser reconhecido como já conhecido, não uma fusão.

**Volume de duplicados hoje em produção** (procuras não descartadas: 2.971)

| Métrica | Valor |
|---|---|
| Grupos com mesmo nome + mesmo texto original | 390 |
| Linhas nesses grupos | 983 |
| **Linhas excedentes (candidatas a fusão)** | **593** |
| Grupos gerados em datas de importação diferentes | 49 |
| Excedentes em linhas sem `contact_telefone` | 21 |
| Procuras sem `contact_telefone` | 115 |
| Nomes distintos (consultor/contacto) | 965 |

Causas dos 593 excedentes, por `decision_reason`:
- 331 sem motivo (criadas antes da telemetria de decisão)
- 177 já marcadas "duplicado exato (auto-merge)" — fundidas mas o irmão ficou
- 72 "Procura ambígua — rever manualmente"
- 29 "sem telefone — criada como nova" ← o gap deste pedido
- 3 IA indisponível (CREDITS_EXHAUSTED) → mantidas separadas por segurança

## (a) Tabela de contactos persistente

Nova tabela `public.contacts`:

- `id`, `user_id`, `nome_normalizado` (chave), `nome_display`, `telefone` (normalizado 9 dígitos), `email`, `agency`, `origem` (`import` | `revisao` | `manual`), `times_seen`, `last_seen_at`, `created_at`, `updated_at`
- Único: `(user_id, nome_normalizado, telefone)`; índice adicional em `(user_id, nome_normalizado)`
- GRANTs para `authenticated` + `service_role`; RLS por `user_id` e leitura para admin via `has_role`
- RPC `SECURITY DEFINER` `contacts_upsert(p_nome text, p_telefone text, p_email text, p_agency text, p_origem text)` para escrita idempotente com incremento de `times_seen`
- RPC `contacts_lookup(p_nomes text[])` para leitura em lote (uma query por batch de importação, não por linha)

Integração:
1. **Importação Excel** — antes do loop, carregar `contacts_lookup` para todos os nomes do ficheiro; quando a linha não traz telefone, preencher a partir do contacto conhecido e registar em `decision_reason` (`telefone recuperado do contacto conhecido`). Quando a linha traz telefone novo, gravar/atualizar em `contacts`.
2. **Revisão → `telefone_novo`** — `bulkSetConsultorTelefone` passa a escrever também em `contacts`, para o número ficar disponível em importações futuras.
3. **Directory existente** (`consultor_directory` sobre `profiles`) mantém prioridade: `profiles` → `contacts` → ficheiro.

## (b) Dedup mais forte na importação

Alterações em `upsertOne()` (afeta Excel, WhatsApp, texto e captura — mesma porta de entrada):

1. **Telefone efetivo**: chave passa a ser `contact_telefone` **ou** `consultor_telefone` normalizado (o primeiro válido), depois de enriquecido por `contacts`.
2. **Segundo caminho de candidatos**: quando não há telefone nenhum, procurar por `(user_id, nome normalizado)` em vez de desistir. Removido o atalho `"sem telefone — criada como nova"`.
3. **Chave de identidade da pessoa** = `nome normalizado + telefone efetivo`; o scoring de similaridade dos critérios continua a decidir se é a **mesma procura** (fusão) ou uma **procura nova da mesma pessoa** (linha nova, sem duplicar). Isto preserva o caso Casa Bella: mesma pessoa, 4 necessidades diferentes → 4 linhas legítimas.
4. **Sem janela de tempo**: fusão passa a ser independente da data de importação; `data_origem`/`hora_origem` mais recentes ganham no merge.
5. **Fallback quando a IA está indisponível**: hoje `CREDITS_EXHAUSTED` mantém separado. Passa a fundir quando o texto original é idêntico (Jaccard ≥ 0,95), evitando duplicados por indisponibilidade.
6. Testes de regressão em `src/lib/dedup*.test.ts`: reimportação sem telefone funde; mesma pessoa com procura diferente não funde; telefone só em `consultor_telefone` entra na dedup.

## Duplicados já existentes — proposta (nada é apagado sem aprovação visual)

Sem qualquer alteração de dados nesta fase. Proposta:

1. Novo painel **"Duplicados"** em Manutenção, listando os 390 grupos (mesmo nome + mesmo texto), com contagem, datas, origem e o texto original de cada linha.
2. Cada grupo mostra o **registo primário sugerido** (o mais antigo com mais dados preenchidos) e os irmãos a fundir.
3. Ações **por grupo**, uma a uma: `Fundir` (aplica o mesmo `mergeInto`, preservando telefone/localizações/notificações e apontando `match_opportunities` para o primário) ou `Manter separados` (marca o grupo como revisto e não volta a aparecer).
4. Ação em massa **"Fundir todos os grupos revistos"** só depois de percorridos manualmente — e mesmo essa com diálogo de confirmação e contagem exata.
5. Nenhum `DELETE`: os irmãos são fundidos e marcados `descartado = true` com `descartado_motivo = 'fundido em <id>'`, recuperáveis pelo `admin_restore_search` já existente.

## Notas técnicas

- Migração: `contacts` + 2 RPCs `SECURITY DEFINER` com `search_path = public` e GRANTs no mesmo ficheiro.
- `contacts_lookup` em lote evita N+1 na importação (o gargalo já corrigido em sprints anteriores).
- `dedup_key` mantém-se como hint; não passa a identificador único.
- O painel de duplicados reutiliza `mergeInto` para não duplicar lógica de fusão.
