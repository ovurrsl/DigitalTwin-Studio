-- The panel's "request an account" queue. Anyone can file a request through the
-- public form (written as the system:access-request subject, pending only);
-- reading and deciding them is a console capability.

create table if not exists dt.access_requests (
  id text primary key,
  full_name text not null,
  email text not null,
  username text not null,
  department text not null,
  requested_role text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- One pending request per address; a decided one never blocks a retry.
create unique index if not exists access_requests_one_pending
  on dt.access_requests (lower(email)) where status = 'pending';

alter table dt.access_requests enable row level security;
alter table dt.access_requests force row level security;

drop policy if exists access_requests_submit on dt.access_requests;
create policy access_requests_submit on dt.access_requests
  for insert to dt_app
  with check (dt.current_subject() = 'system:access-request' and status = 'pending');

drop policy if exists access_requests_console on dt.access_requests;
create policy access_requests_console on dt.access_requests
  for all to dt_app
  using (dt.has_cap('console.users.manage'))
  with check (dt.has_cap('console.users.manage'));
