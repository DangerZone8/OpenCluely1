-- Shared monthly weighted AI budget for ₹399 Slickly Pro.
-- Each authenticated feature call consumes server-defined units in the same transaction
-- that enforces the per-feature daily cap. The client cannot choose its weight or budget.
create table if not exists public.slickly_usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  used_units integer not null default 0 check (used_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_month)
);

alter table public.slickly_usage_monthly enable row level security;
revoke all on public.slickly_usage_monthly from anon, authenticated;
grant all on public.slickly_usage_monthly to service_role;

create or replace function public.consume_slickly_credit_v2(
  p_user_id uuid,
  p_feature text,
  p_free_daily_limit integer,
  p_pro_daily_limit integer,
  p_feature_units integer,
  p_pro_monthly_budget integer
) returns table(
  allowed boolean,
  used integer,
  remaining integer,
  daily_limit integer,
  resets_at timestamptz,
  plan text,
  monthly_used integer,
  monthly_remaining integer,
  monthly_limit integer,
  limit_reason text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan text := 'free';
  v_daily_limit integer;
  v_daily_used integer;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_monthly_used integer := 0;
  v_monthly_remaining integer := 0;
  v_next_day timestamptz := ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  v_next_month timestamptz := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
begin
  if p_user_id is null
     or p_feature is null
     or p_feature not in ('screen_aware','voice','screenshot','chat')
     or p_free_daily_limit < 0
     or p_pro_daily_limit < p_free_daily_limit
     or p_feature_units < 1 or p_feature_units > 10
     or p_pro_monthly_budget < 1 or p_pro_monthly_budget > 10000 then
    raise exception 'invalid feature credit request';
  end if;

  select case when s.plan = 'pro' and s.status = 'active'
                   and s.current_period_end is not null and s.current_period_end > now()
              then 'pro' else 'free' end
    into v_plan
    from public.slickly_subscriptions s where s.user_id = p_user_id;
  v_plan := coalesce(v_plan, 'free');
  v_daily_limit := case when v_plan = 'pro' then p_pro_daily_limit else p_free_daily_limit end;

  -- Lock monthly first, then daily, in a consistent order for all requests.
  if v_plan = 'pro' then
    insert into public.slickly_usage_monthly(user_id, usage_month, used_units)
    values (p_user_id, v_month, 0)
    on conflict (user_id, usage_month) do nothing;
    select m.used_units into v_monthly_used
      from public.slickly_usage_monthly m
      where m.user_id = p_user_id and m.usage_month = v_month
      for update;
    v_monthly_used := coalesce(v_monthly_used, 0);
    v_monthly_remaining := greatest(p_pro_monthly_budget - v_monthly_used, 0);
  end if;

  insert into public.slickly_usage_daily(user_id, usage_date, feature, used)
  values (p_user_id, (now() at time zone 'utc')::date, p_feature, 0)
  on conflict (user_id, usage_date, feature) do nothing;

  select u.used into v_daily_used
    from public.slickly_usage_daily u
    where u.user_id = p_user_id
      and u.usage_date = (now() at time zone 'utc')::date
      and u.feature = p_feature
    for update;
  v_daily_used := coalesce(v_daily_used, 0);

  if v_daily_used >= v_daily_limit then
    return query select false, v_daily_used, greatest(v_daily_limit-v_daily_used,0),
      v_daily_limit, v_next_day, v_plan, v_monthly_used,
      v_monthly_remaining, case when v_plan='pro' then p_pro_monthly_budget else 0 end,
      'daily_limit';
    return;
  end if;

  if v_plan = 'pro' and v_monthly_used + p_feature_units > p_pro_monthly_budget then
    return query select false, v_daily_used, greatest(v_daily_limit-v_daily_used,0),
      v_daily_limit, v_next_month, v_plan, v_monthly_used,
      v_monthly_remaining, p_pro_monthly_budget, 'monthly_budget';
    return;
  end if;

  update public.slickly_usage_daily u
     set used = u.used + 1, updated_at = now()
   where u.user_id = p_user_id
     and u.usage_date = (now() at time zone 'utc')::date
     and u.feature = p_feature
   returning u.used into v_daily_used;

  if v_plan = 'pro' then
    update public.slickly_usage_monthly m
       set used_units = m.used_units + p_feature_units, updated_at = now()
     where m.user_id = p_user_id and m.usage_month = v_month
     returning m.used_units into v_monthly_used;
    v_monthly_remaining := greatest(p_pro_monthly_budget-v_monthly_used,0);
  end if;

  return query select true, v_daily_used, greatest(v_daily_limit-v_daily_used,0),
    v_daily_limit, v_next_day, v_plan, v_monthly_used,
    v_monthly_remaining, case when v_plan='pro' then p_pro_monthly_budget else 0 end,
    null::text;
end;
$$;

revoke all on function public.consume_slickly_credit_v2(uuid,text,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_slickly_credit_v2(uuid,text,integer,integer,integer,integer) to service_role;
