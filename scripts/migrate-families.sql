-- Migration: add family-shared state + long-term facts
-- Run this in the Supabase SQL editor.

-- 1. New tables
create table if not exists families (
  id          bigserial primary key,
  name        text not null,
  created_at  timestamptz default now()
);

create table if not exists members (
  phone         text primary key,
  family_id     bigint not null references families(id) on delete cascade,
  member_name   text not null,
  created_at    timestamptz default now()
);

create table if not exists facts (
  id          bigserial primary key,
  family_id   bigint not null references families(id) on delete cascade,
  key         text not null,
  value       text not null,
  created_at  timestamptz default now(),
  unique (family_id, key)
);

-- 2. Add family_id + added_by to existing lists
alter table shopping add column if not exists family_id bigint references families(id) on delete cascade;
alter table shopping add column if not exists added_by text;

alter table butcher add column if not exists family_id bigint references families(id) on delete cascade;
alter table butcher add column if not exists added_by text;

-- 3. Migrate existing data: each distinct phone → its own family
do $$
declare
  r record;
  fid bigint;
begin
  for r in select distinct phone from shopping union select distinct phone from butcher loop
    insert into families (name) values ('משפחה') returning id into fid;
    insert into members (phone, family_id, member_name) values (r.phone, fid, 'בעל הבית')
      on conflict (phone) do nothing;
    update shopping set family_id = fid, added_by = 'בעל הבית' where phone = r.phone and family_id is null;
    update butcher  set family_id = fid, added_by = 'בעל הבית' where phone = r.phone and family_id is null;
  end loop;
end $$;

-- 4. Indexes
create index if not exists shopping_family_idx on shopping(family_id, done);
create index if not exists butcher_family_idx  on butcher(family_id, done);
create index if not exists facts_family_idx    on facts(family_id);
