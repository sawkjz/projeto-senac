# projeto-senac

Sistema de votacao ao vivo para apresentacoes de equipes (Gastronomia e ADS), com ranking em tempo real.

## Estrutura

1. `client` - Frontend React (Vite)
2. `server` - API Node/Express conectada ao Supabase

## Supabase

Execute o SQL em `server/sql/schema.sql` no seu projeto Supabase. Ele cria:

- `profiles`, `courses`, `teams`, `criteria`, `votes`, `vote_scores`
- Funcoes `submit_vote` e `get_ranking`
- Policies basicas de RLS
- Seeds de cursos, equipes e criterios

## Configuracao

1. Copie `server/.env.example` para `server/.env` e preencha `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
2. Copie `client/.env.example` para `client/.env` e ajuste `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Rodando localmente

```bash
cd server
npm install
npm run dev
```

```bash
cd client
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3001`
