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
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, team_id)
);

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
  score int not null,
  unique (vote_id, criterion_id)
);

create or replace function submit_vote(
  p_user_id uuid,
  p_team_id uuid,
  p_scores jsonb
) returns uuid
language plpgsql
security definer
as $$
declare
  v_vote_id uuid;
begin
  insert into votes (user_id, team_id)
  values (p_user_id, p_team_id)
  on conflict (user_id, team_id)
  do update set updated_at = now()
  returning id into v_vote_id;

  delete from vote_scores where vote_id = v_vote_id;

  insert into vote_scores (vote_id, criterion_id, score)
  select v_vote_id,
         (value->>'criterionId')::uuid,
         (value->>'score')::int
  from jsonb_array_elements(p_scores) as value;

  return v_vote_id;
end;
$$;

create or replace function get_ranking(
  p_course_id uuid
) returns table (
  team_id uuid,
  team_name text,
  course_id uuid,
  avg_percent numeric,
  avg_score numeric,
  total_votes int
)
language sql
stable
as $$
  with max_points as (
    select sum(max) as total_max from criteria
  ),
  vote_totals as (
    select v.id as vote_id,
           v.team_id,
           sum(vs.score) as total_score
    from votes v
    join vote_scores vs on vs.vote_id = v.id
    group by v.id, v.team_id
  )
  select
    t.id as team_id,
    t.name as team_name,
    t.course_id,
    coalesce(avg(vt.total_score / nullif(mp.total_max, 0)) * 100, 0) as avg_percent,
    coalesce(avg(vt.total_score), 0) as avg_score,
    count(vt.vote_id)::int as total_votes
  from teams t
  left join vote_totals vt on vt.team_id = t.id
  cross join max_points mp
  where t.course_id = p_course_id
  group by t.id, t.name, t.course_id, mp.total_max
  order by avg_percent desc, total_votes desc, t.name asc;
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
  ('Visao de futuro', 'A equipe possui metas bem definidas para os proximos anos?', 1, 3, 7),
  ('Tempo', 'A proposta foi apresentada em ate 5 minutos?', 1, 3, 8)
on conflict do nothing;
