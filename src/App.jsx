import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const apiBaseUrl = import.meta.env.DEV
  ? "http://localhost:3001"
  : import.meta.env.VITE_API_BASE_URL || "/api";
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
    title: "Painel de jurados",
    description: "Acompanhe quem ja registrou voto no evento.",
  },
];

const DEFAULT_PAGE = "landing";
const GASTRONOMY_COURSE_NAME = "Gastronomia";
const TIME_CRITERION_TITLE = "Tempo";
const TIMER_MIN_SECONDS = 3 * 60;
const TIMER_MAX_SECONDS = 5 * 60;
const TIMER_PENALTY_STEP_SECONDS = 30;

const scoreLabels = (criterion) => `${criterion.min} - ${criterion.max}`;
const isTimeCriterion = (criterion) => criterion.title === TIME_CRITERION_TITLE;
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
const getTimePenalty = (elapsedSeconds) => {
  if (elapsedSeconds < TIMER_MIN_SECONDS) {
    return Math.ceil((TIMER_MIN_SECONDS - elapsedSeconds) / TIMER_PENALTY_STEP_SECONDS) * 0.1;
  }

  if (elapsedSeconds > TIMER_MAX_SECONDS) {
    return Math.ceil((elapsedSeconds - TIMER_MAX_SECONDS) / TIMER_PENALTY_STEP_SECONDS) * 0.1;
  }

  return 0;
};
const getTimeScore = (criterion, elapsedSeconds) =>
  clamp(criterion.max - getTimePenalty(elapsedSeconds), criterion.min, criterion.max);
