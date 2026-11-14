-- Configurable referral/promo codes. Discounts apply to every recurring Pro billing cycle.
create table if not exists public.slickly_referral_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value integer not null check (discount_value > 0),
  monthly_price_paise integer not null check (monthly_price_paise >= 100),
  razorpay_plan_id text not null unique,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.slickly_referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.slickly_referral_codes(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_subscription_id text unique,
  status text not null default 'pending' check (status in ('pending','redeemed','failed')),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  unique(code_id, user_id)
);
create index if not exists slickly_referral_redemptions_user_status_idx
  on public.slickly_referral_redemptions(user_id, status);

alter table public.slickly_referral_codes enable row level security;
alter table public.slickly_referral_redemptions enable row level security;
revoke all on public.slickly_referral_codes, public.slickly_referral_redemptions from anon, authenticated;
grant all on public.slickly_referral_codes, public.slickly_referral_redemptions to service_role;

create or replace function public.reserve_slickly_referral(p_code text, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code public.slickly_referral_codes%rowtype;
  v_redemption_id uuid;
  v_count integer;
begin
  update public.slickly_referral_redemptions set status='failed'
    where status='pending' and created_at < now() - interval '30 minutes';
  select * into v_code from public.slickly_referral_codes
   where code = upper(trim(p_code)) for update;
  if not found or not v_code.is_active or (v_code.expires_at is not null and v_code.expires_at <= now()) then
    raise exception 'referral code is invalid or expired';
  end if;
  if exists(select 1 from public.slickly_referral_redemptions where user_id = p_user_id and status in ('pending','redeemed')) then
    raise exception 'account has already used a referral code';
  end if;
  select count(*) into v_count from public.slickly_referral_redemptions
   where code_id = v_code.id and status in ('pending','redeemed');
  if v_code.max_redemptions is not null and v_count >= v_code.max_redemptions then
    raise exception 'referral code has reached its redemption limit';
  end if;
  insert into public.slickly_referral_redemptions(code_id,user_id,status)
  values(v_code.id,p_user_id,'pending')
  on conflict(code_id,user_id) do update set status='pending', provider_subscription_id=null, created_at=now(), redeemed_at=null
  where public.slickly_referral_redemptions.status='failed'
  returning id into v_redemption_id;
  if v_redemption_id is null then raise exception 'referral code already reserved for this account'; end if;
  return jsonb_build_object(
    'redemption_id',v_redemption_id,'code_id',v_code.id,'plan_id',v_code.razorpay_plan_id,
    'monthly_price_paise',v_code.monthly_price_paise,'code',v_code.code
  );
end;
$$;

create or replace function public.release_slickly_referral(p_redemption_id uuid, p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.slickly_referral_redemptions set status='failed'
   where id=p_redemption_id and user_id=p_user_id and status='pending';
  return found;
end;
$$;

create or replace function public.redeem_slickly_referral(p_redemption_id uuid, p_provider_subscription_id text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code_id uuid;
begin
  update public.slickly_referral_redemptions
    set status='redeemed', provider_subscription_id=p_provider_subscription_id, redeemed_at=now()
    where id=p_redemption_id and status in ('pending','redeemed')
    returning code_id into v_code_id;
  if v_code_id is null then return false; end if;
  update public.slickly_referral_codes
    set redemption_count=(select count(*) from public.slickly_referral_redemptions where code_id=v_code_id and status='redeemed')
    where id=v_code_id;
  return true;
end;
$$;

revoke all on function public.reserve_slickly_referral(text,uuid) from public, anon, authenticated;
revoke all on function public.release_slickly_referral(uuid,uuid) from public, anon, authenticated;
revoke all on function public.redeem_slickly_referral(uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_slickly_referral(text,uuid) to service_role;
grant execute on function public.release_slickly_referral(uuid,uuid) to service_role;
grant execute on function public.redeem_slickly_referral(uuid,text) to service_role;
