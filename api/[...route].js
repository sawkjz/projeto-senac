import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const app = express();
const port = process.env.PORT || 3001;
const isDev = process.env.NODE_ENV !== "production";

// CORS configurado para aceitar requisições de qualquer origem
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));
app.use(express.json());

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check sem verificação de Supabase
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      })
    : null;

const GASTRONOMY_COURSE_NAME = "Gastronomia";
const GASTRONOMY_CATEGORY = "gastronomia";
const GASTRONOMY_TEAMS = [
  "MISE IN PLACE",
  "SEMEIA SABOR",
  "BOAIMPRESSAO!",
  "GASTROLAB",
  "G4 DO FUTURO",
];
const MAX_JURORS = 3;

const normalizeTeamName = (name = "") =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
const normalizeCourseName = (name = "") => normalizeTeamName(name);

const allowedTeamKeys = new Set(GASTRONOMY_TEAMS.map(normalizeTeamName));
const teamOrder = new Map(
  GASTRONOMY_TEAMS.map((name, index) => [normalizeTeamName(name), index]),
);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const TIME_CRITERION_TITLE = "Tempo";

const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, storedHash) => {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const existing = Buffer.from(hash, "hex");
  if (computed.length !== existing.length) return false;
  return timingSafeEqual(computed, existing);
};

const createSession = async (userId) => {
  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await supabase.from("auth_sessions").insert({
    token,
    user_id: userId,
    expires_at: expiresAt,
  });
  if (error) throw error;
  return { token, expiresAt };
};

const getSessionUser = async (token) => {
  const { data, error } = await supabase
    .from("auth_sessions")
    .select("token, expires_at, app_users!inner(id, full_name)")
    .eq("token", token)
    .maybeSingle();

  if (error || !data?.app_users) return null;

  const expiresAt = Date.parse(data.expires_at);
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await supabase.from("auth_sessions").delete().eq("token", token);
    return null;
  }

  return {
    token: data.token,
    user: {
      id: data.app_users.id,
      full_name: data.app_users.full_name,
    },
  };
};

const requireSupabase = (res) => {
  if (!supabase) {
    res.status(500).json({ error: "Supabase nao configurado" });
    return false;
  }
  return true;
};

const getGastronomyCourse = async () => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name, description");

  if (error) throw error;

  const target = normalizeCourseName(GASTRONOMY_COURSE_NAME);
  return (data ?? []).find((course) => normalizeCourseName(course.name) === target) ?? null;
};

const ensureGastronomySeed = async () => {
  let course = await getGastronomyCourse();

  if (!course) {
    const { data: createdCourse, error: createCourseError } = await supabase
      .from("courses")
      .insert({
        name: GASTRONOMY_COURSE_NAME,
        description: "Apresentacoes de projetos gastronomicos e processos criativos.",
      })
      .select("id, name, description")
      .single();

    if (createCourseError) {
      throw createCourseError;
    }

    course = createdCourse;
  }

  const { data: existingTeams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, course_id")
    .eq("course_id", course.id);

  if (teamsError) {
    throw teamsError;
  }

  const existingNames = new Set(
    (existingTeams ?? []).map((team) => normalizeTeamName(team.name)),
  );

  const missingTeams = GASTRONOMY_TEAMS.filter(
    (teamName) => !existingNames.has(normalizeTeamName(teamName)),
  );

  if (missingTeams.length > 0) {
    const { error: insertTeamsError } = await supabase.from("teams").insert(
      missingTeams.map((teamName) => ({
        course_id: course.id,
        name: teamName,
      })),
    );

    if (insertTeamsError) {
      throw insertTeamsError;
    }
  }

  const { data: allTeams, error: allTeamsError } = await supabase
    .from("teams")
    .select("id, name, course_id")
    .eq("course_id", course.id);

  if (allTeamsError) {
    throw allTeamsError;
  }

  return {
    course,
    teams: allTeams ?? [],
  };
};

const findOrCreateJuror = async (fullName) => {
  const normalizedFullName = String(fullName ?? "").trim();
  if (!normalizedFullName) {
    throw new Error("Nome do jurado obrigatorio");
  }

  const { data: existing, error: existingError } = await supabase
    .from("app_users")
    .select("id, full_name")
    .eq("full_name", normalizedFullName)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing;
  }

  const { data: votedJurors, error: jurorCountError } = await supabase
    .from("votes")
    .select("user_id");

  if (jurorCountError) {
    throw jurorCountError;
  }

  const distinctJurorsCount = new Set(
    (votedJurors ?? []).map((vote) => vote.user_id),
  ).size;

  if (distinctJurorsCount >= MAX_JURORS) {
    throw new Error(`Limite de ${MAX_JURORS} jurados atingido`);
  }

  const { data: created, error: insertError } = await supabase
    .from("app_users")
    .insert({
      full_name: normalizedFullName,
      password_hash: hashPassword(randomBytes(24).toString("hex")),
    })
    .select("id, full_name")
    .single();

  if (insertError || !created) {
    throw insertError ?? new Error("Falha ao criar jurado");
  }

  return created;
};

