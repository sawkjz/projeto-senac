import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Prioridade: VITE_API_BASE_URL > localhost:3001 em dev > /api em produção
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL 
  ? import.meta.env.VITE_API_BASE_URL
  : import.meta.env.DEV
    ? "http://localhost:3001"
    : "/api";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

const heroHighlights = [
  {
    title: "Ranking ao vivo",
    description: "Votos atualizam o placar em tempo real.",
  },
  {
    title: "Acompanhamento ao vivo",
    description: "Acompanhe quem ja registrou voto no evento.",
  },
];

const DEFAULT_PAGE = "landing";
const GASTRONOMY_COURSE_NAME = "Gastronomia";
const GASTRONOMY_CATEGORY = "gastronomia";
const TIME_MIN_SECONDS = 3 * 60;
const TIME_MAX_SECONDS = 5 * 60;
const TIMER_PENALTY_STEP_SECONDS = 30;

const scoreLabels = (criterion) => `${criterion.min} - ${criterion.max}`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatElapsedTime = (seconds) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};
const formatScoreValue = (value) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);
const formatRankingScore = (value) => Number(value ?? 0).toFixed(1);
const toIdString = (value) => String(value ?? "");
const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const isGastronomyCourse = (courseName = "") =>
  normalizeText(courseName) === normalizeText(GASTRONOMY_COURSE_NAME);
const getTimePenalty = (seconds) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  if (safeSeconds >= TIME_MIN_SECONDS && safeSeconds <= TIME_MAX_SECONDS) return 0;
  if (safeSeconds < TIME_MIN_SECONDS) {
    const diff = TIME_MIN_SECONDS - safeSeconds;
    return Math.floor(diff / TIMER_PENALTY_STEP_SECONDS) * 0.1;
  }
  const diff = safeSeconds - TIME_MAX_SECONDS;
  return Math.floor(diff / TIMER_PENALTY_STEP_SECONDS) * 0.1;
};
const getTimerStatus = (elapsedSeconds) => {
  if (!elapsedSeconds) return "Informe o tempo em minutos e segundos.";
  if (elapsedSeconds >= TIME_MIN_SECONDS && elapsedSeconds <= TIME_MAX_SECONDS) {
    return "Dentro da faixa sem penalidade (03:00 a 05:00).";
  }
  if (elapsedSeconds < TIME_MIN_SECONDS) {
    return "Abaixo da faixa permitida, com penalidade progressiva.";
  }
  return "Acima da faixa permitida, com penalidade progressiva.";
};

const shellClass =
  "rounded-[20px] border border-[#7b5b33]/35 bg-[linear-gradient(160deg,rgba(255,248,230,0.95),rgba(245,232,206,0.96))] shadow-[0_14px_28px_rgba(61,40,16,0.14)]";
const actionClass =
  "inline-flex items-center justify-center rounded-full border border-[#8d673c]/35 bg-[linear-gradient(140deg,#f5d9a6,#e7bf86_55%,#dfb578)] px-4 py-2 text-[0.84rem] font-bold text-ink shadow-[0_8px_20px_rgba(64,41,14,0.2)] transition hover:brightness-[1.05]";
const secondaryActionClass =
  "inline-flex items-center justify-center rounded-full border border-[#87613a]/45 bg-[#f6ead1]/65 px-3.5 py-2 text-[0.82rem] font-semibold text-ink transition hover:bg-[#f0dfbd]";

