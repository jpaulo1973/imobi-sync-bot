# Limpeza definitiva de procuras expiradas (Excel + WhatsApp)

Operação destrutiva e irreversível. **É um `DELETE` real: não existe tabela de recuperação, lixeira, backup aplicacional nem soft-delete.** Depois de aplicada, a única forma de a procura voltar é ser reimportada do grupo/ficheiro.

## 1. Como se identifica cada canal (verificado na base de dados)

`public.active_searches.origem` (texto) é o único discriminador de canal:

| Canal | Valor de `origem` | Contagem hoje |
|---|---|---|
| Importação Excel | `excel` | 2.973 |
| Lead WhatsApp | `whatsapp` | 0 (nenhuma ainda) |
| Colagem de texto / captura na app | `texto`, `captura` | 0 |

Procuras "Cliente" (compradores do próprio consultor) **não vivem nesta tabela** — vivem em `public.buyer_clients`, que a limpeza nunca toca. Ainda assim, a query é feita por lista branca explícita `origem IN ('excel','whatsapp')`, nunca por exclusão, para que qualquer valor futuro (`cliente`, `texto`, `captura`, `revisao`, …) fique automaticamente fora do alcance.

Critério de elegibilidade:
```
origem IN ('excel','whatsapp')
AND expires_at IS NOT NULL
AND expires_at <= now() - interval '30 days'
```
Hoje: **415 procuras elegíveis** (1.983 já expiradas, mas só as expiradas há mais de 30 dias entram).

## 2. Dependências e dados órfãos

- `match_opportunities.active_search_id` → FK com `ON DELETE CASCADE`. Apaga-se sozinho, sem órfãos.
- `match_notifications` (`buyer_source = 'search'`, `buyer_ref = id da procura`) → **sem FK**. Ficaria órfã e o sino continuaria a abrir um match inexistente. Tratamento explícito: apagar antes do delete.
- `match_states` (`buyer_source = 'search'`, `buyer_ref`) → **sem FK**. Também apagada explicitamente.
- `contacts` — não referencia procuras; o par nome+telefone aprendido **mantém-se** (é isso que permite reconhecer o contacto quando o comprador reaparece).
- `properties`, `buyer_clients`, `profiles` — sem qualquer relação. Intocados.

Ordem dentro da mesma transação: notificações → estados → procuras (cascade nas oportunidades).

## 3. Desenho

### (a) RPC admin com Simular / Aplicar
Nova `public.admin_purge_expired_searches(p_apply boolean default false, p_dias integer default 30)`, `SECURITY DEFINER`, com o mesmo gate `has_role(auth.uid(),'admin')` das restantes funções de manutenção. Devolve `jsonb`:
`elegiveis`, `apagadas`, `notificacoes_removidas`, `estados_removidos`, `oportunidades_removidas`, `por_origem`, `distribuicao` (por mês de expiração) e `amostra` (20 linhas: nome, origem, data de publicação, data de expiração).

Com `p_apply = false` calcula tudo e faz `RETURN` sem tocar em nada; com `p_apply = true` executa os deletes na mesma transação. A contagem de "Simular" e de "Aplicar" vem exatamente da mesma tabela temporária de ids, o que garante que os números batem.

Camada aplicacional: `src/lib/purge-expired.functions.ts` (server function admin-gated) + painel `src/components/PurgeExpiredPanel.tsx` em Manutenção, no estilo do `ExpiryRecalcPanel`: botão **Simular**, relatório, e **Apagar definitivamente** com confirmação escrita, aviso vermelho de irreversibilidade e a contagem no próprio botão.

### (b) Rotina automática, depois da primeira confirmação manual
Só depois de validares visualmente a primeira aplicação: endpoint `src/routes/api/public/cron/purge-expired-searches.ts`, protegido por segredo em header, que chama a mesma lógica em modo aplicar; agendamento diário via `pg_cron`/scheduler para a URL estável. A partir daí apaga sozinho, sem revisão manual, e regista o resumo de cada execução em `app_settings` (chave `purge_expired_last_run`) para se poder consultar o histórico da última limpeza no painel.

## 4. Testes de regressão

- SQL (`supabase/tests/purge_expired_regression.sql`, corrido na suite como o teste de expiração):
  - procura com `origem = 'cliente'` / `'texto'` expirada há 1 ano **não** é contada nem apagada;
  - procura Excel expirada há 10 dias não entra (janela dos 30 dias);
  - contagem devolvida por `p_apply = false` é igual ao número realmente apagado com `p_apply = true`;
  - após aplicar: zero `match_opportunities`, zero `match_notifications` e zero `match_states` a apontar para os ids apagados.
- TypeScript: teste de unidade ao construtor do filtro (lista branca de origens e janela de dias), garantindo que `cliente` nunca aparece na lista.

## 5. Notas técnicas
Uma única função plpgsql = uma transação; qualquer erro faz rollback total, sem apagamentos parciais. A função é idempotente: reexecutar não falha, apenas encontra menos linhas elegíveis.
