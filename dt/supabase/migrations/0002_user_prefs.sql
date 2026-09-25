-- Per-user preferences (locale, theme, getting-started tour). The first
-- subject-owned table, and the template every later one follows:
-- ENABLE + FORCE row level security, policies keyed on dt.current_subject().

create table if not exists dt.user_prefs (
  user_id text primary key,
  locale text not null default 'tr' check (locale in ('tr', 'en')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  tour_progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table dt.user_prefs enable row level security;
alter table dt.user_prefs force row level security;

drop policy if exists user_prefs_owner on dt.user_prefs;
create policy user_prefs_owner on dt.user_prefs
  for all to dt_app
  using (user_id = dt.current_subject())
  with check (user_id = dt.current_subject());