export default function App() {
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [jurorName, setJurorName] = useState("");
  const [jurorsStatus, setJurorsStatus] = useState({
    jurors: [],
    totalJurors: 0,
    votedJurors: 0,
  });
  const [jurorsLoading, setJurorsLoading] = useState(false);
  const [status, setStatus] = useState("Conectando...");
  const [bootstrap, setBootstrap] = useState({
    courses: [],
    teams: [],
    criteria: [],
  });
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [scores, setScores] = useState({});
  const [ranking, setRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [voteFeedback, setVoteFeedback] = useState("");
  const [voteMode, setVoteMode] = useState("create");
  const [voteLoading, setVoteLoading] = useState(false);
  const [loadingVote, setLoadingVote] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [existingVote, setExistingVote] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showTeamSelectionError, setShowTeamSelectionError] = useState(false);
  const [presentationMinutes, setPresentationMinutes] = useState(0);
  const [presentationSeconds, setPresentationSeconds] = useState(0);
  const positionsRef = useRef(new Map());
  const nodesRef = useRef(new Map());
  const gastronomyCourse = bootstrap.courses.find((course) =>
    isGastronomyCourse(course.name),
  );
  const gastronomyCourseId = toIdString(gastronomyCourse?.id);
  const gastronomyTeams = gastronomyCourseId
    ? bootstrap.teams.filter(
        (team) => toIdString(team.course_id) === gastronomyCourseId,
      )
    : bootstrap.teams;

  const isConfigured = useMemo(() => Boolean(apiBaseUrl), []);

  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash.replace("#", "") || DEFAULT_PAGE;
      setPage(next);
    };

    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setStatus("Defina VITE_API_BASE_URL para conectar ao servidor.");
      setBootstrapLoading(false);
      return;
    }

    const loadBootstrap = async () => {
      setBootstrapLoading(true);
      try {
        const response = await fetch(`${apiBaseUrl}/bootstrap`);
        if (!response.ok) {
          throw new Error("Falha ao carregar dados");
        }
        const data = await response.json();
        setBootstrap(data);
        setStatus("Sistema pronto para votar.");
      } catch (error) {
        setStatus("Não foi possível carregar os dados do evento.");
      } finally {
        setBootstrapLoading(false);
      }
    };

    loadBootstrap();
  }, [isConfigured]);

  useEffect(() => {
    fetchJurorsStatus();
  }, []);

  useEffect(() => {
    if (!gastronomyCourseId) return;
    fetchRanking(gastronomyCourseId);
  }, [gastronomyCourseId]);

  useEffect(() => {
    if (!supabase || !gastronomyCourseId) return;

    const channel = supabase.channel("votes-ranking");
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "vote_scores" },
      () => fetchRanking(gastronomyCourseId, true),
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "votes" },
      () => fetchRanking(gastronomyCourseId, true),
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gastronomyCourseId]);

  useEffect(() => {
    if (!selectedTeamId) return;
    const nextScores = {};
    bootstrap.criteria.forEach((criterion) => {
      nextScores[criterion.id] = criterion.min;
    });
    setScores(nextScores);
    setPresentationMinutes(0);
    setPresentationSeconds(0);
    setVoteMode("create");
    setLoadError("");
    setExistingVote(null);
    setVoteFeedback("");
    setShowTeamSelectionError(false);
  }, [selectedTeamId, bootstrap.criteria]);

  useLayoutEffect(() => {
    const nodes = nodesRef.current;
    const positions = positionsRef.current;
    const newPositions = new Map();

    nodes.forEach((node, key) => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      newPositions.set(key, rect);
      const prev = positions.get(key);
      if (prev) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (dx || dy) {
          node.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "translate(0, 0)" },
            ],
            { duration: 350, easing: "ease-out" },
          );
        }
      }
    });

    positionsRef.current = newPositions;
  }, [ranking]);

  const fetchRanking = async (courseId, silent = false) => {
    if (!courseId) return;
    if (!silent) setRankingLoading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/ranking?courseId=${courseId}`,
      );
      if (!response.ok) {
        throw new Error("Falha ao buscar ranking");
      }
      const data = await response.json();
      setRanking(data);
    } catch (error) {
      setRanking([]);
    } finally {
      if (!silent) setRankingLoading(false);
    }
  };

  const fetchJurorsStatus = async (silent = false) => {
    if (!silent) setJurorsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/jurors/status`);
      if (!response.ok) {
        // Tenta mostrar detalhes do erro retornado pelo backend
        const errorData = await response.json().catch(() => ({}));
        console.error("Server Error Details /jurors/status:", errorData);
        throw new Error("Falha ao carregar jurados");
      }
      const data = await response.json();
      setJurorsStatus(data);
    } catch (_error) {
      setJurorsStatus({
        jurors: [],
        totalJurors: 0,
        votedJurors: 0,
      });
    } finally {
      if (!silent) setJurorsLoading(false);
    }
  };

  const clearLocalForm = () => {
    const nextScores = {};
    bootstrap.criteria.forEach((criterion) => {
      nextScores[criterion.id] = criterion.min;
    });
    setScores(nextScores);
    setPresentationMinutes(0);
    setPresentationSeconds(0);
    setVoteFeedback("");
    setVoteMode("create");
    setLoadError("");
    setExistingVote(null);
    setShowResetModal(false);
  };

  useEffect(() => {
    const loadExistingVote = async () => {
      if (!selectedTeamId || !jurorName.trim()) {
        setVoteMode("create");
        setExistingVote(null);
        setLoadError("");
        const nextScores = {};
        bootstrap.criteria.forEach((criterion) => {
          nextScores[criterion.id] = criterion.min;
        });
        setScores(nextScores);
        setPresentationMinutes(0);
        setPresentationSeconds(0);
        return;
      }

      setLoadingVote(true);
      setLoadError("");
      try {
        const params = new URLSearchParams({
          teamId: selectedTeamId,
          jurorName: jurorName.trim(),
          category: GASTRONOMY_CATEGORY,
        });
        const response = await fetch(`${apiBaseUrl}/votes/current?${params}`);
        if (!response.ok) throw new Error("Falha ao carregar avaliacao");
        const data = await response.json();
        const vote = data?.vote;

        if (!vote) {
          setVoteMode("create");
          setExistingVote(null);
          const nextScores = {};
          bootstrap.criteria.forEach((criterion) => {
            nextScores[criterion.id] = criterion.min;
          });
          setScores(nextScores);
          setPresentationMinutes(0);
          setPresentationSeconds(0);
          return;
        }

        const nextScores = {};
        bootstrap.criteria.forEach((criterion) => {
          nextScores[criterion.id] = criterion.min;
        });

        (vote.vote_scores ?? []).forEach((entry) => {
          if (entry?.criterion_id) {
            nextScores[entry.criterion_id] = Number(entry.score);
          }
        });

        setScores(nextScores);
        const totalSeconds = Math.max(0, Number(vote.presentation_time_seconds) || 0);
        setPresentationMinutes(Math.floor(totalSeconds / 60));
        setPresentationSeconds(totalSeconds % 60);
        setVoteMode("edit");
        setExistingVote(vote);
      } catch (_error) {
        setVoteMode("create");
        setExistingVote(null);
        setLoadError(
          "Nao foi possivel carregar a avaliacao existente. Tente novamente.",
        );
        const nextScores = {};
        bootstrap.criteria.forEach((criterion) => {
          nextScores[criterion.id] = criterion.min;
        });
        setScores(nextScores);
        setPresentationMinutes(0);
        setPresentationSeconds(0);
      } finally {
        setLoadingVote(false);
      }
    };

    loadExistingVote();
  }, [selectedTeamId, jurorName, bootstrap.criteria]);

  const handleVoteSubmit = async (event) => {
    event.preventDefault();
    setShowTeamSelectionError(false);

    if (!jurorName.trim()) {
      setVoteFeedback("Informe o nome do jurado.");
      return;
    }

    if (!selectedTeamId) {
      setShowTeamSelectionError(true);
      return;
    }

    const payload = bootstrap.criteria.map((criterion) => ({
      criterionId: criterion.id,
      score: scores[criterion.id] ?? criterion.min,
    }));

    const normalizedSeconds = clamp(
      Number(presentationMinutes || 0) * 60 + Number(presentationSeconds || 0),
      0,
      60 * 59 + 59,
    );

    try {
      setVoteLoading(true);
      const response = await fetch(`${apiBaseUrl}/votes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: selectedTeamId,
          jurorName: jurorName.trim(),
          category: GASTRONOMY_CATEGORY,
          presentationTimeSeconds: normalizedSeconds,
          scores: payload,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Falha ao salvar voto");
      }

      setVoteFeedback(
        voteMode === "edit"
          ? "Avaliacao atualizada com sucesso."
          : "Avaliacao salva com sucesso.",
      );
      setVoteMode("edit");
      if (gastronomyCourseId) {
        fetchRanking(gastronomyCourseId, true);
      }
      fetchJurorsStatus(true);
    } catch (error) {
      setVoteFeedback(error.message ?? "Nao foi possivel registrar o voto.");
    } finally {
      setVoteLoading(false);
    }
  };

  const handleVoteReset = async () => {
    if (!selectedTeamId) {
      setVoteFeedback("Selecione uma equipe antes de resetar.");
      return;
    }

    if (!jurorName.trim()) {
      setVoteFeedback("Informe o nome do jurado.");
      return;
    }

    setShowResetModal(true);
  };

  const confirmVoteReset = async () => {
    try {
      setShowResetModal(false);
      setVoteLoading(true);
      const response = await fetch(`${apiBaseUrl}/votes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: selectedTeamId,
          jurorName: jurorName.trim(),
          category: GASTRONOMY_CATEGORY,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Falha ao resetar avaliacao");
      }

      clearLocalForm();
      if (gastronomyCourseId) {
        fetchRanking(gastronomyCourseId, true);
      }
      fetchJurorsStatus(true);
      setVoteFeedback("Avaliacao resetada e removida do banco.");
    } catch (error) {
      setVoteFeedback(error.message ?? "Nao foi possivel resetar a avaliacao.");
    } finally {
      setVoteLoading(false);
    }
  };

  const displayedTeams = gastronomyTeams;
  const selectedTeam = displayedTeams.find(
    (team) => toIdString(team.id) === toIdString(selectedTeamId),
  );
  const presentationTimeSeconds = clamp(
    Number(presentationMinutes || 0) * 60 + Number(presentationSeconds || 0),
    0,
    60 * 59 + 59,
  );
  const timePenalty = getTimePenalty(presentationTimeSeconds);
  const baseScore = bootstrap.criteria.reduce(
    (acc, criterion) => acc + (scores[criterion.id] ?? criterion.min),
    0,
  );
  const finalScore = Math.max(0, Number((baseScore - timePenalty).toFixed(1)));
  const timerStatus = getTimerStatus(presentationTimeSeconds);

  useEffect(() => {
    if (
      selectedTeamId &&
      !displayedTeams.some(
        (team) => toIdString(team.id) === toIdString(selectedTeamId),
      )
    ) {
      setSelectedTeamId("");
    }
  }, [selectedTeamId, displayedTeams]);

  const renderLanding = () => (
    <div className="mx-auto w-full max-w-[min(96vw,1180px)] px-[clamp(12px,2.6vw,34px)] pb-[clamp(16px,3vw,30px)]">
      <header className="pt-2 xl:pt-3">
        <nav className="flex items-center justify-center gap-3 py-1.5 text-center xl:py-2">
          <span className="text-[1.16rem] font-extrabold tracking-[0.02em] text-deep">
            Voto Ao Vivo
          </span>
        </nav>

        <section className="grid gap-3 pb-4 md:grid-cols-[1.2fr_0.8fr] xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] xl:gap-4 xl:pb-[18px]">
          <div className={`${shellClass} p-[22px] md:p-6 xl:px-[26px] xl:py-6`}>
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
              Painel de apresentacoes
            </p>
            <h1 className="max-w-[11ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[clamp(1.55rem,2vw,2.35rem)] xl:leading-[1.04]">
              Votação ao vivo para equipes em apresentação
            </h1>
            <p className="mt-2.5 max-w-[52ch] text-[0.9rem] leading-[1.45] text-ash">
              Plataforma oficial para avaliacao feito por{" "}
              <a
                href="https://github.com/sawkjz"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-deep underline-offset-4 transition hover:text-sky hover:underline"
              >
                Isadora Marcondes
              </a>
              .
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={actionClass} href="#votar">
                Votar agora
              </a>
              <a className={secondaryActionClass} href="#ranking">
                Ver ranking
              </a>
            </div>
          </div>

          <aside
            className={`${shellClass} bg-[linear-gradient(180deg,rgba(251,239,216,0.96),rgba(235,213,173,0.92))] p-4 xl:px-[18px] xl:py-4`}
          >
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
              Status ao vivo
            </p>
            <h2 className="m-0 text-[1.08rem] font-bold leading-[1.08] text-deep xl:text-[1.18rem] xl:leading-[1.1]">
              Placar - Ficthon 2026
            </h2>
            <ul className="mt-2.5 list-disc space-y-1 pl-4 text-[0.84rem] leading-[1.45] text-ash">
              <li>Ranking de Gastronomia</li>
              <li>Soma de notas finais por equipe</li>
              <li>Animação de subida/queda</li>
            </ul>
            <div className="mt-3 rounded-xl bg-deep/5 px-3 py-2.5 font-semibold text-deep">
              <p className="text-[0.78rem] text-ash">Disponibilidade</p>
              <strong className="text-[0.88rem]">{status}</strong>
            </div>
          </aside>
        </section>
      </header>

      <main>
        <section className="mt-2 py-1" id="como-funciona">
          <div className="mb-2.5 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between xl:gap-[18px]">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
                Como funciona
              </p>
              <h2 className="max-w-[18ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[1.35rem]">
                Fluxo para jurados
              </h2>
            </div>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2 xl:gap-3">
            {heroHighlights.map((item) => (
              <article
                key={item.title}
                className={`${shellClass} p-3 xl:min-h-[112px]`}
              >
                <h3 className="mb-1 text-[0.96rem] font-bold text-deep">
                  {item.title}
                </h3>
                <p className="text-[0.9rem] leading-[1.45] text-ash">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-2 py-1" id="cursos">
          <div className="mb-2.5 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between xl:gap-[18px]">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
                Cursos
              </p>
              <h2 className="max-w-[18ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[1.35rem]">
                Gastronomia
              </h2>
            </div>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2 xl:gap-3">
            {gastronomyCourse && (
              <article
                key={gastronomyCourse.id}
                className={`${shellClass} p-3 xl:min-h-[112px]`}
              >
                <h3 className="mb-1 text-[0.96rem] font-bold text-deep">
                  {gastronomyCourse.name}
                </h3>
                <p className="text-[0.9rem] leading-[1.45] text-ash">
                  {gastronomyCourse.description}
                </p>
              </article>
            )}
          </div>
        </section>

        <section className="mt-3 py-1" id="ranking">
          <div className="mb-2.5 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between xl:gap-[18px]">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
                Ranking
              </p>
              <h2 className="max-w-[18ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[1.35rem]">
                Placar atualizado
              </h2>
            </div>
          </div>
          <div className={`${shellClass} p-3 xl:p-[14px]`}>
            <div className="mb-2.5 xl:mb-3">
              <span className="inline-flex rounded-full border border-transparent bg-sky/20 px-3 py-1.5 text-[0.8rem] font-semibold text-deep">
                Gastronomia
              </span>
            </div>
            <RankingList
              items={ranking}
              loading={rankingLoading}
              nodesRef={nodesRef}
            />
          </div>
        </section>
      </main>
    </div>
  );

  const renderAuth = () => (
    <div
      className={`${shellClass} grid w-full max-w-[min(94vw,760px)] gap-[18px] p-[clamp(18px,4vw,32px)] text-left`}
    >
      <div className="grid gap-2">
        <h2 className="text-[1.5rem] font-bold text-deep">
          Acompanhamento de Jurados
        </h2>
        <p className="text-[0.9rem] leading-[1.45] text-ash">
          Consulte rapidamente quem já votou e acompanhe o andamento da avaliação.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <article className={`${shellClass} p-4`}>
          <p className="text-[0.78rem] uppercase tracking-[0.14em] text-ash">
            Jurados com voto
          </p>
          <strong className="mt-2 block text-[2rem] font-extrabold text-deep">
            {jurorsStatus.votedJurors}
          </strong>
          <span className="text-[0.88rem] text-ash">
            de {jurorsStatus.totalJurors} jurados cadastrados
          </span>
        </article>
        <article className={`${shellClass} p-4`}>
          <p className="text-[0.78rem] uppercase tracking-[0.14em] text-ash">
            Ações rápidas
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className={actionClass} href="#votar">
              Ir para votação
            </a>
            <a className={secondaryActionClass} href="#ranking">
              Ver ranking
            </a>
          </div>
        </article>
      </div>
      <div className={`${shellClass} grid gap-3 p-4`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[1rem] font-bold text-deep">
              Registro dos jurados
            </h3>
            <p className="text-[0.88rem] text-ash">
              Lista de quem ja registrou voto no evento.
            </p>
          </div>
          <button
            className={secondaryActionClass}
            type="button"
            onClick={() => fetchJurorsStatus()}
          >
            Atualizar
          </button>
        </div>
        <JurorsStatusList
          jurors={jurorsStatus.jurors}
          loading={jurorsLoading}
        />
      </div>
      <a className={secondaryActionClass} href="#landing">
        Voltar
      </a>
    </div>
  );

  const renderVoting = () => (
    <div className="mx-auto w-full max-w-[min(98vw,1320px)] px-[clamp(12px,2.6vw,34px)] py-[clamp(14px,2.8vw,30px)]">
      <header className="flex flex-col items-start justify-between gap-4 pb-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
            Painel de voto
          </p>
          <h1 className="text-[clamp(1.7rem,3vw,3rem)] font-extrabold leading-[1.02] text-deep">
            Painel de voto dos jurados.
          </h1>
          <p className="max-w-[62ch] text-[0.98rem] leading-[1.5] text-ash">
            Informe seu nome, selecione a equipe e registre a avaliacao em poucos cliques.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className={actionClass} href="#landing">
            Voltar
          </a>
        </div>
      </header>

      <main className="grid gap-4 xl:grid-cols-[minmax(0,1.28fr)_minmax(340px,0.92fr)]">
        <section className="grid gap-4">
          <div className={`${shellClass} grid gap-3 p-[18px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
              Curso
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-transparent bg-sky/20 px-3 py-[7px] text-[0.8rem] font-bold text-deep">
                Gastronomia
              </span>
            </div>
          </div>

          <div className={`${shellClass} grid gap-3 p-[18px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
              Jurado
            </p>
            <label className="grid gap-1.5 font-semibold text-deep">
              Nome do jurado
              <input
                className="rounded-[14px] border border-[#8c6b45]/35 bg-[#fffaf0] px-3 py-2.5 text-[0.95rem] text-deep outline-none transition focus:border-[#9f763e]"
                value={jurorName}
                onChange={(event) => setJurorName(event.target.value)}
                placeholder="Ex.: Maria Souza"
              />
            </label>
          </div>

          <div className={`${shellClass} grid gap-3 p-[18px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
              Equipe
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.9rem] leading-[1.45] text-ash">
                Escolha abaixo a equipe que esta sendo avaliada.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {displayedTeams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`rounded-full border px-3.5 py-2 text-[0.86rem] font-bold transition ${
                    toIdString(team.id) === toIdString(selectedTeamId)
                      ? "border-transparent bg-sunset/25 text-deep shadow-soft ring-2 ring-[#dba85f]/45"
                      : "border-[#8d673c]/20 bg-[#fffaf0]/80 text-deep hover:bg-deep/5"
                  }`}
                  onClick={() => {
                    setSelectedTeamId(toIdString(team.id));
                    setShowTeamSelectionError(false);
                    setLoadError("");
                    setExistingVote(null);
                  }}
                >
                  {team.name}
                </button>
              ))}
            </div>
            {!bootstrapLoading && !displayedTeams.length && (
              <p className="text-[0.9rem] text-ash">
                Nenhuma equipe de Gastronomia foi encontrada.
              </p>
            )}
            {showTeamSelectionError && (
              <p className="text-[0.9rem] font-semibold text-[#8d2c1c]">
                Selecione a equipe.
              </p>
            )}
          </div>

          <div className={`${shellClass} grid gap-3 p-[18px]`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
                  Tempo da apresentacao
                </p>
                <h3 className="mt-1 text-base font-bold text-deep">
                  Regra de penalidade automatica
                </h3>
                <p className="text-[0.85rem] leading-[1.45] text-ash">
                  Sem penalidade entre 03:00 e 05:00. Fora dessa faixa, perde 0,1 a cada 30 segundos completos.
                </p>
              </div>
              <div className="w-full rounded-2xl border border-[#8d673c]/25 bg-white/60 px-4 py-4 text-center shadow-soft lg:w-[260px] lg:text-right">
                <strong className="block text-[1.8rem] font-extrabold tracking-[0.06em] text-deep">
                  {formatElapsedTime(presentationTimeSeconds)}
                </strong>
                <span className="text-[0.8rem] font-semibold text-ash">
                  {timerStatus}
                </span>
              </div>
            </div>
            <div className="grid gap-3 rounded-2xl border border-[#8d673c]/20 bg-[#fffaf0]/80 p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div className="grid gap-2 text-[0.85rem] text-ash">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="grid gap-1">
                    <span className="text-[0.75rem] uppercase tracking-[0.08em]">Min</span>
                    <input
                      className="w-[84px] rounded-xl border border-[#8d673c]/30 bg-white px-2.5 py-1.5 text-[0.9rem] text-deep outline-none"
                      type="number"
                      min={0}
                      max={59}
                      value={presentationMinutes}
                      onChange={(event) =>
                        setPresentationMinutes(
                          clamp(Number(event.target.value || 0), 0, 59),
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[0.75rem] uppercase tracking-[0.08em]">Seg</span>
                    <input
                      className="w-[84px] rounded-xl border border-[#8d673c]/30 bg-white px-2.5 py-1.5 text-[0.9rem] text-deep outline-none"
                      type="number"
                      min={0}
                      max={59}
                      value={presentationSeconds}
                      onChange={(event) =>
                        setPresentationSeconds(
                          clamp(Number(event.target.value || 0), 0, 59),
                        )
                      }
                    />
                  </label>
                </div>
                <span>
                  Penalidade atual:{" "}
                  <strong className="text-deep">
                    {timePenalty > 0 ? `-${timePenalty.toFixed(1)}` : "sem perda"}
                  </strong>
                </span>
                <span>
                  Nota final prevista:{" "}
                  <strong className="text-deep">{formatScoreValue(finalScore)}</strong>
                </span>
              </div>
              <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                <button
                  className={secondaryActionClass}
                  type="button"
                  onClick={() => {
                    setPresentationMinutes(0);
                    setPresentationSeconds(0);
                  }}
                >
                  Limpar tempo
                </button>
              </div>
            </div>
          </div>

          <div className={`${shellClass} grid gap-3 p-[18px]`}>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
                  Proxima etapa
                </p>
                <h3 className="text-base font-bold text-deep">
                  Abrir avaliacao da equipe
                </h3>
                <p className="text-[0.88rem] leading-[1.45] text-ash">
                  Depois de escolher a equipe e revisar o tempo, avance para preencher as notas.
                </p>
              </div>
              <a
                className={actionClass}
                href={selectedTeamId ? "#avaliar" : "#votar"}
                onClick={(event) => {
                  if (!selectedTeamId) {
                    event.preventDefault();
                    setShowTeamSelectionError(true);
                    setVoteFeedback("Selecione uma equipe antes de continuar.");
                  }
                }}
              >
                Proximo
              </a>
            </div>
          </div>

        </section>

        <aside className={`${shellClass} h-fit p-4 xl:sticky xl:top-4`}>
          <div className="mb-2">
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
              Ranking ao vivo
            </p>
            <h3 className="text-base font-bold text-deep">
              {gastronomyCourse?.name ?? "Gastronomia"}
            </h3>
          </div>
          <p className="mb-3 text-[0.88rem] leading-[1.45] text-ash">
            O ranking fica visivel o tempo todo para facilitar a navegacao no celular e no computador.
          </p>
          <RankingList
            items={ranking}
            loading={rankingLoading}
            nodesRef={nodesRef}
            showVotes
          />
        </aside>
      </main>
    </div>
  );

  const renderEvaluation = () => (
    <div className="mx-auto w-full max-w-[min(98vw,1320px)] px-[clamp(12px,2.6vw,34px)] py-[clamp(14px,2.8vw,30px)]">
      <header className="flex flex-col items-start justify-between gap-4 pb-4 md:flex-row md:items-end">
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
            Avaliacao
          </p>
          <h1 className="text-[clamp(1.7rem,3vw,3rem)] font-extrabold leading-[1.02] text-deep">
            {selectedTeam ? `Notas da equipe ${selectedTeam.name}` : "Notas da equipe"}
          </h1>
          <p className="max-w-[62ch] text-[0.98rem] leading-[1.5] text-ash">
            Defina as notas por clique e salve a avaliacao da apresentacao.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className={secondaryActionClass} href="#votar">
            Voltar
          </a>
        </div>
      </header>

      <main className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <section className={`${shellClass} grid gap-3 p-[18px]`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
                Equipe selecionada
              </p>
              <h3 className="text-base font-bold text-deep">
                {selectedTeam ? selectedTeam.name : "Nenhuma equipe selecionada"}
              </h3>
            </div>
            <div className="rounded-full bg-deep/5 px-3 py-1.5 text-[0.78rem] font-semibold text-ash">
              Base {formatScoreValue(baseScore)} | Final {formatScoreValue(finalScore)}
            </div>
          </div>
          {!selectedTeamId && (
            <p className="text-[0.9rem] font-semibold text-[#8d2c1c]">
              Selecione uma equipe na pagina anterior para continuar.
            </p>
          )}
          {loadingVote && (
            <p className="text-[0.9rem] text-ash">Carregando avaliacao...</p>
          )}
          {!loadingVote && Boolean(loadError) && (
            <p className="text-[0.9rem] font-semibold text-[#8d2c1c]">
              {loadError}
            </p>
          )}
          {!loadingVote && !loadError && selectedTeamId && !existingVote && (
            <p className="text-[0.9rem] text-ash">
              Nenhuma avaliacao anterior encontrada. Preencha e salve normalmente.
            </p>
          )}
          <form className="grid gap-3" onSubmit={handleVoteSubmit}>
            {bootstrap.criteria.map((criterion, index) => (
              <div
                key={criterion.id}
                className={`grid gap-2 font-semibold text-deep ${index > 0 ? "border-t border-deep/20 pt-3" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid gap-0.5">
                    <strong>{criterion.title}</strong>
                    <small className="text-[0.85rem] font-normal text-ash">
                      {criterion.question}
                    </small>
                  </span>
                  <span className="rounded-full bg-sky/15 px-2.5 py-1 text-[0.78rem] font-bold text-deep">
                    Nota {scores[criterion.id] ?? criterion.min}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from(
                    { length: criterion.max - criterion.min + 1 },
                    (_, valueIndex) => criterion.min + valueIndex,
                  ).map((value) => {
                    const isSelected = (scores[criterion.id] ?? criterion.min) === value;
                    return (
                      <button
                        key={`${criterion.id}-${value}`}
                        type="button"
                        className={`min-w-[46px] rounded-xl border px-3 py-2 text-[0.9rem] font-bold transition ${
                          isSelected
                            ? "border-transparent bg-[linear-gradient(140deg,#e7bf86,#d7a160)] text-deep shadow-soft ring-2 ring-[#dba85f]/45"
                            : "border-[#8d673c]/25 bg-[#fffaf0]/90 text-deep hover:bg-deep/5"
                        }`}
                        onClick={() =>
                          setScores((current) => ({
                            ...current,
                            [criterion.id]: value,
                          }))
                        }
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
                <div className="text-[0.76rem] text-ash">
                  Clique para definir a nota entre {scoreLabels(criterion)}.
                </div>
              </div>
            ))}
            <div className="grid gap-1 rounded-2xl border border-[#8d673c]/20 bg-[#fffaf0]/80 px-3.5 py-3 text-[0.88rem] text-ash md:grid-cols-3">
              <span>
                Pontuacao base:{" "}
                <strong className="text-deep">{formatScoreValue(baseScore)}</strong>
              </span>
              <span>
                Penalidade por tempo:{" "}
                <strong className="text-deep">
                  {timePenalty > 0 ? `-${timePenalty.toFixed(1)}` : "0.0"}
                </strong>
              </span>
              <span>
                Nota final:{" "}
                <strong className="text-deep">{formatScoreValue(finalScore)}</strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className={actionClass}
                type="submit"
                disabled={voteLoading || loadingVote || !selectedTeamId}
              >
                {voteMode === "edit" ? "Atualizar avaliacao" : "Salvar avaliacao"}
              </button>
              <button
                className={secondaryActionClass}
                type="button"
                onClick={clearLocalForm}
                disabled={voteLoading || loadingVote}
              >
                Limpar formulario
              </button>
              <button
                className={secondaryActionClass}
                type="button"
                onClick={handleVoteReset}
                disabled={voteLoading || loadingVote || !selectedTeamId}
              >
                Resetar avaliacao
              </button>
            </div>
              {voteFeedback && (
                <p className="text-[0.9rem] font-semibold text-deep">{voteFeedback}</p>
              )}
            </form>

            {showResetModal && (
              <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(41,27,11,0.35)] px-4">
                <div className="w-full max-w-[460px] rounded-[24px] border border-[#8d673c]/30 bg-[linear-gradient(165deg,rgba(254,248,234,0.98),rgba(243,230,204,0.97)_52%,rgba(236,218,186,0.98))] p-5 shadow-[0_26px_60px_rgba(58,35,12,0.24)]">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
                    Confirmar reset
                  </p>
                  <h4 className="mt-1 text-[1.1rem] font-bold text-deep">
                    Resetar avaliacao salva?
                  </h4>
                  <p className="mt-2 text-[0.92rem] leading-[1.5] text-ash">
                    Essa acao apaga a avaliacao desta equipe no banco e atualiza o ranking ao vivo.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className={secondaryActionClass}
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      disabled={voteLoading}
                    >
                      Cancelar
                    </button>
                    <button
                      className={actionClass}
                      type="button"
                      onClick={confirmVoteReset}
                      disabled={voteLoading}
                    >
                      Confirmar reset
                    </button>
                  </div>
                </div>
              </div>
            )}
        </section>

        <aside className={`${shellClass} h-fit p-4 xl:sticky xl:top-4`}>
          <div className="mb-2">
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
              Ranking ao vivo
            </p>
            <h3 className="text-base font-bold text-deep">
              {gastronomyCourse?.name ?? "Gastronomia"}
            </h3>
          </div>
          <p className="mb-3 text-[0.88rem] leading-[1.45] text-ash">
            Consulte o placar enquanto preenche a avaliacao.
          </p>
          <RankingList
            items={ranking}
            loading={rankingLoading}
            nodesRef={nodesRef}
            showVotes
          />
        </aside>
      </main>
    </div>
  );

  if (page === "auth") {
    return <VintageFrame centerContent>{renderAuth()}</VintageFrame>;
  }

  if (page === "votar") {
    return <VintageFrame>{renderVoting()}</VintageFrame>;
  }

  if (page === "avaliar") {
    return <VintageFrame>{renderEvaluation()}</VintageFrame>;
  }

  return <VintageFrame>{renderLanding()}</VintageFrame>;
}

function RankingList({ items, loading, nodesRef, showVotes = false }) {
  if (loading) {
    return (
      <div className="grid gap-2 text-[0.9rem] leading-[1.45] text-ash">
        Carregando ranking...
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="grid gap-2 text-[0.9rem] leading-[1.45] text-ash">
        Sem votos registrados ainda.
      </div>
    );
  }

  return (
    <div className="grid gap-2 xl:grid-cols-2 xl:gap-2.5">
      {items.map((item, index) => (
        <article
          key={item.team_id}
          className={`${shellClass} grid grid-cols-[auto_1fr] items-center gap-2.5 px-2.5 py-[9px] xl:min-h-[78px]`}
          ref={(node) => {
            if (node) nodesRef.current.set(item.team_id, node);
          }}
        >
          <div className="min-w-[44px] rounded-[10px] bg-sunset/25 px-2 py-1.5 text-center text-[0.94rem] font-extrabold text-deep">
            #{index + 1}
          </div>
          <div>
            <strong className="mb-1 block text-[0.96rem] text-deep">
              {item.team_name}
            </strong>
            <div className="my-1.5 h-[7px] overflow-hidden rounded-full bg-deep/10">
              <span
                className="block h-full bg-bar-fill transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round(item.avg_percent)}%` }}
              />
            </div>
            <div className="flex gap-2 text-[0.76rem] text-ash">
              <span>Total {formatRankingScore(item.total_score)}</span>
              <span>Media {formatRankingScore(item.avg_score)}</span>
              {showVotes && <span>{item.total_votes} votos</span>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function JurorsStatusList({ jurors, loading }) {
  if (loading) {
    return (
      <div className="grid gap-2 text-[0.9rem] leading-[1.45] text-ash">
        Carregando jurados...
      </div>
    );
  }

  if (!jurors.length) {
    return (
      <div className="grid gap-2 text-[0.9rem] leading-[1.45] text-ash">
        Nenhum jurado registrado ainda.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {jurors.map((juror) => (
        <article
          key={juror.id}
          className={`${shellClass} flex items-center justify-between gap-3 px-3 py-2.5`}
        >
          <div>
            <strong className="block text-[0.95rem] text-deep">
              {juror.full_name}
            </strong>
            <span className="text-[0.8rem] text-ash">
              {juror.has_voted ? "Voto registrado" : "Aguardando voto"}
            </span>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[0.78rem] font-bold ${
              juror.has_voted
                ? "bg-[#dcecc8] text-[#38551a]"
                : "bg-[#f2dfc4] text-[#7a5330]"
            }`}
          >
            {juror.has_voted ? "Concluido" : "Pendente"}
          </span>
        </article>
      ))}
    </div>
  );
}

function VintageFrame({ children, centerContent = false }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#e8dcc3] font-sans text-[15px] text-deep">
      <img
        alt=""
        aria-hidden="true"
        src="/img/vintage_background_1920x1080.png"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(238,223,193,0.42),rgba(232,216,186,0.6))]" />
      <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:repeating-linear-gradient(25deg,rgba(117,84,40,0.08)_0,rgba(117,84,40,0.08)_1px,transparent_1px,transparent_6px)]" />

      <img
        alt=""
        aria-hidden="true"
        src="/img/Chef%20at%20work%20with%20fresh%20ingredients.png"
        className="pointer-events-none absolute bottom-[-23px] right-0 z-50 w-[clamp(160px,23vw,420px)] max-w-[42vw] object-contain opacity-95"
      />
      <img
        alt=""
        aria-hidden="true"
        src="/img/Grilled%20steak%20with%20tomato%20and%20veggies.png"
        className="pointer-events-none absolute left-0 top-0 z-40 w-[clamp(170px,24vw,360px)] max-w-[34vw] object-contain opacity-95"
      />

      <img
        alt=""
        aria-hidden="true"
        src="/ornament-corner.svg"
        className="pointer-events-none absolute -left-10 -top-10 hidden w-[min(22vw,250px)] opacity-70 sm:block"
      />
      <img
        alt=""
        aria-hidden="true"
        src="/ornament-corner.svg"
        className="pointer-events-none absolute -right-10 -top-10 hidden w-[min(22vw,250px)] rotate-90 opacity-65 sm:block"
      />
      <img
        alt=""
        aria-hidden="true"
        src="/ornament-vine.svg"
        className="pointer-events-none absolute -left-8 bottom-6 hidden w-[min(16vw,170px)] opacity-45 lg:block"
      />
      <img
        alt=""
        aria-hidden="true"
        src="/ornament-vine.svg"
        className="pointer-events-none absolute -right-8 bottom-8 hidden w-[min(16vw,170px)] -scale-x-100 opacity-45 lg:block"
      />

      <div
        className={`relative z-10 mx-auto w-full max-w-[min(98vw,1360px)] px-[clamp(10px,2.5vw,30px)] py-[clamp(14px,3vw,36px)] ${
          centerContent ? "grid min-h-screen place-items-center" : ""
        }`}
      >
        <div
          className={`relative overflow-hidden rounded-[clamp(24px,3.5vw,36px)] border border-[#8d6a41]/40 bg-[linear-gradient(165deg,rgba(254,248,234,0.96),rgba(243,230,204,0.94)_52%,rgba(236,218,186,0.95))] shadow-[0_26px_60px_rgba(58,35,12,0.24)] ${
            centerContent ? "w-full max-w-[min(92vw,560px)]" : ""
          }`}
        >
          <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(rgba(111,79,37,0.18)_0.8px,transparent_0.8px)] [background-size:4px_4px]" />
          <div className="pointer-events-none absolute inset-[9px] rounded-[clamp(18px,3vw,28px)] border border-[#a98251]/30" />
          <div className="relative z-10 pb-[clamp(10px,1.8vw,22px)]">{children}</div>
        </div>
      </div>
    </div>
  );
}
