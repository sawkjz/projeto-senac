create extension if not exists "pgcrypto";
create extension if not exists "citext";

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  full_name citext not null unique,
  password_hash text not null,
  created_at timestamptz default now()
);

create unique index if not exists app_users_full_name_unique_idx
  on app_users (full_name);

create table if not exists auth_sessions (
  token text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create index if not exists auth_sessions_user_id_idx
  on auth_sessions (user_id);

create index if not exists auth_sessions_expires_at_idx
  on auth_sessions (expires_at);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text
);

alter table courses
  add column if not exists description text;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  name text not null
);

create table if not exists criteria (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  question text not null,
  min int not null,
  max int not null,
  sort_order int not null
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  team_id uuid not null references teams(id) on delete cascade,
  category text not null default 'gastronomia' check (category in ('gastronomia', 'ads')),
  presentation_time_seconds integer not null default 0,
  time_penalty numeric(4,1) not null default 0,
  base_score numeric(5,1) not null default 0,
  final_score numeric(5,1) not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, team_id, category)
);

alter table votes
  add column if not exists category text;

update votes
set category = 'gastronomia'
where category is null;

alter table votes
  alter column category set default 'gastronomia';

alter table votes
  alter column category set not null;

alter table votes
  drop constraint if exists votes_category_check;

alter table votes
  add constraint votes_category_check
  check (category in ('gastronomia', 'ads'));

alter table votes
  add column if not exists presentation_time_seconds integer not null default 0,
  add column if not exists time_penalty numeric(4,1) not null default 0,
  add column if not exists base_score numeric(5,1) not null default 0,
  add column if not exists final_score numeric(5,1) not null default 0;

alter table votes
  drop constraint if exists votes_user_id_team_id_key;

alter table votes
  add constraint votes_user_id_team_id_category_key unique (user_id, team_id, category);

do $$
begin
  alter table votes drop constraint if exists votes_user_id_fkey;
exception
  when undefined_table then null;
end $$;

insert into app_users (id, full_name, password_hash)
select distinct
  v.user_id,
  ('migrated_user_' || left(v.user_id::text, 8))::citext,
  encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')
from votes v
left join app_users u on u.id = v.user_id
where u.id is null;

alter table votes
  add constraint votes_user_id_fkey
  foreign key (user_id) references app_users(id) on delete cascade;

create table if not exists vote_scores (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references votes(id) on delete cascade,
  criterion_id uuid not null references criteria(id) on delete cascade,
  score numeric(4,1) not null,
  unique (vote_id, criterion_id)
);

create or replace function submit_vote(
  p_user_id uuid,
  p_team_id uuid,
  p_category text,
  p_presentation_time_seconds integer,
  p_scores jsonb
) returns uuid
language plpgsql
security definer
as $$
declare
  v_vote_id uuid;
  v_base_score numeric(5,1);
  v_time_penalty numeric(4,1);
  v_final_score numeric(5,1);
  v_min_seconds constant int := 180;
  v_max_seconds constant int := 300;
  v_step_seconds constant int := 30;
  v_validated_category text := lower(coalesce(p_category, 'gastronomia'));
  v_time_seconds integer := greatest(0, coalesce(p_presentation_time_seconds, 0));
begin
  if v_validated_category not in ('gastronomia', 'ads') then
    raise exception 'Categoria invalida';
  end if;

  select coalesce(sum((value->>'score')::numeric(4,1)), 0)::numeric(5,1)
    into v_base_score
  from jsonb_array_elements(p_scores) as value;

  if v_time_seconds between v_min_seconds and v_max_seconds then
    v_time_penalty := 0;
  elsif v_time_seconds < v_min_seconds then
    v_time_penalty := floor((v_min_seconds - v_time_seconds)::numeric / v_step_seconds) * 0.1;
  else
    v_time_penalty := floor((v_time_seconds - v_max_seconds)::numeric / v_step_seconds) * 0.1;
  end if;

  v_final_score := greatest(0, v_base_score - v_time_penalty)::numeric(5,1);

  insert into votes (
    user_id,
    team_id,
    category,
    presentation_time_seconds,
    time_penalty,
    base_score,
    final_score
  )
  values (
    p_user_id,
    p_team_id,
    v_validated_category,
    v_time_seconds,
    v_time_penalty,
    v_base_score,
    v_final_score
  )
  on conflict (user_id, team_id, category)
  do update set
    presentation_time_seconds = excluded.presentation_time_seconds,
    time_penalty = excluded.time_penalty,
    base_score = excluded.base_score,
    final_score = excluded.final_score,
    updated_at = now()
  returning id into v_vote_id;

  delete from vote_scores where vote_id = v_vote_id;

  insert into vote_scores (vote_id, criterion_id, score)
  select v_vote_id,
         (value->>'criterionId')::uuid,
         (value->>'score')::numeric(4,1)
  from jsonb_array_elements(p_scores) as value;

  return v_vote_id;
