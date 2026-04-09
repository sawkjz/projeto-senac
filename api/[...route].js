import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const app = express();
const port = process.env.PORT || 3001;
const isDev = process.env.NODE_ENV !== "production";
const apiBaseUrl = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || "/api";

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
const SCHEMA_DEBUG_TTL_MS = 60 * 1000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

let schemaDebugCache = {
  checkedAt: null,
  ok: false,
  errors: [],
  warnings: [],
};

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

const isMissingFunctionError = (error) =>
  String(error?.message ?? "").toLowerCase().includes("could not find the function");

const runSchemaDebugCheck = async () => {
  const checkedAt = new Date().toISOString();
  if (!supabase) {
    return {
      checkedAt,
      ok: false,
      errors: ["Supabase nao configurado"],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];

  const checks = [
    { label: "votes core columns", table: "votes", select: "id, user_id, team_id, category, presentation_time_seconds, time_penalty, base_score, final_score" },
    { label: "vote_scores core columns", table: "vote_scores", select: "id, vote_id, criterion_id, score" },
    { label: "teams core columns", table: "teams", select: "id, course_id, name" },
    { label: "criteria core columns", table: "criteria", select: "id, title, min, max, sort_order" },
  ];

  for (const check of checks) {
    const { error } = await supabase.from(check.table).select(check.select).limit(1);
    if (error) {
      errors.push(`${check.label}: ${error.message}`);
    }
  }

  const { error: usersError } = await supabase
    .from("app_users")
    .select("id, full_name")
    .limit(1);
  if (usersError) {
    warnings.push(`app_users indisponivel: ${usersError.message}`);
  }

  const submitVoteCheck = await supabase.rpc("submit_vote", {
    p_user_id: ZERO_UUID,
    p_team_id: ZERO_UUID,
    p_category: GASTRONOMY_CATEGORY,
    p_presentation_time_seconds: 0,
    p_scores: [],
  });
  if (submitVoteCheck.error && isMissingFunctionError(submitVoteCheck.error)) {
    errors.push(`funcao submit_vote ausente: ${submitVoteCheck.error.message}`);
  }

  const rankingCheck = await supabase.rpc("get_ranking", {
    p_course_id: "0",
    p_category: GASTRONOMY_CATEGORY,
  });
  if (rankingCheck.error && isMissingFunctionError(rankingCheck.error)) {
    errors.push(`funcao get_ranking ausente: ${rankingCheck.error.message}`);
  }

  return {
    checkedAt,
    ok: errors.length === 0,
    errors,
    warnings,
  };
};

const getSchemaDebug = async (force = false) => {
  const lastCheckMs = schemaDebugCache.checkedAt
    ? Date.parse(schemaDebugCache.checkedAt)
    : 0;
  const isFresh =
    !force &&
    Number.isFinite(lastCheckMs) &&
    Date.now() - lastCheckMs < SCHEMA_DEBUG_TTL_MS;

  if (isFresh) {
    return schemaDebugCache;
  }

  schemaDebugCache = await runSchemaDebugCheck();
  return schemaDebugCache;
};

const isMissingVotesCategoryError = (error) => {
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  return (
    message.includes("votes.category") ||
    message.includes("column") && message.includes("category") ||
    details.includes("votes.category")
  );
};

const isMissingTableError = (error, tableName) => {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes(`public.${String(tableName).toLowerCase()}`);
};

const hasMissingCategoryConstraint = (error) => {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("function submit_vote") ||
    message.includes("function public.submit_vote") ||
    message.includes("does not exist")
  );
};

const isInvalidInputSyntaxError = (error) => {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("invalid input syntax for type");
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? "").trim(),
  );

const jurorNameToDeterministicBigint = (fullName) => {
  const normalized = String(fullName ?? "").trim().toLowerCase();
  const hex = createHash("sha256").update(normalized).digest("hex").slice(0, 15);
  return BigInt(`0x${hex}`).toString();
};

