-- Slickly account-backed daily credits and Razorpay Pro entitlement.
-- Apply through the adult/business owner's Supabase project after reviewing RLS and backups.
create table if not exists public.slickly_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'razorpay',
  provider_subscription_id text unique,
  status text not null default 'free' check (status in ('free','created','authenticated','active','pending','halted','paused','cancelled','completed','expired')),
  plan text not null default 'free' check (plan in ('free','pro')),
  current_period_end timestamptz,
  provider_event_created_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.slickly_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  feature text not null check (feature in ('screen_aware','voice','screenshot','chat')),
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, feature)
);

create table if not exists public.slickly_billing_events (
  event_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  provider_subscription_id text not null,
  received_at timestamptz not null default now()
);

alter table public.slickly_subscriptions enable row level security;
alter table public.slickly_usage_daily enable row level security;
alter table public.slickly_billing_events enable row level security;
revoke all on public.slickly_subscriptions, public.slickly_usage_daily, public.slickly_billing_events from anon, authenticated;
grant all on public.slickly_subscriptions, public.slickly_usage_daily, public.slickly_billing_events to service_role;

create or replace function public.consume_slickly_credit(
  p_user_id uuid, p_feature text, p_free_limit integer, p_pro_limit integer
) returns table(allowed boolean, used integer, remaining integer, daily_limit integer, resets_at timestamptz, plan text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan text := 'free';
  v_limit integer;
  v_used integer;
  v_today date := (now() at time zone 'utc')::date;
begin
  if p_feature not in ('screen_aware','voice','screenshot','chat')
     or p_free_limit < 0 or p_pro_limit < p_free_limit then
    raise exception 'invalid feature credit request';
  end if;

  select case when s.plan = 'pro' and s.status = 'active'
                   and s.current_period_end is not null and s.current_period_end > now()
              then 'pro' else 'free' end
    into v_plan
    from public.slickly_subscriptions s where s.user_id = p_user_id;
  v_plan := coalesce(v_plan, 'free');
  v_limit := case when v_plan = 'pro' then p_pro_limit else p_free_limit end;

  insert into public.slickly_usage_daily(user_id, usage_date, feature, used)
  values (p_user_id, v_today, p_feature, 0)
  on conflict (user_id, usage_date, feature) do nothing;

  -- Row lock makes concurrent calls consume at most the configured daily allowance.
  select u.used into v_used
    from public.slickly_usage_daily u
    where u.user_id = p_user_id and u.usage_date = v_today and u.feature = p_feature
    for update;

  if v_used >= v_limit then
    return query select false, v_used, 0, v_limit,
      ((v_today + 1)::timestamp at time zone 'utc'), v_plan;
    return;
  end if;

  update public.slickly_usage_daily u
     set used = u.used + 1, updated_at = now()
   where u.user_id = p_user_id and u.usage_date = v_today and u.feature = p_feature
   returning u.used into v_used;

  return query select true, v_used, greatest(v_limit - v_used, 0), v_limit,
    ((v_today + 1)::timestamp at time zone 'utc'), v_plan;
end;
$$;

create or replace function public.apply_slickly_razorpay_event(
  p_event_id text, p_user_id uuid, p_provider_subscription_id text,
  p_event_type text, p_provider_status text, p_current_end timestamptz, p_event_created_at bigint, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan text;
  v_status text;
  v_previous_event bigint := 0;
begin
  if p_event_id is null or length(p_event_id) < 8 then raise exception 'invalid event id'; end if;
  insert into public.slickly_billing_events(event_id, user_id, event_type, provider_subscription_id)
  values (p_event_id, p_user_id, p_event_type, p_provider_subscription_id)
  on conflict (event_id) do nothing;
  if not found then return jsonb_build_object('applied', false, 'duplicate', true); end if;

  select s.provider_event_created_at into v_previous_event
    from public.slickly_subscriptions s
    where s.user_id = p_user_id
    for update;
  v_previous_event := coalesce(v_previous_event, 0);
  if coalesce(p_event_created_at, 0) < v_previous_event then
    return jsonb_build_object('applied', false, 'stale', true);
  end if;

  v_status := case p_provider_status
    when 'active' then 'active'
    when 'authenticated' then 'authenticated'
    when 'created' then 'created'
    when 'pending' then 'pending'
    when 'halted' then 'halted'
    when 'paused' then 'paused'
    when 'cancelled' then 'cancelled'
    when 'completed' then 'completed'
    else 'expired'
  end;
  v_plan := case when v_status = 'active' then 'pro' else 'free' end;

  insert into public.slickly_subscriptions(
    user_id, provider, provider_subscription_id, status, plan, current_period_end, provider_event_created_at, updated_at
  ) values (
    p_user_id, 'razorpay', p_provider_subscription_id, v_status, v_plan, p_current_end, coalesce(p_event_created_at, 0), now()
  )
  on conflict (user_id) do update set
    provider = excluded.provider,
    provider_subscription_id = excluded.provider_subscription_id,
    status = excluded.status,
    plan = excluded.plan,
    current_period_end = excluded.current_period_end,
    provider_event_created_at = greatest(public.slickly_subscriptions.provider_event_created_at, excluded.provider_event_created_at),
    updated_at = now()
  where excluded.provider_event_created_at >= public.slickly_subscriptions.provider_event_created_at;

  return jsonb_build_object('applied', true, 'plan', v_plan, 'status', v_status);
end;
$$;

revoke all on function public.consume_slickly_credit(uuid,text,integer,integer) from public, anon, authenticated;
revoke all on function public.apply_slickly_razorpay_event(text,uuid,text,text,text,timestamptz,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.consume_slickly_credit(uuid,text,integer,integer) to service_role;
grant execute on function public.apply_slickly_razorpay_event(text,uuid,text,text,text,timestamptz,bigint,jsonb) to service_role;
