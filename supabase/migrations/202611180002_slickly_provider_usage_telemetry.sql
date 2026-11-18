-- Durable, privacy-minimised provider usage telemetry for Slickly profitability review.
-- Store token counts only: never prompts, screenshots, audio, access tokens or API keys.
create table if not exists public.slickly_provider_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  feature text not null check (feature in ('screen_aware','voice','screenshot','chat')),
  provider text not null check (provider in ('gemini','qwencloud','deepseek','moonshot','openai')),
  model text not null check (length(model) between 1 and 128),
  requests bigint not null default 0 check (requests >= 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, feature, provider, model)
);

alter table public.slickly_provider_usage_daily enable row level security;
revoke all on public.slickly_provider_usage_daily from anon, authenticated;
grant all on public.slickly_provider_usage_daily to service_role;

create or replace function public.record_slickly_provider_usage(
  p_user_id uuid,
  p_feature text,
  p_provider text,
  p_model text,
  p_prompt_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null
     or p_feature is null
     or p_feature not in ('screen_aware','voice','screenshot','chat')
     or p_provider is null
     or p_provider not in ('gemini','qwencloud','deepseek','moonshot','openai')
     or p_model is null or length(p_model) < 1 or length(p_model) > 128
     or p_prompt_tokens is null or p_prompt_tokens < 0
     or p_output_tokens is null or p_output_tokens < 0
     or p_total_tokens is null or p_total_tokens < 0 then
    raise exception 'invalid provider usage record';
  end if;

  insert into public.slickly_provider_usage_daily as current_usage (
    user_id, usage_date, feature, provider, model,
    requests, prompt_tokens, output_tokens, total_tokens, updated_at
  ) values (
    p_user_id, (now() at time zone 'utc')::date, p_feature, p_provider, p_model,
    1, p_prompt_tokens, p_output_tokens, p_total_tokens, now()
  )
  on conflict (user_id, usage_date, feature, provider, model) do update set
    requests = current_usage.requests + 1,
    prompt_tokens = current_usage.prompt_tokens + excluded.prompt_tokens,
    output_tokens = current_usage.output_tokens + excluded.output_tokens,
    total_tokens = current_usage.total_tokens + excluded.total_tokens,
    updated_at = now();
end;
$$;

revoke all on function public.record_slickly_provider_usage(uuid,text,text,text,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.record_slickly_provider_usage(uuid,text,text,text,bigint,bigint,bigint) to service_role;