app.post("/auth/register", async (req, res) => {
  if (!requireSupabase(res)) return;

  const { fullName, password } = req.body ?? {};
  const normalizedFullName = String(fullName ?? "").trim();
  const normalizedPassword = String(password ?? "");

  if (!normalizedFullName || !normalizedPassword) {
    res.status(400).json({ error: "Nome completo e senha sao obrigatorios" });
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("app_users")
    .select("id")
    .eq("full_name", normalizedFullName)
    .maybeSingle();

  if (existingError) {
    res.status(500).json({ error: "Falha ao validar usuario" });
    return;
  }

  if (existing) {
    res.status(409).json({ error: "Nome completo ja cadastrado" });
    return;
  }

  const { data: user, error: insertError } = await supabase
    .from("app_users")
    .insert({
      full_name: normalizedFullName,
      password_hash: hashPassword(normalizedPassword),
    })
    .select("id, full_name")
    .single();

  if (insertError || !user) {
    res.status(500).json({ error: "Falha ao criar usuario" });
    return;
  }

  try {
    const session = await createSession(user.id);
    res.status(201).json({
      token: session.token,
      user,
    });
  } catch (_error) {
    res.status(500).json({ error: "Falha ao criar sessao" });
  }
});

app.post("/auth/login", async (req, res) => {
  if (!requireSupabase(res)) return;

  const { fullName, password } = req.body ?? {};
  const normalizedFullName = String(fullName ?? "").trim();
  const normalizedPassword = String(password ?? "");

  if (!normalizedFullName || !normalizedPassword) {
    res.status(400).json({ error: "Nome completo e senha sao obrigatorios" });
    return;
  }

  const { data: user, error } = await supabase
    .from("app_users")
    .select("id, full_name, password_hash")
    .eq("full_name", normalizedFullName)
    .maybeSingle();

  if (
    error ||
    !user ||
    !verifyPassword(normalizedPassword, user.password_hash)
  ) {
    res.status(401).json({ error: "Credenciais invalidas" });
    return;
  }

  try {
    const session = await createSession(user.id);
    res.json({
      token: session.token,
      user: {
        id: user.id,
        full_name: user.full_name,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: "Falha ao criar sessao" });
  }
});

app.get("/auth/session", async (req, res) => {
  if (!requireSupabase(res)) return;

  const header = req.headers.authorization ?? "";
  const token = header.replace("Bearer ", "");

  if (!token) {
    res.status(401).json({ error: "Token ausente" });
    return;
  }

  const session = await getSessionUser(token);
  if (!session) {
    res.status(401).json({ error: "Token invalido" });
    return;
  }

  res.json({ user: session.user });
});

app.post("/auth/logout", async (req, res) => {
  if (!requireSupabase(res)) return;

  const header = req.headers.authorization ?? "";
  const token = header.replace("Bearer ", "");

  if (token) {
    await supabase.from("auth_sessions").delete().eq("token", token);
  }

  res.json({ ok: true });
});

app.get("/bootstrap", async (_req, res) => {
  try {
    if (!requireSupabase(res)) return;

    const [seeded, criteria] = await Promise.all([
      ensureGastronomySeed(),
      supabase
        .from("criteria")
        .select("id, title, question, min, max, sort_order")
        .order("sort_order"),
    ]);

    if (criteria.error) {
      const detail = criteria.error?.message;
      res.status(500).json({
        error: "Falha ao carregar dados",
        ...(isDev && detail ? { detail } : {}),
      });
      return;
    }

    const course = seeded.course;
    const teamsFromCourse = seeded.teams;

    const filteredByAllowlist = teamsFromCourse
      .filter((team) => allowedTeamKeys.has(normalizeTeamName(team.name)))
      .sort(
        (a, b) =>
          (teamOrder.get(normalizeTeamName(a.name)) ?? Number.MAX_SAFE_INTEGER) -
          (teamOrder.get(normalizeTeamName(b.name)) ?? Number.MAX_SAFE_INTEGER),
      );
    const fallbackTeams = teamsFromCourse.sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
    );
    const filteredTeams = filteredByAllowlist.length > 0 ? filteredByAllowlist : fallbackTeams;
    const filteredCriteria = (criteria.data ?? []).filter(
      (criterion) => criterion.title !== TIME_CRITERION_TITLE,
    );

    res.json({
      courses: [course],
      teams: filteredTeams,
      criteria: filteredCriteria,
    });
  } catch (error) {
    console.error("[/bootstrap] Error:", error);
    res.status(500).json({
      error: "Erro ao carregar bootstrap",
      ...(isDev ? { detail: error.message } : {}),
    });
  }
});

app.get("/ranking", async (_req, res) => {
  if (!requireSupabase(res)) return;

  let course;
  try {
    course = await getGastronomyCourse();
  } catch (_error) {
    res
      .status(500)
      .json({ error: "Falha ao carregar curso de Gastronomia" });
    return;
  }

  if (!course?.id) {
    res.status(404).json({ error: "Curso de Gastronomia nao encontrado" });
    return;
  }

  const { data, error } = await supabase.rpc("get_ranking", {
    p_course_id: String(course.id),
    p_category: GASTRONOMY_CATEGORY,
  });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const filteredByAllowlist = (data ?? []).filter((item) =>
    allowedTeamKeys.has(normalizeTeamName(item.team_name)),
  );
  const filteredRanking =
    filteredByAllowlist.length > 0 ? filteredByAllowlist : (data ?? []);

  const maxCriteriaScore = 27;
  const normalizedRanking = filteredRanking.map((item) => ({
    ...item,
    total_score: Number(item.total_score ?? 0),
    avg_score: Number(item.avg_score ?? 0),
    avg_percent:
      maxCriteriaScore > 0
        ? Number(
            (
              (Number(item.avg_score ?? 0) / maxCriteriaScore) *
              100
            ).toFixed(2),
          )
        : 0,
  }));

  res.json(normalizedRanking);
});

app.get("/jurors/status", async (_req, res) => {
  try {
    if (!requireSupabase(res)) return;

    const { data, error } = await supabase
      .from("app_users")
      .select("id, full_name, votes(team_id)")
      .order("full_name");

    if (error) {
      console.error("[/jurors/status] Error:", error);
      res.status(500).json({
        error: "Falha ao carregar jurados",
        ...(isDev ? { detail: error.message } : {}),
      });
      return;
    }

    const jurors = (data ?? []).map((juror) => ({
      id: juror.id,
      full_name: juror.full_name,
      has_voted: Boolean(juror.votes?.length),
      total_votes: juror.votes?.length ?? 0,
    }));

    res.json({
      jurors,
      totalJurors: jurors.length,
      votedJurors: jurors.filter((juror) => juror.has_voted).length,
    });
  } catch (error) {
    console.error("[/jurors/status] Unexpected error:", error);
    res.status(500).json({
      error: "Erro ao carregar jurados",
      ...(isDev ? { detail: error.message } : {}),
    });
  }
});

app.post("/votes", async (req, res) => {
  try {
    if (!requireSupabase(res)) return;

    const {
      teamId,
      scores,
      jurorName,
      category = GASTRONOMY_CATEGORY,
      presentationTimeSeconds,
    } = req.body ?? {};
    if (
      !teamId ||
      !Array.isArray(scores) ||
      !String(jurorName ?? "").trim() ||
      !Number.isFinite(Number(presentationTimeSeconds))
    ) {
      res.status(400).json({ error: "Payload invalido" });
      return;
    }

    const normalizedCategory = String(category).toLowerCase();
    if (normalizedCategory !== GASTRONOMY_CATEGORY) {
      res.status(400).json({ error: "Categoria invalida" });
      return;
    }

    let gastronomyCourse;
    try {
      gastronomyCourse = await getGastronomyCourse();
    } catch (_error) {
      res.status(500).json({ error: "Falha ao validar curso de Gastronomia" });
      return;
    }

    if (!gastronomyCourse?.id) {
      res.status(404).json({ error: "Curso de Gastronomia nao encontrado" });
      return;
    }

    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id, name, course_id")
      .eq("id", teamId)
      .maybeSingle();

    if (teamError) {
      console.error("[/votes] Team error:", teamError);
      res.status(500).json({ error: "Falha ao validar equipe" });
      return;
    }

    if (!team || team.course_id !== gastronomyCourse.id) {
      res
        .status(400)
        .json({ error: "Somente equipes de Gastronomia podem receber votos" });
      return;
    }

    let juror;
    try {
      juror = await findOrCreateJuror(jurorName);
    } catch (error) {
      const message = error?.message ?? "";
      if (message.includes("Limite de")) {
        res.status(400).json({ error: message });
        return;
      }

      console.error("[/votes] Juror error:", error);
      res.status(500).json({ error: "Falha ao identificar jurado" });
      return;
    }

    const { error } = await supabase.rpc("submit_vote", {
      p_user_id: juror.id,
      p_team_id: teamId,
      p_category: normalizedCategory,
      p_presentation_time_seconds: Math.max(
        0,
        Math.floor(Number(presentationTimeSeconds)),
      ),
      p_scores: scores.map((entry) => ({
        criterionId: entry.criterionId,
        score: Number(entry.score),
      })),
    });

    if (error) {
      console.error("[/votes] Submit vote error:", error);
      res.status(500).json({ error: error.message });
      return;
    }

    const { data: savedVote, error: savedVoteError } = await supabase
      .from("votes")
      .select(
        "id, user_id, team_id, category, presentation_time_seconds, time_penalty, base_score, final_score, updated_at",
      )
      .eq("user_id", juror.id)
      .eq("team_id", teamId)
      .eq("category", normalizedCategory)
      .maybeSingle();

    if (savedVoteError || !savedVote) {
      res.status(201).json({ ok: true });
      return;
    }

    res.status(201).json({
      ok: true,
      vote: savedVote,
    });
  } catch (error) {
    console.error("[/votes] Unexpected error:", error);
    res.status(500).json({
      error: "Erro ao salvar voto",
      ...(isDev ? { detail: error.message } : {}),
    });
  }
});

app.get("/votes/current", async (req, res) => {
  try {
    if (!requireSupabase(res)) return;

    const teamId = String(req.query.teamId ?? "").trim();
    const jurorName = String(req.query.jurorName ?? "").trim();
    const category = String(req.query.category ?? GASTRONOMY_CATEGORY).toLowerCase();

    if (!teamId || !jurorName) {
      res.status(400).json({ error: "teamId e jurorName sao obrigatorios" });
      return;
    }

    const { data: juror, error: jurorError } = await supabase
      .from("app_users")
      .select("id, full_name")
      .eq("full_name", jurorName)
      .maybeSingle();

    if (jurorError) {
      res.status(500).json({ error: "Falha ao carregar jurado" });
      return;
    }

    if (!juror?.id) {
      res.json({ vote: null });
      return;
    }

    const { data: vote, error: voteError } = await supabase
      .from("votes")
      .select(
        "id, user_id, team_id, category, presentation_time_seconds, time_penalty, base_score, final_score, vote_scores(criterion_id, score)",
      )
      .eq("user_id", juror.id)
      .eq("team_id", teamId)
      .eq("category", category)
      .maybeSingle();

    if (voteError) {
      res.status(500).json({ error: "Falha ao carregar avaliacao" });
      return;
    }

    res.json({ vote: vote ?? null });
  } catch (error) {
    res.status(500).json({
      error: "Erro ao carregar avaliacao",
      ...(isDev ? { detail: error.message } : {}),
    });
  }
});

app.delete("/votes", async (req, res) => {
  try {
    if (!requireSupabase(res)) return;

    const { teamId, jurorName, category = GASTRONOMY_CATEGORY } = req.body ?? {};
    const normalizedTeamId = String(teamId ?? "").trim();
    const normalizedJurorName = String(jurorName ?? "").trim();
    const normalizedCategory = String(category ?? "").toLowerCase();

    if (!normalizedTeamId || !normalizedJurorName || !normalizedCategory) {
      res.status(400).json({ error: "Payload invalido" });
      return;
    }

    const { data: juror, error: jurorError } = await supabase
      .from("app_users")
      .select("id")
      .eq("full_name", normalizedJurorName)
      .maybeSingle();

    if (jurorError) {
      res.status(500).json({ error: "Falha ao localizar jurado" });
      return;
    }

    if (!juror?.id) {
      res.json({ ok: true, deleted: false });
      return;
    }

    const { error } = await supabase
      .from("votes")
      .delete()
      .eq("user_id", juror.id)
      .eq("team_id", normalizedTeamId)
      .eq("category", normalizedCategory);

    if (error) {
      res.status(500).json({ error: "Falha ao resetar avaliacao" });
      return;
    }

    res.json({ ok: true, deleted: true });
  } catch (error) {
    res.status(500).json({
      error: "Erro ao resetar avaliacao",
      ...(isDev ? { detail: error.message } : {}),
    });
  }
});

// Rota de debug (apenas em desenvolvimento)
if (isDev) {
  app.get("/debug/config", (_req, res) => {
    res.json({
      isDev,
      supabaseConfigured: Boolean(supabase),
      supabaseUrl: supabaseUrl ? "✓ Configurado" : "✗ Ausente",
      supabaseKey: supabaseServiceKey ? "✓ Configurado" : "✗ Ausente",
      port,
      timestamp: new Date().toISOString(),
    });
  });
}

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`
╔════════════════════════════════════════╗
║  Servidor da API iniciado com sucesso ║
╚════════════════════════════════════════╝
URL: http://localhost:${port}
Modo: ${isDev ? "DESENVOLVIMENTO" : "PRODUÇÃO"}
Supabase: ${supabase ? "✓ Conectado" : "✗ NÃO CONFIGURADO"}
${!supabase ? "⚠️  Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env" : ""}
    `);
  });
}

export default app;
