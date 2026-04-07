import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  })
  : null;

const requireSupabase = (res) => {
  if (!supabase) {
    res.status(500).json({ error: 'Supabase nao configurado' });
    return false;
  }
  return true;
};

const getUserFromToken = async (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Token ausente' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Token invalido' });
    return null;
  }
  return data.user;
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/bootstrap', async (_req, res) => {
  if (!requireSupabase(res)) return;

  const [courses, teams, criteria] = await Promise.all([
    supabase.from('courses').select('id, name, description').order('name'),
    supabase.from('teams').select('id, name, course_id').order('name'),
    supabase.from('criteria').select('id, title, question, min, max, sort_order').order('sort_order')
  ]);

  if (courses.error || teams.error || criteria.error) {
    res.status(500).json({ error: 'Falha ao carregar dados' });
    return;
  }

  res.json({
    courses: courses.data ?? [],
    teams: teams.data ?? [],
    criteria: criteria.data ?? []
  });
});

app.get('/ranking', async (req, res) => {
  if (!requireSupabase(res)) return;

  const { courseId } = req.query;
  if (!courseId) {
    res.status(400).json({ error: 'courseId obrigatorio' });
    return;
  }

  const { data, error } = await supabase.rpc('get_ranking', {
    p_course_id: courseId
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(data ?? []);
});

app.post('/votes', async (req, res) => {
  if (!requireSupabase(res)) return;

  const user = await getUserFromToken(req, res);
  if (!user) return;

  const { teamId, scores } = req.body ?? {};
  if (!teamId || !Array.isArray(scores)) {
    res.status(400).json({ error: 'Payload invalido' });
    return;
  }

  const { error } = await supabase.rpc('submit_vote', {
    p_user_id: user.id,
    p_team_id: teamId,
    p_scores: scores
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({ ok: true });
});

app.listen(port, () => {
  console.log(`Servidor ativo em http://localhost:${port}`);
});
