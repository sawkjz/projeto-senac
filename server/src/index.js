import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

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
const GASTRONOMY_COURSE_NAME = 'Gastronomia';
const GASTRONOMY_TEAMS = [
  'MISE IN PLACE',
  'SEMEIA SABOR',
  'BOAIMPRESSÃO!',
  'GASTROLAB',
  'G4 DO FUTURO'
];

const normalizeTeamName = (name = '') =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

const allowedTeamKeys = new Set(GASTRONOMY_TEAMS.map(normalizeTeamName));
const teamOrder = new Map(GASTRONOMY_TEAMS.map((name, index) => [normalizeTeamName(name), index]));
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, storedHash) => {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const existing = Buffer.from(hash, 'hex');
  if (computed.length !== existing.length) return false;
  return timingSafeEqual(computed, existing);
};

const createSession = async (userId) => {
  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await supabase.from('auth_sessions').insert({
    token,
    user_id: userId,
    expires_at: expiresAt
  });
  if (error) throw error;
  return { token, expiresAt };
};

const getSessionUser = async (token) => {
  const { data, error } = await supabase
    .from('auth_sessions')
    .select('token, expires_at, app_users!inner(id, full_name)')
    .eq('token', token)
    .maybeSingle();

  if (error || !data?.app_users) return null;

  const expiresAt = Date.parse(data.expires_at);
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await supabase.from('auth_sessions').delete().eq('token', token);
    return null;
  }

  return {
    token: data.token,
    user: {
      id: data.app_users.id,
      full_name: data.app_users.full_name
    }
  };
};

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
  const session = await getSessionUser(token);
  if (!session) {
    res.status(401).json({ error: 'Token invalido' });
    return null;
  }
  return session.user;
};

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/auth/register', async (req, res) => {
  if (!requireSupabase(res)) return;

  const { fullName, password } = req.body ?? {};
  const normalizedFullName = String(fullName ?? '').trim();
  const normalizedPassword = String(password ?? '');

  if (!normalizedFullName || !normalizedPassword) {
    res.status(400).json({ error: 'Nome completo e senha sao obrigatorios' });
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from('app_users')
    .select('id')
    .eq('full_name', normalizedFullName)
    .maybeSingle();

  if (existingError) {
    res.status(500).json({ error: 'Falha ao validar usuario' });
    return;
  }

  if (existing) {
    res.status(409).json({ error: 'Nome completo ja cadastrado' });
    return;
  }

  const { data: user, error: insertError } = await supabase
    .from('app_users')
    .insert({
      full_name: normalizedFullName,
      password_hash: hashPassword(normalizedPassword)
    })
    .select('id, full_name')
    .single();

  if (insertError || !user) {
    res.status(500).json({ error: 'Falha ao criar usuario' });
    return;
  }

  try {
    const session = await createSession(user.id);
    res.status(201).json({
      token: session.token,
      user
    });
  } catch (_error) {
    res.status(500).json({ error: 'Falha ao criar sessao' });
  }
});

app.post('/auth/login', async (req, res) => {
  if (!requireSupabase(res)) return;

  const { fullName, password } = req.body ?? {};
  const normalizedFullName = String(fullName ?? '').trim();
  const normalizedPassword = String(password ?? '');

  if (!normalizedFullName || !normalizedPassword) {
    res.status(400).json({ error: 'Nome completo e senha sao obrigatorios' });
    return;
  }

  const { data: user, error } = await supabase
    .from('app_users')
    .select('id, full_name, password_hash')
    .eq('full_name', normalizedFullName)
    .maybeSingle();

  if (error || !user || !verifyPassword(normalizedPassword, user.password_hash)) {
    res.status(401).json({ error: 'Credenciais invalidas' });
    return;
  }

  try {
    const session = await createSession(user.id);
    res.json({
      token: session.token,
      user: {
        id: user.id,
        full_name: user.full_name
      }
    });
  } catch (_error) {
    res.status(500).json({ error: 'Falha ao criar sessao' });
  }
});

app.get('/auth/session', async (req, res) => {
  if (!requireSupabase(res)) return;

  const header = req.headers.authorization ?? '';
  const token = header.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Token ausente' });
    return;
  }

  const session = await getSessionUser(token);
  if (!session) {
    res.status(401).json({ error: 'Token invalido' });
    return;
  }

  res.json({ user: session.user });
});

app.post('/auth/logout', async (req, res) => {
  if (!requireSupabase(res)) return;

  const header = req.headers.authorization ?? '';
  const token = header.replace('Bearer ', '');

  if (token) {
    await supabase.from('auth_sessions').delete().eq('token', token);
  }

  res.json({ ok: true });
});

app.get('/bootstrap', async (_req, res) => {
  if (!requireSupabase(res)) return;

  const [course, criteria] = await Promise.all([
    supabase
      .from('courses')
      .select('id, name, description')
      .eq('name', GASTRONOMY_COURSE_NAME)
      .maybeSingle(),
    supabase.from('criteria').select('id, title, question, min, max, sort_order').order('sort_order')
  ]);

  if (course.error || criteria.error) {
    res.status(500).json({ error: 'Falha ao carregar dados' });
    return;
  }

  const courseId = course.data?.id;
  const teams = courseId
    ? await supabase.from('teams').select('id, name, course_id').eq('course_id', courseId).order('name')
    : { data: [], error: null };

  if (teams.error) {
    res.status(500).json({ error: 'Falha ao carregar dados' });
    return;
  }

  const filteredTeams = (teams.data ?? [])
    .filter((team) => allowedTeamKeys.has(normalizeTeamName(team.name)))
    .sort(
      (a, b) =>
        (teamOrder.get(normalizeTeamName(a.name)) ?? Number.MAX_SAFE_INTEGER) -
        (teamOrder.get(normalizeTeamName(b.name)) ?? Number.MAX_SAFE_INTEGER)
    );

  res.json({
    courses: course.data ? [course.data] : [],
    teams: filteredTeams,
    criteria: criteria.data ?? []
  });
});

app.get('/ranking', async (_req, res) => {
  if (!requireSupabase(res)) return;

  const { data: course, error: courseError } = await supabase
    .from('courses')
    .select('id')
    .eq('name', GASTRONOMY_COURSE_NAME)
    .maybeSingle();

  if (courseError) {
    res.status(500).json({ error: 'Falha ao carregar curso de Gastronomia' });
    return;
  }

  if (!course?.id) {
    res.status(404).json({ error: 'Curso de Gastronomia nao encontrado' });
    return;
  }

  const { data, error } = await supabase.rpc('get_ranking', {
    p_course_id: course.id
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const filteredRanking = (data ?? []).filter((item) =>
    allowedTeamKeys.has(normalizeTeamName(item.team_name))
  );
  res.json(filteredRanking);
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

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id, name, courses!inner(name)')
    .eq('id', teamId)
    .eq('courses.name', GASTRONOMY_COURSE_NAME)
    .maybeSingle();

  if (teamError) {
    res.status(500).json({ error: 'Falha ao validar equipe' });
    return;
  }

  if (!team || !allowedTeamKeys.has(normalizeTeamName(team.name))) {
    res.status(400).json({ error: 'Somente equipes de Gastronomia podem receber votos' });
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
