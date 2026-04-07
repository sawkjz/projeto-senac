alter table vote_scores
  alter column score type numeric(4,1) using score::numeric(4,1);

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
         (value->>'score')::numeric(4,1)
  from jsonb_array_elements(p_scores) as value;

  return v_vote_id;
end;
$$;
