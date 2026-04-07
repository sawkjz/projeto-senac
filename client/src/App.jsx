import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const heroHighlights = [
  {
    title: 'Ranking ao vivo',
    description: 'Votos atualizam o placar em tempo real.'
  },
  {
    title: 'Filtro por curso',
    description: 'Gastronomia e ADS separados por painel.'
  }
];

const DEFAULT_PAGE = 'landing';

const scoreLabels = (criterion) => `${criterion.min} - ${criterion.max}`;

const shellClass =
  'rounded-[18px] border border-deep/20 bg-[rgba(246,240,226,0.86)] shadow-soft backdrop-blur-md';
const actionClass =
  'inline-flex items-center justify-center rounded-full bg-brand-accent px-4 py-2 text-[0.84rem] font-bold text-deep shadow-button transition hover:brightness-[1.03]';
const secondaryActionClass =
  'inline-flex items-center justify-center rounded-full border border-deep px-3.5 py-2 text-[0.82rem] font-semibold text-deep transition hover:bg-deep/5';

export default function App() {
  const [page, setPage] = useState(DEFAULT_PAGE);
  const [session, setSession] = useState(null);
  const [authView, setAuthView] = useState('login');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [status, setStatus] = useState('Conectando...');
  const [bootstrap, setBootstrap] = useState({
    courses: [],
    teams: [],
    criteria: []
  });
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [scores, setScores] = useState({});
  const [ranking, setRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [voteFeedback, setVoteFeedback] = useState('');
  const positionsRef = useRef(new Map());
  const nodesRef = useRef(new Map());

  const isConfigured = useMemo(() => Boolean(apiBaseUrl), []);

  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash.replace('#', '') || DEFAULT_PAGE;
      setPage(next);
    };

    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sessionData) => {
      setSession(sessionData);
    });

    return () => {
      listener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !supabase) {
      setProfileName('');
      return;
    }

    const loadProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .maybeSingle();
      setProfileName(data?.full_name ?? '');
    };

    loadProfile();
  }, [session]);

  useEffect(() => {
    if (!isConfigured) {
      setStatus('Defina VITE_API_BASE_URL para conectar ao servidor.');
      return;
    }

    const loadBootstrap = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/bootstrap`);
        if (!response.ok) {
          throw new Error('Falha ao carregar dados');
        }
        const data = await response.json();
        setBootstrap(data);
        setStatus('Sistema pronto para votar.');
        if (data.courses.length && !selectedCourseId) {
          setSelectedCourseId(data.courses[0].id);
        }
      } catch (error) {
        setStatus('Nao foi possivel carregar os dados do evento.');
      }
    };

    loadBootstrap();
  }, [isConfigured]);

  useEffect(() => {
    if (!selectedCourseId) return;
    fetchRanking(selectedCourseId);
  }, [selectedCourseId]);

  useEffect(() => {
    if (!supabase || !selectedCourseId) return;

    const channel = supabase.channel('votes-ranking');
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'vote_scores' },
      () => fetchRanking(selectedCourseId, true)
    );
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'votes' },
      () => fetchRanking(selectedCourseId, true)
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
      nextScores[criterion.id] = criterion.min;
    });
    setScores(nextScores);
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
              { transform: 'translate(0, 0)' }
            ],
            { duration: 350, easing: 'ease-out' }
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
      const response = await fetch(`${apiBaseUrl}/ranking?courseId=${courseId}`);
      if (!response.ok) {
        throw new Error('Falha ao buscar ranking');
      }
      const data = await response.json();
      setRanking(data);
    } catch (error) {
      setRanking([]);
    } finally {
      if (!silent) setRankingLoading(false);
    }
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setAuthError('');

    const form = new FormData(event.currentTarget);
    const email = form.get('email');
    const password = form.get('password');
    const fullName = form.get('fullName');

    if (!supabase) {
      setAuthError('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      return;
    }

    try {
      if (authView === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password
        });
        if (error) throw error;
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: fullName
          });
          setProfileName(fullName);
        }
        setStatus('Cadastro feito. Confirme o email, se necessario.');
        window.location.hash = '#votar';
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
        setStatus('Login realizado.');
        window.location.hash = '#votar';
      }
    } catch (error) {
      setAuthError(error.message ?? 'Nao foi possivel autenticar.');
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    window.location.hash = '#landing';
  };

  const handleVoteSubmit = async (event) => {
    event.preventDefault();
    if (!session) {
      setVoteFeedback('Faca login para votar.');
      return;
    }

    if (!selectedTeamId) {
      setVoteFeedback('Selecione a equipe.');
      return;
    }

    const payload = Object.entries(scores).map(([criterionId, score]) => ({
      criterionId,
      score
    }));

    try {
      const response = await fetch(`${apiBaseUrl}/votes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          teamId: selectedTeamId,
          scores: payload
        })
      });

      if (!response.ok) {
        throw new Error('Falha ao salvar voto');
      }

      setVoteFeedback('Voto registrado com sucesso.');
      fetchRanking(selectedCourseId, true);
    } catch (error) {
      setVoteFeedback('Nao foi possivel registrar o voto.');
    }
  };

  const selectedCourse = bootstrap.courses.find((course) => course.id === selectedCourseId);
  const courseTeams = bootstrap.teams.filter((team) => team.course_id === selectedCourseId);
  const selectedTeam = bootstrap.teams.find((team) => team.id === selectedTeamId);

  const renderLanding = () => (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-7 xl:px-9">
      <header className="pt-2 xl:pt-3">
        <nav className="flex items-center justify-between gap-3 py-1.5 xl:py-2">
          <span className="text-[1.16rem] font-extrabold tracking-[0.02em] text-deep">Voto Ao Vivo</span>
          <div className="hidden items-center gap-3.5 text-[0.84rem] text-ash md:flex">
            <a href="#como-funciona">Como funciona</a>
            <a href="#cursos">Cursos</a>
            <a href="#ranking">Ranking</a>
          </div>
          <a className={actionClass} href="#auth">Entrar para votar</a>
        </nav>

        <section className="grid gap-3 pb-4 md:grid-cols-[1.2fr_0.8fr] xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] xl:gap-4 xl:pb-[18px]">
          <div className={`${shellClass} p-[22px] md:p-6 xl:px-[26px] xl:py-6`}>
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Painel de apresentacoes</p>
            <h1 className="max-w-[11ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[clamp(1.55rem,2vw,2.35rem)] xl:leading-[1.04]">
              Votacao ao vivo para equipes em apresentacao.
            </h1>
            <p className="mt-2.5 max-w-[52ch] text-[0.9rem] leading-[1.45] text-ash">
              Plataforma oficial para avaliacao em tempo real com ranking e criterios claros.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={actionClass} href="#auth">Entrar para votar</a>
              <a className={secondaryActionClass} href="#ranking">Ver ranking</a>
            </div>
          </div>

          <aside className={`${shellClass} bg-panel-tint p-4 xl:px-[18px] xl:py-4`}>
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Status ao vivo</p>
            <h2 className="m-0 text-[1.08rem] font-bold leading-[1.08] text-deep xl:text-[1.18rem] xl:leading-[1.1]">
              Placar central e transparente.
            </h2>
            <ul className="mt-2.5 list-disc space-y-1 pl-4 text-[0.84rem] leading-[1.45] text-ash">
              <li>Ranking por curso</li>
              <li>Percentual medio</li>
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
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Como funciona</p>
              <h2 className="max-w-[18ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[1.35rem]">
                Fluxo simples e direto para jurados.
              </h2>
            </div>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2 xl:gap-3">
            {heroHighlights.map((item) => (
              <article key={item.title} className={`${shellClass} p-3 xl:min-h-[112px]`}>
                <h3 className="mb-1 text-[0.96rem] font-bold text-deep">{item.title}</h3>
                <p className="text-[0.9rem] leading-[1.45] text-ash">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-2 py-1" id="cursos">
          <div className="mb-2.5 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between xl:gap-[18px]">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Cursos</p>
              <h2 className="max-w-[18ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[1.35rem]">
                Gastronomia e ADS em destaque.
              </h2>
            </div>
          </div>
          <div className="grid gap-2.5 md:grid-cols-2 xl:gap-3">
            {bootstrap.courses.map((course) => (
              <article key={course.id} className={`${shellClass} p-3 xl:min-h-[112px]`}>
                <h3 className="mb-1 text-[0.96rem] font-bold text-deep">{course.name}</h3>
                <p className="text-[0.9rem] leading-[1.45] text-ash">{course.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-3 py-1" id="ranking">
          <div className="mb-2.5 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between xl:gap-[18px]">
            <div>
              <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Ranking</p>
              <h2 className="max-w-[18ch] text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep xl:text-[1.35rem]">
                Placar atualizado por curso.
              </h2>
            </div>
          </div>
          <div className={`${shellClass} p-3 xl:p-[14px]`}>
            <div className="mb-2.5 flex flex-wrap gap-2 xl:mb-3">
              {bootstrap.courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 text-[0.8rem] font-semibold transition ${
                    course.id === selectedCourseId
                      ? 'border-transparent bg-sky/20 text-deep'
                      : 'border-deep/20 bg-transparent text-deep hover:bg-deep/5'
                  }`}
                  onClick={() => setSelectedCourseId(course.id)}
                >
                  {course.name}
                </button>
              ))}
            </div>
            <RankingList items={ranking} loading={rankingLoading} nodesRef={nodesRef} />
          </div>
        </section>
      </main>
    </div>
  );

  const renderAuth = () => (
    <div className="grid min-h-screen place-items-center bg-event-shell px-4 py-10 font-sans text-[15px] text-deep">
      <div className={`${shellClass} grid w-full max-w-[420px] gap-[18px] p-8 text-left`}>
        <h2 className="text-[1.5rem] font-bold text-deep">{authView === 'register' ? 'Criar conta' : 'Entrar'}</h2>
        <p className="text-[0.9rem] leading-[1.45] text-ash">
          Acesso seguro com Supabase Auth. Sua sessao permanece ativa ate sair.
        </p>
        <form className="grid gap-3" onSubmit={handleAuth}>
          {authView === 'register' && (
            <label className="grid gap-1.5 font-semibold text-deep">
              Nome completo
              <input
                className="rounded-[14px] border border-deep/20 bg-white/90 px-3 py-2.5 text-[0.95rem] text-deep outline-none transition focus:border-sky"
                name="fullName"
                required
              />
            </label>
          )}
          <label className="grid gap-1.5 font-semibold text-deep">
            Email
            <input
              className="rounded-[14px] border border-deep/20 bg-white/90 px-3 py-2.5 text-[0.95rem] text-deep outline-none transition focus:border-sky"
              name="email"
              type="email"
              required
            />
          </label>
          <label className="grid gap-1.5 font-semibold text-deep">
            Senha
            <input
              className="rounded-[14px] border border-deep/20 bg-white/90 px-3 py-2.5 text-[0.95rem] text-deep outline-none transition focus:border-sky"
              name="password"
              type="password"
              required
              minLength="6"
            />
          </label>
          {authError && <p className="text-[0.9rem] font-semibold text-[#8d2c1c]">{authError}</p>}
          <button className={actionClass} type="submit">
            {authView === 'register' ? 'Cadastrar' : 'Entrar'}
          </button>
        </form>
        <button
          className="w-fit bg-transparent p-0 text-left text-[0.9rem] font-semibold text-deep"
          type="button"
          onClick={() => setAuthView(authView === 'register' ? 'login' : 'register')}
        >
          {authView === 'register' ? 'Ja tenho conta' : 'Criar nova conta'}
        </button>
        <a className={secondaryActionClass} href="#landing">Voltar para a landing</a>
      </div>
    </div>
  );

  const renderVoting = () => (
    <div className="min-h-screen bg-event-shell font-sans text-[15px] text-deep">
      <div className="mx-auto w-full max-w-[1160px] px-[18px] py-4 pb-6">
      <header className="flex flex-col items-start justify-between gap-3 pb-3 md:flex-row md:items-end">
        <div>
          <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Painel de voto</p>
          <h1 className="text-[clamp(1.4rem,2.5vw,2.2rem)] font-extrabold leading-[1.08] text-deep">
            Bem-vindo{profileName ? `, ${profileName}` : ''}.
          </h1>
          <p className="text-[0.9rem] leading-[1.45] text-ash">
            Selecione curso, equipe e registre a avaliacao em poucos cliques.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a className={secondaryActionClass} href="#landing">Landing</a>
          <button className={actionClass} type="button" onClick={handleLogout}>Sair</button>
        </div>
      </header>

      <main className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="grid gap-2.5">
          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">Curso</p>
            <div className="flex flex-wrap gap-2">
              {bootstrap.courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className={`rounded-full border px-3 py-[7px] text-[0.8rem] font-bold transition ${
                    course.id === selectedCourseId
                      ? 'border-transparent bg-sky/20 text-deep'
                      : 'border-deep/20 bg-transparent text-deep hover:bg-deep/5'
                  }`}
                  onClick={() => {
                    setSelectedCourseId(course.id);
                    setSelectedTeamId('');
                  }}
                >
                  {course.name}
                </button>
              ))}
            </div>
          </div>

          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">Equipe</p>
            <div className="grid gap-2 md:grid-cols-2">
              {courseTeams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={`rounded-xl border px-2.5 py-2.5 text-left text-[0.82rem] font-bold transition ${
                    team.id === selectedTeamId
                      ? 'border-transparent bg-sunset/20 text-deep shadow-soft'
                      : 'border-deep/20 bg-white/60 text-deep hover:bg-deep/5'
                  }`}
                  onClick={() => setSelectedTeamId(team.id)}
                >
                  <span>{team.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={`${shellClass} grid gap-2.5 p-[14px]`}>
            <p className="text-[9px] uppercase tracking-[0.16em] text-ash">Avaliacao</p>
            <h3 className="text-base font-bold text-deep">
              {selectedTeam ? `Equipe ${selectedTeam.name}` : 'Selecione uma equipe'}
            </h3>
            <form className="grid gap-3" onSubmit={handleVoteSubmit}>
              {bootstrap.criteria.map((criterion, index) => (
                <label
                  key={criterion.id}
                  className={`grid gap-1.5 font-semibold text-deep ${index > 0 ? 'border-t border-deep/20 pt-2.5' : ''}`}
                >
                  <span className="grid gap-0.5">
                    <strong>{criterion.title}</strong>
                    <small className="text-[0.85rem] font-normal text-ash">{criterion.question}</small>
                  </span>
                  <div>
                    <input
                      className="w-full accent-sky"
                      type="range"
                      min={criterion.min}
                      max={criterion.max}
                      value={scores[criterion.id] ?? criterion.min}
                      onChange={(event) => setScores((current) => ({
                        ...current,
                        [criterion.id]: Number(event.target.value)
                      }))}
                    />
                    <div className="flex items-center justify-between text-[0.76rem] text-ash">
                      <span>{scoreLabels(criterion)}</span>
                      <strong className="text-deep">{scores[criterion.id] ?? criterion.min}</strong>
                    </div>
                  </div>
                </label>
              ))}
              <button className={actionClass} type="submit">Salvar voto</button>
              {voteFeedback && <p className="text-[0.9rem] font-semibold text-deep">{voteFeedback}</p>}
            </form>
          </div>
        </section>

        <aside className={`${shellClass} sticky top-3 h-fit p-3 lg:block`}>
          <div className="mb-2">
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ash">Ranking ao vivo</p>
            <h3 className="text-base font-bold text-deep">{selectedCourse?.name ?? 'Selecione o curso'}</h3>
          </div>
          <RankingList items={ranking} loading={rankingLoading} nodesRef={nodesRef} showVotes />
        </aside>
      </main>
      </div>
    </div>
  );

  if (authLoading) {
    return (
      <div className="min-h-screen bg-event-shell font-sans text-[15px] text-deep">
        <div className="mx-auto w-full max-w-[1040px] px-5 py-[120px] text-center text-ash">
          <p>Carregando sessao...</p>
        </div>
      </div>
    );
  }

  if (page === 'auth') {
    return renderAuth();
  }

  if (page === 'votar') {
    return session ? renderVoting() : renderAuth();
  }

  return (
    <div className="min-h-screen bg-event-shell font-sans text-[15px] text-deep">
      {renderLanding()}
    </div>
  );
}

function RankingList({ items, loading, nodesRef, showVotes = false }) {
  if (loading) {
    return <div className="grid gap-2 text-[0.9rem] leading-[1.45] text-ash">Carregando ranking...</div>;
  }

  if (!items.length) {
    return <div className="grid gap-2 text-[0.9rem] leading-[1.45] text-ash">Sem votos registrados ainda.</div>;
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
            <strong className="mb-1 block text-[0.96rem] text-deep">{item.team_name}</strong>
            <div className="my-1.5 h-[7px] overflow-hidden rounded-full bg-deep/10">
              <span
                className="block h-full bg-bar-fill transition-[width] duration-300 ease-out"
                style={{ width: `${Math.round(item.avg_percent)}%` }}
              />
            </div>
            <div className="flex gap-2 text-[0.76rem] text-ash">
              <span>{Math.round(item.avg_percent)}% medio</span>
              {showVotes && <span>{item.total_votes} votos</span>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
