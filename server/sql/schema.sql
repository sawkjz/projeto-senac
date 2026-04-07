create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz default now()
);

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
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, team_id)
);

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

alter table profiles enable row level security;
alter table votes enable row level security;
alter table vote_scores enable row level security;

create policy "Profiles are readable by owner"
  on profiles for select
  using (auth.uid() = id);

create policy "Profiles are editable by owner"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Profiles can be updated by owner"
  on profiles for update
  using (auth.uid() = id);

create policy "Votes readable by authenticated"
  on votes for select
  using (auth.role() = 'authenticated');

create policy "Votes managed by owner"
  on votes for insert
  with check (auth.uid() = user_id);

create policy "Votes updated by owner"
  on votes for update
  using (auth.uid() = user_id);

create policy "Vote scores readable by authenticated"
  on vote_scores for select
  using (auth.role() = 'authenticated');

create policy "Vote scores managed by authenticated"
  on vote_scores for insert
  with check (auth.role() = 'authenticated');

create policy "Vote scores updated by authenticated"
  on vote_scores for update
  using (auth.role() = 'authenticated');

alter table courses enable row level security;
alter table teams enable row level security;
alter table criteria enable row level security;

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
  ('Gastronomia', 'Apresentacoes de projetos gastronomicos e processos criativos.'),
  ('ADS', 'Solucoes digitais, produtos e experiencias em tecnologia.')
on conflict (name) do nothing;

insert into teams (course_id, name)
select c.id, t.name
from courses c
cross join (
  values
    ('Gastronomia', 'MISE IN PLACE'),
    ('Gastronomia', 'SEMEIA SABOR'),
    ('Gastronomia', 'BOAIMPRESSAO!'),
    ('Gastronomia', 'GASTROLAB'),
    ('Gastronomia', 'G4 DO FUTURO'),
    ('ADS', 'CODESQUAD'),
    ('ADS', 'TURISTAI'),
    ('ADS', 'WMW TOUR'),
    ('ADS', 'SENAKKU NO GAKUSEI'),
    ('ADS', 'PENTACODE'),
    ('ADS', 'ECOTRASH'),
    ('ADS', 'KAETE ADVENTURES')
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
