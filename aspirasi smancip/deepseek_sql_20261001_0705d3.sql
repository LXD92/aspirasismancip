-- ============================================================================
-- Aspirasi Digital MPK Mahardika SMAN 1 Cipari — schema.sql
-- Jalankan SEKALI di Supabase → SQL Editor. Aman dijalankan ulang (idempotent).
-- Urutan: tabel → RLS/grant → fungsi bantu → policy → RPC publik → RPC admin → admin.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- B1. TABEL
-- ============================================================================

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  nama       text not null default 'Event Spesial',
  locked     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint events_nama_len check (char_length(nama) between 1 and 100)
);

create table if not exists public.aspirasi (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  isi        text not null,
  status     text not null default 'Hold',
  votes      integer not null default 0,
  event_id   uuid null references public.events(id) on delete cascade,
  constraint aspirasi_isi_len check (char_length(isi) between 1 and 1000),
  constraint aspirasi_status_chk check (status in ('Hold','Diproses','Selesai','Ditolak'))
);

create table if not exists public.votes (
  aspirasi_id uuid not null references public.aspirasi(id) on delete cascade,
  client_id   text not null,
  created_at  timestamptz not null default now(),
  primary key (aspirasi_id, client_id)
);

create table if not exists public.rate_log (
  id        bigserial primary key,
  client_id text not null,
  action    text not null,
  at        timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create index if not exists aspirasi_event_created_idx on public.aspirasi (event_id, created_at desc);
create index if not exists aspirasi_status_idx        on public.aspirasi (status);
create index if not exists rate_log_lookup_idx        on public.rate_log (client_id, action, at);

-- ============================================================================
-- B2. KEAMANAN
-- ============================================================================

alter table public.events   enable row level security;
alter table public.aspirasi enable row level security;
alter table public.votes    enable row level security;
alter table public.rate_log enable row level security;
alter table public.admins   enable row level security;

revoke all on public.events   from public, anon, authenticated;
revoke all on public.aspirasi from public, anon, authenticated;
revoke all on public.votes    from public, anon, authenticated;
revoke all on public.rate_log from public, anon, authenticated;
revoke all on public.admins   from public, anon, authenticated;

grant select on public.aspirasi to anon, authenticated;
grant select on public.events   to anon, authenticated;

-- Browser TIDAK punya policy INSERT/UPDATE/DELETE sama sekali.

-- ============================================================================
-- B3. FUNGSI BANTU
-- ============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.clean_text(t text, maxlen int)
returns text
language plpgsql
immutable
as $$
declare s text;
begin
  if t is null then return ''; end if;
  s := translate(t, '<>', '');
  s := regexp_replace(s, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  s := btrim(s);
  if char_length(s) > maxlen then s := left(s, maxlen); end if;
  return s;
end;
$$;

create or replace function public.valid_client(c text)
returns boolean
language sql
immutable
as $$
  select c is not null and c ~ '^[A-Za-z0-9-]{8,64}$';
$$;

create or replace function public.check_rate(p_client text, p_action text, p_max int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if random() < 0.05 then
    delete from public.rate_log where at < now() - interval '1 hour';
  end if;

  select count(*) into n
  from public.rate_log
  where client_id = p_client and action = p_action and at > now() - p_window;

  if n >= p_max then return false; end if;

  insert into public.rate_log (client_id, action) values (p_client, p_action);
  return true;
end;
$$;

-- ============================================================================
-- B2b. POLICY
-- ============================================================================

drop policy if exists aspirasi_select_publik on public.aspirasi;
create policy aspirasi_select_publik on public.aspirasi
  for select to anon, authenticated
  using (status <> 'Ditolak');

drop policy if exists aspirasi_select_admin on public.aspirasi;
create policy aspirasi_select_admin on public.aspirasi
  for select to authenticated
  using (public.is_admin());

drop policy if exists events_select_all on public.events;
create policy events_select_all on public.events
  for select to anon, authenticated
  using (true);

-- votes, rate_log, admins: RLS aktif, TANPA policy apa pun.

-- ============================================================================
-- B4. RPC PUBLIK
-- ============================================================================

create or replace function public.submit_aspirasi(
  p_client_id text,
  p_isi text,
  p_event_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_isi text; v_locked boolean; v_total integer; v_id uuid;
begin
  if not public.valid_client(p_client_id) then
    return json_build_object('success', false, 'error', 'Identitas perangkat tidak valid. Muat ulang halaman lalu coba lagi.');
  end if;

  v_isi := public.clean_text(p_isi, 1000);
  if v_isi = '' then
    return json_build_object('success', false, 'error', 'Aspirasi tidak boleh kosong');
  end if;

  if p_event_id is not null then
    select e.locked into v_locked from public.events e where e.id = p_event_id;
    if not found then
      return json_build_object('success', false, 'error', 'Event tidak ditemukan');
    end if;
    if v_locked then
      return json_build_object('success', false, 'error', 'Event ini sedang ditutup untuk aspirasi baru');
    end if;
  end if;

  if not public.check_rate(p_client_id, 'submit', 10, interval '10 minutes') then
    return json_build_object('success', false, 'error', 'Terlalu sering, coba lagi beberapa menit lagi');
  end if;
  if not public.check_rate('GLOBAL', 'submit', 120, interval '10 minutes') then
    return json_build_object('success', false, 'error', 'Terlalu sering, coba lagi beberapa menit lagi');
  end if;

  select count(*) into v_total from public.aspirasi;
  if v_total >= 20000 then
    return json_build_object('success', false, 'error', 'Kapasitas penuh, hubungi pengurus MPK');
  end if;

  insert into public.aspirasi (isi, status, votes, event_id)
  values (v_isi, 'Hold', 0, p_event_id)
  returning id into v_id;

  return json_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.vote_aspirasi(p_client_id text, p_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_votes integer; v_ins integer := 0;
begin
  if not public.valid_client(p_client_id) then
    return json_build_object('success', false, 'error', 'Identitas perangkat tidak valid. Muat ulang halaman lalu coba lagi.');
  end if;

  if not public.check_rate(p_client_id, 'vote', 30, interval '10 minutes') then
    return json_build_object('success', false, 'error', 'Terlalu sering, coba lagi beberapa menit lagi');
  end if;

  select a.status, a.votes into v_status, v_votes
  from public.aspirasi a where a.id = p_id;

  if not found or v_status = 'Ditolak' then
    return json_build_object('success', false, 'error', 'Aspirasi tidak ditemukan');
  end if;

  insert into public.votes (aspirasi_id, client_id)
  values (p_id, p_client_id)
  on conflict (aspirasi_id, client_id) do nothing;
  get diagnostics v_ins = row_count;

  if v_ins > 0 then
    update public.aspirasi set votes = votes + 1 where id = p_id returning votes into v_votes;
    return json_build_object('success', true, 'votes', v_votes, 'already', false);
  end if;
  return json_build_object('success', true, 'votes', v_votes, 'already', true);
end;
$$;

create or replace function public.get_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total',   count(*) filter (where status <> 'Ditolak'),
    'selesai', count(*) filter (where status = 'Selesai')
  )
  from public.aspirasi;
$$;

-- ============================================================================
-- B5. RPC ADMIN
-- ============================================================================

create or replace function public.admin_set_status(p_id uuid, p_status text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return json_build_object('success', false, 'error', 'Akses ditolak');
  end if;
  if p_status is null or p_status not in ('Hold','Diproses','Selesai','Ditolak') then
    return json_build_object('success', false, 'error', 'Status tidak valid');
  end if;

  update public.aspirasi set status = p_status where id = p_id;
  if not found then
    return json_build_object('success', false, 'error', 'Aspirasi tidak ditemukan');
  end if;

  return json_build_object('success', true, 'status', p_status);
end;
$$;

create or replace function public.admin_create_event()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    return json_build_object('success', false, 'error', 'Akses ditolak');
  end if;
  insert into public.events (nama, locked) values ('Event Spesial', false) returning id into v_id;
  return json_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.admin_rename_event(p_id uuid, p_nama text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_nama text;
begin
  if not public.is_admin() then
    return json_build_object('success', false, 'error', 'Akses ditolak');
  end if;
  v_nama := public.clean_text(p_nama, 100);
  if v_nama = '' then v_nama := 'Event Spesial'; end if;

  update public.events set nama = v_nama where id = p_id;
  if not found then
    return json_build_object('success', false, 'error', 'Event tidak ditemukan');
  end if;

  return json_build_object('success', true, 'nama', v_nama);
end;
$$;

create or replace function public.admin_set_event_lock(p_id uuid, p_locked boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_locked boolean;
begin
  if not public.is_admin() then
    return json_build_object('success', false, 'error', 'Akses ditolak');
  end if;
  v_locked := coalesce(p_locked, false);

  update public.events set locked = v_locked where id = p_id;
  if not found then
    return json_build_object('success', false, 'error', 'Event tidak ditemukan');
  end if;

  return json_build_object('success', true, 'locked', v_locked);
end;
$$;

-- ============================================================================
-- B2c. GRANT EXECUTE
-- ============================================================================

revoke all on function public.clean_text(text, int)                 from public, anon, authenticated;
revoke all on function public.valid_client(text)                    from public, anon, authenticated;
revoke all on function public.check_rate(text, text, int, interval) from public, anon, authenticated;

revoke all on function public.is_admin() from public, anon, authenticated;
grant  execute on function public.is_admin() to anon, authenticated;

revoke all on function public.submit_aspirasi(text, text, uuid) from public, anon, authenticated;
grant  execute on function public.submit_aspirasi(text, text, uuid) to anon, authenticated;

revoke all on function public.vote_aspirasi(text, uuid) from public, anon, authenticated;
grant  execute on function public.vote_aspirasi(text, uuid) to anon, authenticated;

revoke all on function public.get_stats() from public, anon, authenticated;
grant  execute on function public.get_stats() to anon, authenticated;

revoke all on function public.admin_set_status(uuid, text)        from public, anon, authenticated;
revoke all on function public.admin_create_event()                from public, anon, authenticated;
revoke all on function public.admin_rename_event(uuid, text)      from public, anon, authenticated;
revoke all on function public.admin_set_event_lock(uuid, boolean) from public, anon, authenticated;

grant execute on function public.admin_set_status(uuid, text)        to authenticated;
grant execute on function public.admin_create_event()                to authenticated;
grant execute on function public.admin_rename_event(uuid, text)      to authenticated;
grant execute on function public.admin_set_event_lock(uuid, boolean) to authenticated;

-- ============================================================================
-- B6. JADIKAN AKUN ADMIN
-- Ganti GANTI_EMAIL_ADMIN dengan email akun yang dibuat di
-- Supabase → Authentication → Users → Add user, lalu jalankan statement ini.
-- ============================================================================

insert into admins(user_id)
select id from auth.users where email = 'GANTI_EMAIL_ADMIN'
on conflict do nothing;

-- ============================================================================
-- UJI KEAMANAN (jalankan manual di SQL Editor dengan "Set role")
--
--   set role anon;
--   insert into public.aspirasi (isi) values ('coba tulis langsung');  -- DITOLAK
--   update public.aspirasi set status = 'Selesai';                     -- DITOLAK
--   select * from public.votes;                                        -- DITOLAK
--   select * from public.admins;                                       -- DITOLAK
--   reset role;
-- ============================================================================