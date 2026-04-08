alter table votes
  add column if not exists category text;

alter table courses
  add column if not exists description text;

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

delete from criteria
where title = 'Tempo';
