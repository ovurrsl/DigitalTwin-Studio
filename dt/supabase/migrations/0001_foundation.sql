-- Foundation: schemas, application roles, request-context helpers.
--
-- Roles are created NOLOGIN here; LOGIN and passwords are granted out of band
-- (Supabase SQL / CI setup) so no secret ever lives in a migration.
--   dt_app   application data, always through RLS (NOBYPASSRLS)
--   dt_auth  Better Auth tables in auth_ba only
-- The role running migrations owns both schemas.

create schema if not exists dt;
create schema if not exists auth_ba;

do $$
begin
  if not exists (select from pg_roles where rolname = 'dt_app') then
    create role dt_app nologin noinherit nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'dt_auth') then
    create role dt_auth nologin noinherit nobypassrls;
  end if;
end
$$;

revoke all on schema dt, auth_ba from public;

-- Supabase exposes anon/authenticated through PostgREST; neither may see our schemas.
do $$
begin
  if exists (select from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema dt, auth_ba from anon';
  end if;
  if exists (select from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema dt, auth_ba from authenticated';
  end if;
end
$$;

grant usage on schema dt to dt_app;
alter default privileges in schema dt grant select, insert, update, delete on tables to dt_app;
alter default privileges in schema dt grant usage, select on sequences to dt_app;
alter default privileges in schema dt grant execute on functions to dt_app;

grant usage on schema auth_ba to dt_auth;
alter default privileges in schema auth_ba grant select, insert, update, delete on tables to dt_auth;
alter default privileges in schema auth_ba grant usage, select on sequences to dt_auth;

-- Request context, set per transaction by @dt/db's dbAs(). Unset reads as NULL,
-- so every policy written against these fails closed.
create or replace function dt.current_subject() returns text
  language sql stable
  as $$ select nullif(current_setting('dt.subject', true), '') $$;

create or replace function dt.current_org() returns text
  language sql stable
  as $$ select nullif(current_setting('dt.org', true), '') $$;

create or replace function dt.current_claims() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('dt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function dt.has_cap(cap text) returns boolean
  language sql stable
  as $$ select coalesce(dt.current_claims() -> 'caps' ? cap, false) $$;

grant execute on function dt.current_subject(), dt.current_org(), dt.current_claims(), dt.has_cap(text) to dt_app;