const getTimerStatus = (elapsedSeconds) => {
  if (elapsedSeconds === 0) {
    return "Cronometro pronto para iniciar.";
  }

  if (elapsedSeconds < TIMER_MIN_SECONDS) {
    return "Abaixo do tempo ideal.";
  }

  if (elapsedSeconds <= TIMER_MAX_SECONDS) {
    return "Dentro da faixa sem penalidade.";
  }

  return "Acima do tempo ideal.";
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
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [scores, setScores] = useState({});
  const [ranking, setRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [voteFeedback, setVoteFeedback] = useState("");
  const [timerElapsedSeconds, setTimerElapsedSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStarted, setTimerStarted] = useState(false);
  const positionsRef = useRef(new Map());
  const nodesRef = useRef(new Map());

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
      return;
    }

    const loadBootstrap = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/bootstrap`);
        if (!response.ok) {
          throw new Error("Falha ao carregar dados");
        }
        const data = await response.json();
        setBootstrap(data);
        setStatus("Sistema pronto para votar.");
        const gastronomia = (data.courses ?? []).find(
          (course) => course.name === GASTRONOMY_COURSE_NAME,
        );
        if (gastronomia) {
          setSelectedCourseId(gastronomia.id);
        }
      } catch (error) {
        setStatus("Nao foi possivel carregar os dados do evento.");
      }
    };

    loadBootstrap();
  }, [isConfigured]);

  useEffect(() => {
    fetchJurorsStatus();
  }, []);

  useEffect(() => {
    if (!selectedCourseId) return;
    fetchRanking(selectedCourseId);
  }, [selectedCourseId]);

  useEffect(() => {
    if (!supabase || !selectedCourseId) return;

    const channel = supabase.channel("votes-ranking");
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "vote_scores" },
      () => fetchRanking(selectedCourseId, true),
    );
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "votes" },
      () => fetchRanking(selectedCourseId, true),
    );

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedCourseId]);

  useEffect(() => {
    if (!selectedTeamId) return;
    const nextScores = {};
    bootstrap.criteria.forEach((criterion) => {
      if (!isTimeCriterion(criterion)) {
        nextScores[criterion.id] = criterion.min;
      }
    });
    setScores(nextScores);
    setTimerElapsedSeconds(0);
    setTimerRunning(false);
    setTimerStarted(false);
    setVoteFeedback("");
  }, [selectedTeamId, bootstrap.criteria]);

  useEffect(() => {
    if (!timerRunning) return undefined;

    const intervalId = window.setInterval(() => {
      setTimerElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [timerRunning]);

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

  const handleVoteSubmit = async (event) => {
    event.preventDefault();
    if (!jurorName.trim()) {
      setVoteFeedback("Informe o nome do jurado.");
      return;
    }

    if (!selectedTeamId) {
      setVoteFeedback("Selecione a equipe.");
      return;
    }

    const timeCriterion = bootstrap.criteria.find(isTimeCriterion);
    if (timeCriterion && !timerStarted) {
      setVoteFeedback("Inicie o cronometro antes de salvar o voto.");
      return;
    }

    const payload = bootstrap.criteria.map((criterion) => ({
      criterionId: criterion.id,
      score: isTimeCriterion(criterion)
        ? Number(getTimeScore(criterion, timerElapsedSeconds).toFixed(1))
        : scores[criterion.id] ?? criterion.min,
    }));

    try {
      const response = await fetch(`${apiBaseUrl}/votes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teamId: selectedTeamId,
          jurorName: jurorName.trim(),
          scores: payload,
        }),
      });

      if (!response.ok) {
        throw new Error("Falha ao salvar voto");
      }

      setVoteFeedback("Voto registrado com sucesso.");
      setTimerRunning(false);
      fetchRanking(selectedCourseId, true);
      fetchJurorsStatus(true);
    } catch (error) {
      setVoteFeedback("Nao foi possivel registrar o voto.");
    }
  };

  const gastronomiaCourse = bootstrap.courses.find(
    (course) => course.name === GASTRONOMY_COURSE_NAME,
  );
  const selectedCourseIdSafe = selectedCourseId || gastronomiaCourse?.id || "";
  const courseTeams = bootstrap.teams.filter(
    (team) => team.course_id === selectedCourseIdSafe,
  );
  const selectedTeam = courseTeams.find((team) => team.id === selectedTeamId);
  const timeCriterion = bootstrap.criteria.find(isTimeCriterion);
  const timePenalty = timeCriterion ? getTimePenalty(timerElapsedSeconds) : 0;
  const timeScore = timeCriterion
    ? getTimeScore(timeCriterion, timerElapsedSeconds)
    : 0;
  const timerStatus = getTimerStatus(timerElapsedSeconds);

  useEffect(() => {
    if (
      selectedTeamId &&
      !courseTeams.some((team) => team.id === selectedTeamId)
    ) {
      setSelectedTeamId("");
    }
  }, [selectedTeamId, courseTeams]);

  const renderLanding = () => (
    <div className="mx-auto w-full max-w-[min(96vw,1180px)] px-[clamp(12px,2.6vw,34px)] pb-[clamp(16px,3vw,30px)]">
      <header className="pt-2 xl:pt-3">
        <nav className="flex items-center justify-between gap-3 py-1.5 xl:py-2">
          <span className="text-[1.16rem] font-extrabold tracking-[0.02em] text-deep">
            Voto Ao Vivo
          </span>
          <div className="hidden items-center gap-3.5 text-[0.84rem] text-ash md:flex"></div>
          <a className={actionClass} href="#auth">
            Entrar
          </a>
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
              <a className={actionClass} href="#auth">
                Entrar para votar
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
              Placar
            </h2>
            <ul className="mt-2.5 list-disc space-y-1 pl-4 text-[0.84rem] leading-[1.45] text-ash">
              <li>Ranking de Gastronomia</li>
              <li>Media da equipe dividida por 3</li>
              <li>Animacao de subida/queda</li>
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
            {gastronomiaCourse && (
              <article
                key={gastronomiaCourse.id}
                className={`${shellClass} p-3 xl:min-h-[112px]`}
              >
                <h3 className="mb-1 text-[0.96rem] font-bold text-deep">
                  {gastronomiaCourse.name}
                </h3>
                <p className="text-[0.9rem] leading-[1.45] text-ash">
                  {gastronomiaCourse.description}
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
          Painel de Jurados
        </h2>
        <p className="text-[0.9rem] leading-[1.45] text-ash">
          A antiga tela de entrar agora virou um painel rapido para acompanhar quem ja votou e acessar o placar.
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
            Acoes rapidas
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a className={actionClass} href="#votar">
              Ir para votacao
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
        Voltar para a landing
      </a>
    </div>
  );

  const renderVoting = () => (
    <div className="mx-auto w-full max-w-[min(96vw,1160px)] px-[clamp(10px,2.3vw,24px)] py-[clamp(10px,2.2vw,20px)]">
      <header className="flex flex-col items-start justify-between gap-3 pb-3 md:flex-row md:items-end">
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
            Painel de voto
          </p>
          <h1 className="text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep">
            Painel de voto dos jurados.
          </h1>
          <p className="text-[0.9rem] leading-[1.45] text-ash">
            Informe o nome do jurado, selecione a equipe e registre a avaliacao em poucos cliques.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a className={secondaryActionClass} href="#landing">
            Landing
          </a>
          <a className={actionClass} href="#auth">
            Painel
          </a>
        </div>
      </header>

      <main className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="grid gap-2.5">
          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
              Curso
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-transparent bg-sky/20 px-3 py-[7px] text-[0.8rem] font-bold text-deep">
                Gastronomia
              </span>
            </div>
          </div>

          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
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

          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
              Equipe
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {courseTeams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`rounded-xl border px-2.5 py-2.5 text-left text-[0.82rem] font-bold transition ${
                    team.id === selectedTeamId
                      ? "border-transparent bg-sunset/20 text-deep shadow-soft"
                      : "border-deep/20 bg-white/60 text-deep hover:bg-deep/5"
                  }`}
                  onClick={() => setSelectedTeamId(team.id)}
                >
                  <span>{team.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
                  Cronometro
                </p>
                <h3 className="mt-1 text-base font-bold text-deep">
                  Controle do tempo da apresentacao
                </h3>
                <p className="text-[0.85rem] leading-[1.45] text-ash">
                  Entre 3:00 e 5:00 nao perde pontos. Fora dessa faixa, perde 0,1 a cada 30 segundos.
                </p>
              </div>
              <div className="rounded-2xl border border-[#8d673c]/25 bg-white/60 px-4 py-3 text-right shadow-soft">
                <strong className="block text-[1.8rem] font-extrabold tracking-[0.06em] text-deep">
                  {formatElapsedTime(timerElapsedSeconds)}
                </strong>
                <span className="text-[0.8rem] font-semibold text-ash">
                  {timerStatus}
                </span>
              </div>
            </div>
            <div className="grid gap-2 rounded-2xl border border-[#8d673c]/20 bg-[#fffaf0]/80 p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="grid gap-1 text-[0.85rem] text-ash">
                <span>
                  Penalidade atual:{" "}
                  <strong className="text-deep">
                    {timePenalty > 0 ? `-${timePenalty.toFixed(1)}` : "sem perda"}
                  </strong>
                </span>
                {timeCriterion && (
                  <span>
                    Nota de Tempo:{" "}
                    <strong className="text-deep">
                      {formatScoreValue(timeScore)} / {timeCriterion.max}
                    </strong>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={actionClass}
                  type="button"
                  onClick={() => {
                    setTimerStarted(true);
                    setTimerRunning(true);
                  }}
                >
                  {timerStarted ? "Retomar" : "Iniciar"}
                </button>
                <button
                  className={secondaryActionClass}
                  type="button"
                  onClick={() => setTimerRunning(false)}
                  disabled={!timerRunning}
                >
                  Pausar
                </button>
                <button
                  className={secondaryActionClass}
                  type="button"
                  onClick={() => {
                    setTimerElapsedSeconds(0);
                    setTimerRunning(false);
                    setTimerStarted(false);
                  }}
                >
                  Reiniciar
                </button>
              </div>
            </div>
          </div>

          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">
              Avaliacao
            </p>
            <h3 className="text-base font-bold text-deep">
              {selectedTeam
                ? `Equipe ${selectedTeam.name}`
                : "Selecione uma equipe"}
            </h3>
            <form className="grid gap-3" onSubmit={handleVoteSubmit}>
              {bootstrap.criteria.map((criterion, index) => (
                <div
                  key={criterion.id}
                  className={`grid gap-1.5 font-semibold text-deep ${index > 0 ? "border-t border-deep/20 pt-2.5" : ""}`}
                >
                  <span className="grid gap-0.5">
                    <strong>{criterion.title}</strong>
                    <small className="text-[0.85rem] font-normal text-ash">
                      {criterion.question}
                    </small>
                  </span>
                  {isTimeCriterion(criterion) ? (
                    <div className="rounded-2xl border border-[#8d673c]/20 bg-[#fffaf0]/80 p-3">
                      <div className="flex items-center justify-between gap-3 text-[0.8rem] text-ash">
                        <span>Faixa ideal: 03:00 ate 05:00</span>
                        <strong className="text-deep">
                          {formatScoreValue(timeScore)}
                        </strong>
                      </div>
                      <div className="mt-2 h-[7px] overflow-hidden rounded-full bg-deep/10">
                        <span
                          className="block h-full bg-bar-fill transition-[width] duration-300 ease-out"
                          style={{
                            width: `${((timeScore - criterion.min) / (criterion.max - criterion.min || 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <input
                        className="w-full accent-sky"
                        type="range"
                        min={criterion.min}
                        max={criterion.max}
                        value={scores[criterion.id] ?? criterion.min}
                        onChange={(event) =>
                          setScores((current) => ({
                            ...current,
                            [criterion.id]: Number(event.target.value),
                          }))
                        }
                      />
                      <div className="flex items-center justify-between text-[0.76rem] text-ash">
                        <span>{scoreLabels(criterion)}</span>
                        <strong className="text-deep">
                          {scores[criterion.id] ?? criterion.min}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button className={actionClass} type="submit">
                Salvar voto
              </button>
              {voteFeedback && (
                <p className="text-[0.9rem] font-semibold text-deep">
                  {voteFeedback}
                </p>
              )}
            </form>
          </div>
        </section>

        <aside className={`${shellClass} sticky top-3 h-fit p-3 lg:block`}>
          <div className="mb-2">
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">
              Ranking ao vivo
            </p>
            <h3 className="text-base font-bold text-deep">
              {gastronomiaCourse?.name ?? "Gastronomia"}
            </h3>
          </div>
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
        className="pointer-events-none absolute left-0 top-0 z-40 w-[clamp(120px,18vw,280px)] max-w-[28vw] object-contain opacity-95"
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
          <div className="relative z-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
