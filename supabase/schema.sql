-- =====================================================================
-- Seamline — Supabase schema
-- Run this once: Supabase dashboard → SQL editor → New query → paste → Run.
-- Safe to run again (it only creates what is missing / replaces functions).
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.staff (
  email      text primary key,
  role       text not null check (role in ('admin','sales','operations','finance')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- All business data. One row per record (order, product, payment, ledger entry…).
create table if not exists public.records (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (collection, id)
);

-- Customer-safe documents published by the staff app (tracking pages, quotes, portal, catalogue).
create table if not exists public.public_docs (
  key         text primary key,
  kind        text not null,
  owner_email text,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
create index if not exists public_docs_owner on public.public_docs (lower(owner_email));

-- Requests coming from customers (quote requests, approvals, reorders, messages).
create table if not exists public.inbox (
  id           bigint generated always as identity primary key,
  kind         text not null,
  payload      jsonb not null,
  sender_email text,
  created_at   timestamptz not null default now()
);

alter table public.staff       enable row level security;
alter table public.records     enable row level security;
alter table public.public_docs enable row level security;
alter table public.inbox       enable row level security;

-- ---------- helper functions ----------
create or replace function public.jwt_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where lower(email) = public.jwt_email() and active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where lower(email) = public.jwt_email() and active and role = 'admin')
$$;

create or replace function public.my_staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from staff where lower(email) = public.jwt_email() and active
$$;

create or replace function public.staff_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from staff
$$;

-- The very first person to sign up becomes the admin. After that, only admins add staff.
create or replace function public.claim_admin() returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from staff) then raise exception 'Seamline already has an admin. Ask them to add you.'; end if;
  insert into staff (email, role) values (public.jwt_email(), 'admin');
  return 'admin';
end $$;

-- ---------- row level security ----------
drop policy if exists staff_read  on public.staff;
drop policy if exists staff_write on public.staff;
create policy staff_read  on public.staff for select to authenticated using (public.is_staff());
create policy staff_write on public.staff for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists records_staff on public.records;
create policy records_staff on public.records for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists public_docs_staff on public.public_docs;
create policy public_docs_staff on public.public_docs for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists inbox_staff on public.inbox;
create policy inbox_staff on public.inbox for select to authenticated using (public.is_staff());
drop policy if exists inbox_staff_delete on public.inbox;
create policy inbox_staff_delete on public.inbox for delete to authenticated using (public.is_staff());
-- (no insert policy: customers can only add to the inbox through submit_inbox below)

-- ---------- customer-facing functions ----------
-- Tracking pages and quote links: you must know the long random token.
create or replace function public.get_public_doc(p_kind text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind in ('order', 'quote') then
    if p_key is null or length(p_key) < 24 then return null; end if;
  elsif p_kind in ('catalogue', 'settings') then
    null;
  else
    return null;
  end if;
  return (select data from public_docs where key = p_kind || ':' || p_key and kind = p_kind);
end $$;

-- Customer portal: a signed-in customer sees only the document for their own email.
create or replace function public.get_portal_doc() returns jsonb
language sql stable security definer set search_path = public as $$
  select data from public_docs where kind = 'portal' and lower(owner_email) = public.jwt_email() and public.jwt_email() <> ''
$$;

create or replace function public.submit_inbox(p_kind text, p_payload jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if octet_length(p_payload::text) > 4000000 then raise exception 'Request is too large'; end if;
  if p_kind in ('quote_request', 'quote_response') then
    null; -- allowed without a login
  elsif p_kind in ('reorder', 'bulk_request', 'support', 'profile') then
    if auth.uid() is null or not exists (select 1 from public_docs where kind = 'portal' and lower(owner_email) = public.jwt_email()) then
      raise exception 'Sign in to the customer portal first';
    end if;
  else
    raise exception 'Unknown request type';
  end if;
  if p_kind = 'quote_response' and not exists (select 1 from public_docs where key = 'quote:' || (p_payload ->> 'token')) then
    raise exception 'This quote link is not valid';
  end if;
  insert into inbox (kind, payload, sender_email)
  values (p_kind, p_payload, nullif(public.jwt_email(), ''))
  returning id into new_id;
  return new_id;
end $$;

-- Staff take pending requests in one step (so two open tabs never apply the same one twice).
create or replace function public.claim_inbox() returns setof public.inbox
language sql volatile security definer set search_path = public as $$
  delete from inbox
  where public.is_staff()
    and id in (select id from inbox order by id limit 100 for update skip locked)
  returning *
$$;

revoke all on function public.claim_admin()                 from public;
revoke all on function public.claim_inbox()                 from public;
grant execute on function public.my_staff_role()            to authenticated;
grant execute on function public.staff_count()              to anon, authenticated;
grant execute on function public.claim_admin()              to authenticated;
grant execute on function public.claim_inbox()              to authenticated;
grant execute on function public.get_public_doc(text, text) to anon, authenticated;
grant execute on function public.get_portal_doc()           to authenticated;
grant execute on function public.submit_inbox(text, jsonb)  to anon, authenticated;

-- ---------- realtime (live updates between staff) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.records; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inbox;   exception when duplicate_object then null; end;
end $$;
