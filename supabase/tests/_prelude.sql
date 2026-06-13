-- Recreate the Supabase-provided objects + the SundayPlan tenancy tables the
-- migration depends on, so the real migration applies unmodified against a
-- vanilla Postgres. (In production these already exist in the Plan project.)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create publication supabase_realtime;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- Minimal mirror of sundayplan 0001_tenancy.sql (only the columns we touch).
create table if not exists public.church (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  slug      text not null unique,
  timezone  text not null default 'Europe/Oslo',
  created_at timestamptz not null default now()
);
create table if not exists public.church_member (
  church_id uuid not null references public.church(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null,
  primary key (church_id, user_id)
);
create extension if not exists pgcrypto;
