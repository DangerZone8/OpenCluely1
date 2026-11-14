-- Server-managed Slickly Cloud configuration. Only service_role may read/write it.
create table if not exists public.slickly_cloud_config (
  id boolean primary key default true check (id = true),
  config jsonb not null,
  revision_number bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.slickly_cloud_config enable row level security;
revoke all on public.slickly_cloud_config from anon, authenticated;
grant all on public.slickly_cloud_config to service_role;
