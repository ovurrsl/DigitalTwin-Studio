-- Better Auth tables (generated from @dt/identity's config with better-auth's
-- getMigrations, then schema-qualified) plus the sign-in lockout counter.
-- Only dt_auth can reach auth_ba; its role-level search_path lets Better Auth use
-- unqualified names through the transaction pooler without session state.

alter role dt_auth set search_path = auth_ba;

create table if not exists auth_ba."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "username" text unique, "displayUsername" text, "twoFactorEnabled" boolean, "role" text, "banned" boolean, "banReason" text, "banExpires" timestamptz, "status" text not null default 'active' check ("status" in ('invited', 'active', 'inactive', 'suspended')), "org" text not null default 'internal' check ("org" in ('internal', 'external')), "locale" text not null default 'tr' check ("locale" in ('tr', 'en')), "mustChangePassword" boolean not null default false);

create table if not exists auth_ba."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references auth_ba."user" ("id") on delete cascade, "impersonatedBy" text);

create table if not exists auth_ba."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references auth_ba."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table if not exists auth_ba."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table if not exists auth_ba."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references auth_ba."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

create index if not exists "session_userId_idx" on auth_ba."session" ("userId");

create index if not exists "account_userId_idx" on auth_ba."account" ("userId");

create index if not exists "verification_identifier_idx" on auth_ba."verification" ("identifier");

create index if not exists "twoFactor_secret_idx" on auth_ba."twoFactor" ("secret");

create index if not exists "twoFactor_userId_idx" on auth_ba."twoFactor" ("userId");

-- One row per account (or unknown identifier); moved by a single upsert so the
-- 3-miss / 10-miss lockout ladder is exact across instances.
create table if not exists auth_ba.dt_login_attempts (
  key text primary key,
  failed integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
