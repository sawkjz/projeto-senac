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
    coalesce(avg(vt.total_score) / 3.0, 0) as avg_score,
    count(vt.vote_id)::int as total_votes
  from teams t
  left join vote_totals vt on vt.team_id = t.id
  cross join max_points mp
  where t.course_id = p_course_id
  group by t.id, t.name, t.course_id, mp.total_max
  order by avg_percent desc, total_votes desc, t.name asc;
$$;
