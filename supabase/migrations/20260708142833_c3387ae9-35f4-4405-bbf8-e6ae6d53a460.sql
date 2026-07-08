create table public.match_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade,
  active_search_id uuid not null references public.active_searches(id) on delete cascade,
  score integer not null,
  reasons jsonb,
  categories jsonb,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, active_search_id)
);

grant select, insert, update, delete on public.match_opportunities to authenticated;
grant all on public.match_opportunities to service_role;

alter table public.match_opportunities enable row level security;

create policy "owner manages match_opportunities"
  on public.match_opportunities
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index match_opportunities_user_unseen_idx
  on public.match_opportunities (user_id, viewed_at);
create index match_opportunities_property_idx
  on public.match_opportunities (property_id);
create index match_opportunities_search_idx
  on public.match_opportunities (active_search_id);

create trigger match_opportunities_updated_at
  before update on public.match_opportunities
  for each row execute function public.update_updated_at_column();