const jurorNameToDeterministicUuid = (fullName) => {
  const normalized = String(fullName ?? "").trim().toLowerCase();
  const hex = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const fetchLatestVoteByUserAndTeam = async ({
  userId,
  fallbackUserId = null,
  teamId,
  category = GASTRONOMY_CATEGORY,
}) => {
  let query = supabase
    .from("votes")
    .select("*")
    .eq("user_id", userId)
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (category) {
    query = query.eq("category", String(category).toLowerCase());
  }

  let { data, error } = await query;

  if (error && category && isMissingVotesCategoryError(error)) {
    const fallback = await supabase
      .from("votes")
      .select("*")
      .eq("user_id", userId)
      .eq("team_id", teamId)
      .order("updated_at", { ascending: false })
      .limit(1);
    data = fallback.data;
    error = fallback.error;
  }

  if (
    error &&
    isInvalidInputSyntaxError(error) &&
    fallbackUserId &&
    String(fallbackUserId) !== String(userId)
  ) {
    return fetchLatestVoteByUserAndTeam({
      userId: fallbackUserId,
      fallbackUserId: null,
      teamId,
      category,
    });
  }

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
};

const computeTimePenalty = (presentationTimeSeconds) => {
  const timeSeconds = Math.max(0, Math.floor(Number(presentationTimeSeconds) || 0));
  const minSeconds = 180;
  const maxSeconds = 300;
  const stepSeconds = 30;
  if (timeSeconds >= minSeconds && timeSeconds <= maxSeconds) return 0;
  if (timeSeconds < minSeconds) {
    return Math.floor((minSeconds - timeSeconds) / stepSeconds) * 0.1;
  }
  return Math.floor((timeSeconds - maxSeconds) / stepSeconds) * 0.1;
};

const saveVoteWithoutRpc = async ({
  userId,
  fallbackUserId = null,
  teamId,
  category,
  presentationTimeSeconds,
  scores,
}) => {
  const baseScore = scores.reduce((acc, entry) => acc + Number(entry.score || 0), 0);
  const timePenalty = computeTimePenalty(presentationTimeSeconds);
  const finalScore = Math.max(0, Number((baseScore - timePenalty).toFixed(1)));
  const normalizedCategory = String(category ?? GASTRONOMY_CATEGORY).toLowerCase();

  const fullPayload = {
    user_id: userId,
    team_id: teamId,
    category: normalizedCategory,
    presentation_time_seconds: Math.max(0, Math.floor(Number(presentationTimeSeconds) || 0)),
    time_penalty: timePenalty,
    base_score: baseScore,
    final_score: finalScore,
  };

  const simplePayload = {
    user_id: userId,
    team_id: teamId,
  };

  let voteId = null;
  let lastError = null;

  let upsertFull = await supabase
    .from("votes")
    .upsert(fullPayload, { onConflict: "user_id,team_id,category" })
    .select("id")
    .maybeSingle();
  lastError = upsertFull.error ?? lastError;

  if (
    upsertFull.error &&
    isInvalidInputSyntaxError(upsertFull.error) &&
    fallbackUserId &&
    String(fallbackUserId) !== String(userId)
  ) {
    return saveVoteWithoutRpc({
      userId: fallbackUserId,
      fallbackUserId: null,
      teamId,
      category,
      presentationTimeSeconds,
      scores,
    });
  }

  if (!upsertFull.error && upsertFull.data?.id) {
    voteId = upsertFull.data.id;
  } else {
    const upsertSimple = await supabase
      .from("votes")
      .upsert(simplePayload, { onConflict: "user_id,team_id" })
      .select("id")
      .maybeSingle();
    lastError = upsertSimple.error ?? lastError;

    if (!upsertSimple.error && upsertSimple.data?.id) {
      voteId = upsertSimple.data.id;
    } else {
      const insertSimple = await supabase
        .from("votes")
        .insert(simplePayload)
        .select("id")
        .maybeSingle();
      lastError = insertSimple.error ?? lastError;

      if (!insertSimple.error && insertSimple.data?.id) {
        voteId = insertSimple.data.id;
      }

      const existing = await fetchLatestVoteByUserAndTeam({
        userId,
        fallbackUserId,
        teamId,
        category: normalizedCategory,
      });
      voteId = voteId ?? existing?.id ?? null;
    }
  }

  if (!voteId) {
    const detail = String(lastError?.message ?? "").trim();
    throw new Error(
      detail
        ? `Falha ao salvar voto sem RPC: ${detail}`
        : "Falha ao salvar voto sem RPC",
    );
  }

  const deleteScores = await supabase
    .from("vote_scores")
    .delete()
    .eq("vote_id", voteId);

  if (deleteScores.error) {
    throw deleteScores.error;
  }

  const scoreRows = scores.map((entry) => ({
    vote_id: voteId,
    criterion_id: entry.criterionId,
    score: Number(entry.score),
  }));

  if (scoreRows.length > 0) {
    const insertScores = await supabase
      .from("vote_scores")
      .insert(scoreRows);
    if (insertScores.error) {
      throw insertScores.error;
    }
  }
};

const resolveJurorByName = async (fullName) => {
  const normalizedFullName = String(fullName ?? "").trim();
  if (!normalizedFullName) {
    throw new Error("Nome do jurado obrigatorio");
  }

  const { data: juror, error } = await supabase
    .from("app_users")
    .select("id, full_name")
    .eq("full_name", normalizedFullName)
    .maybeSingle();

    if (error) {
      if (isMissingTableError(error, "app_users")) {
        return {
        id: jurorNameToDeterministicUuid(normalizedFullName),
        fallback_user_id: null,
        full_name: normalizedFullName,
        fromFallback: true,
      };
    }
    throw error;
  }

  if (!juror?.id) {
    return null;
  }

  return {
    ...juror,
    id: isUuid(juror.id)
      ? juror.id
      : jurorNameToDeterministicUuid(normalizedFullName),
    fallback_user_id: isUuid(juror.id) ? null : String(juror.id),
    fromFallback: false,
  };
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

  const existing = await resolveJurorByName(normalizedFullName);
  if (existing?.id) {
    return existing;
  }

  // Fallback para schema legado sem tabela app_users.
  if (existing?.fromFallback) {
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

  let { data, error } = await supabase.rpc("get_ranking", {
    p_course_id: String(course.id),
    p_category: GASTRONOMY_CATEGORY,
  });

  if (error && String(error.message ?? "").includes("function get_ranking")) {
    const fallback = await supabase.rpc("get_ranking", {
      p_course_id: course.id,
    });
    data = fallback.data;
    error = fallback.error;
  }

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

    const { data: users, error: usersError } = await supabase
      .from("app_users")
      .select("id, full_name")
      .order("full_name");

    if (usersError && !isMissingTableError(usersError, "app_users")) {
      console.error("[/jurors/status] Users error:", usersError);
      res.status(500).json({
        error: "Falha ao carregar jurados",
        ...(isDev ? { detail: usersError.message } : {}),
      });
      return;
    }

    const { data: votes, error: votesError } = await supabase
      .from("votes")
      .select("user_id");

    if (votesError) {
      console.error("[/jurors/status] Votes error:", votesError);
      res.status(500).json({
        error: "Falha ao carregar jurados",
        ...(isDev ? { detail: votesError.message } : {}),
      });
      return;
    }

    const voteCountsByUserId = new Map();
    (votes ?? []).forEach((vote) => {
      const key = String(vote.user_id);
      voteCountsByUserId.set(key, (voteCountsByUserId.get(key) ?? 0) + 1);
    });

    // Em schema legado sem app_users, reporta contagens sem quebrar a tela.
    if (usersError && isMissingTableError(usersError, "app_users")) {
      const distinctJurors = voteCountsByUserId.size;
      res.json({
        jurors: [],
        totalJurors: distinctJurors,
        votedJurors: distinctJurors,
      });
      return;
    }

    const jurors = (users ?? []).map((juror) => ({
      id: juror.id,
      full_name: juror.full_name,
      has_voted: (voteCountsByUserId.get(String(juror.id)) ?? 0) > 0,
      total_votes: voteCountsByUserId.get(String(juror.id)) ?? 0,
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
    const normalizedTeamId = String(teamId ?? "").trim();
    if (
      !normalizedTeamId ||
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
      .eq("id", normalizedTeamId)
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

    let error = null;
    const canUseUuidRpc = isUuid(juror.id) && isUuid(teamId);

    if (canUseUuidRpc) {
      const rpcResult = await supabase.rpc("submit_vote", {
        p_user_id: juror.id,
        p_team_id: normalizedTeamId,
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
      error = rpcResult.error;
    } else {
      error = { message: "submit_vote skipped due to non-uuid identifiers" };
    }

    if (
      error &&
      isInvalidInputSyntaxError(error) &&
      juror.fallback_user_id
    ) {
      const typedFallback = await supabase.rpc("submit_vote", {
        p_user_id: juror.fallback_user_id,
        p_team_id: normalizedTeamId,
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
      error = typedFallback.error;
    }

    if (error && hasMissingCategoryConstraint(error)) {
      let fallback = await supabase.rpc("submit_vote", {
        p_user_id: juror.id,
        p_team_id: normalizedTeamId,
        p_scores: scores.map((entry) => ({
          criterionId: entry.criterionId,
          score: Number(entry.score),
        })),
      });
      if (
        fallback.error &&
        isInvalidInputSyntaxError(fallback.error) &&
        juror.fallback_user_id
      ) {
        fallback = await supabase.rpc("submit_vote", {
          p_user_id: juror.fallback_user_id,
          p_team_id: normalizedTeamId,
          p_scores: scores.map((entry) => ({
            criterionId: entry.criterionId,
            score: Number(entry.score),
          })),
        });
      }
      error = fallback.error;
    }

    if (error && String(error.message ?? "").includes("submit_vote")) {
      try {
        await saveVoteWithoutRpc({
          userId: juror.id,
          fallbackUserId: juror.fallback_user_id ?? null,
          teamId: normalizedTeamId,
          category: normalizedCategory,
          presentationTimeSeconds,
          scores,
        });
        error = null;
      } catch (fallbackError) {
        error = fallbackError;
      }
    }

    if (error) {
      console.error("[/votes] Submit vote error:", error);
      const schemaDebug = isDev ? await getSchemaDebug() : undefined;
      if (
        String(error?.code ?? "") === "23503" &&
        String(error?.details ?? "").includes('table "users"')
      ) {
        res.status(500).json({
          error:
            "Nao foi possivel salvar voto neste schema: a tabela users exigida pela FK nao esta disponivel pela API.",
          ...(isDev ? { schemaDebug } : {}),
        });
        return;
      }
      if (String(error?.message ?? "").includes("Falha ao salvar voto sem RPC")) {
        res.status(500).json({
          error:
            "Nao foi possivel salvar voto por incompatibilidade de schema no banco. Rode o schema/migrations atuais no Supabase.",
          ...(isDev ? { schemaDebug } : {}),
        });
        return;
      }
      res.status(500).json({
        error: error.message,
        ...(isDev ? { schemaDebug } : {}),
      });
      return;
    }

    let savedVote = null;
    try {
      savedVote = await fetchLatestVoteByUserAndTeam({
        userId: juror.id,
        fallbackUserId: juror.fallback_user_id ?? null,
        teamId: normalizedTeamId,
        category: normalizedCategory,
      });
    } catch (_error) {
      savedVote = null;
    }

    if (!savedVote) {
      res.status(201).json({ ok: true });
      return;
    }

    res.status(201).json({
      ok: true,
      vote: savedVote,
    });
  } catch (error) {
    console.error("[/votes] Unexpected error:", error);
    const schemaDebug = isDev ? await getSchemaDebug() : undefined;
    res.status(500).json({
      error: "Erro ao salvar voto",
      ...(isDev ? { detail: error.message } : {}),
      ...(isDev ? { schemaDebug } : {}),
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

    let juror;
    try {
      juror = await resolveJurorByName(jurorName);
    } catch (jurorError) {
      res.status(500).json({ error: "Falha ao carregar jurado" });
      return;
    }

    if (!juror?.id) {
      res.json({ vote: null });
      return;
    }

    let vote;
    try {
      vote = await fetchLatestVoteByUserAndTeam({
        userId: juror.id,
        fallbackUserId: juror.fallback_user_id ?? null,
        teamId,
        category,
      });
    } catch (voteError) {
      if (isInvalidInputSyntaxError(voteError)) {
        res.json({ vote: null });
        return;
      }
      res.status(500).json({ error: "Falha ao carregar avaliacao" });
      return;
    }

    if (!vote?.id) {
      res.json({ vote: null });
      return;
    }

    const { data: voteScores, error: voteScoresError } = await supabase
      .from("vote_scores")
      .select("criterion_id, score")
      .eq("vote_id", vote.id);

    if (voteScoresError) {
      res.status(500).json({ error: "Falha ao carregar notas da avaliacao" });
      return;
    }

    res.json({
      vote: {
        ...vote,
        vote_scores: voteScores ?? [],
      },
    });
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

    let juror;
    try {
      juror = await resolveJurorByName(normalizedJurorName);
    } catch (jurorError) {
      res.status(500).json({ error: "Falha ao localizar jurado" });
      return;
    }

    if (!juror?.id) {
      res.json({ ok: true, deleted: false });
      return;
    }

    let deleteWithCategory = await supabase
      .from("votes")
      .delete()
      .eq("user_id", juror.id)
      .eq("team_id", normalizedTeamId)
      .eq("category", normalizedCategory);

    let deleteError = deleteWithCategory.error;
    if (
      deleteError &&
      isInvalidInputSyntaxError(deleteError) &&
      juror.fallback_user_id
    ) {
      deleteWithCategory = await supabase
        .from("votes")
        .delete()
        .eq("user_id", juror.fallback_user_id)
        .eq("team_id", normalizedTeamId)
        .eq("category", normalizedCategory);
      deleteError = deleteWithCategory.error;
    }
    if (deleteError && isMissingVotesCategoryError(deleteError)) {
      const fallbackDelete = await supabase
        .from("votes")
        .delete()
        .eq("user_id", juror.fallback_user_id ?? juror.id)
        .eq("team_id", normalizedTeamId);
      deleteError = fallbackDelete.error;
    }

    if (deleteError) {
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
      apiBaseUrl,
      supabaseConfigured: Boolean(supabase),
      supabaseUrl: supabaseUrl ? "✓ Configurado" : "✗ Ausente",
      supabaseKey: supabaseServiceKey ? "✓ Configurado" : "✗ Ausente",
      port,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/debug/schema", async (req, res) => {
    const force = String(req.query.recheck ?? "").toLowerCase() === "true";
    const snapshot = await getSchemaDebug(force);
    res.json(snapshot);
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