end;
$$;

alter table vote_scores
  alter column score type numeric(4,1) using score::numeric(4,1);

drop function if exists get_ranking(uuid, text);
drop function if exists get_ranking(uuid);

create or replace function get_ranking(
  p_course_id text,
  p_category text default 'gastronomia'
) returns table (
  team_id text,
  team_name text,
  course_id text,
  total_score numeric,
  avg_score numeric,
  total_votes int
)
language sql
stable
as $$
  select
    t.id::text as team_id,
    t.name as team_name,
    t.course_id::text as course_id,
    coalesce(sum(v.final_score), 0)::numeric(6,1) as total_score,
    coalesce(avg(v.final_score), 0)::numeric(5,2) as avg_score,
    count(v.id)::int as total_votes
  from teams t
  left join votes v
    on v.team_id::text = t.id::text
   and v.category = lower(coalesce(p_category, 'gastronomia'))
  where t.course_id::text = p_course_id
  group by t.id, t.name, t.course_id
  order by total_score desc, avg_score desc, t.name asc;
$$;

alter table votes enable row level security;
alter table vote_scores enable row level security;
alter table courses enable row level security;
alter table teams enable row level security;
alter table criteria enable row level security;

drop policy if exists "Votes readable by authenticated" on votes;
drop policy if exists "Votes managed by owner" on votes;
drop policy if exists "Votes updated by owner" on votes;
drop policy if exists "Vote scores readable by authenticated" on vote_scores;
drop policy if exists "Vote scores managed by authenticated" on vote_scores;
drop policy if exists "Vote scores updated by authenticated" on vote_scores;
drop policy if exists "Public read courses" on courses;
drop policy if exists "Public read teams" on teams;
drop policy if exists "Public read criteria" on criteria;

create policy "Public read courses"
  on courses for select
  using (true);

create policy "Public read teams"
  on teams for select
  using (true);

create policy "Public read criteria"
  on criteria for select
  using (true);

insert into courses (name, description)
values
  ('Gastronomia', 'Apresentacoes de projetos gastronomicos e processos criativos.')
on conflict (name) do nothing;

insert into teams (course_id, name)
select c.id, t.name
from courses c
cross join (
  values
    ('Gastronomia', 'MISE IN PLACE'),
    ('Gastronomia', 'SEMEIA SABOR'),
    ('Gastronomia', 'BOAIMPRESSÃO!'),
    ('Gastronomia', 'GASTROLAB'),
    ('Gastronomia', 'G4 DO FUTURO')
) as t(course_name, name)
where c.name = t.course_name
on conflict do nothing;

insert into criteria (title, question, min, max, sort_order)
values
  ('Abertura', 'A abertura foi impactante?', 1, 3, 1),
  ('Problema', 'O problema foi descrito de forma clara e objetiva?', 1, 5, 2),
  ('Solucao/Inovacao', 'A solucao apresentada e inovadora?', 1, 5, 3),
  ('Mercado', 'A equipe possui o entendimento sobre o mercado que atua?', 1, 5, 4),
  ('Equipe', 'A equipe esta bem dimensionada em relacao as atribuicoes desenvolvidas?', 1, 3, 5),
  ('Concorrencia', 'A proposta apresentou vantagens competitivas em relacao aos concorrentes?', 1, 3, 6),
  ('Visao de futuro', 'A equipe possui metas bem definidas para os proximos anos?', 1, 3, 7)
on conflict do nothing;
