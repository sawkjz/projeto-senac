# projeto-senac

Sistema de votacao ao vivo para apresentacoes de equipes de Gastronomia, com ranking em tempo real.

## Estrutura

1. `src` - Frontend React (Vite)
2. `api` - API Node/Express para deploy unico na Vercel
3. `sql` - Schema, seeds e migrations do Supabase

## Supabase

Execute o SQL em `sql/schema.sql` no seu projeto Supabase. Ele cria:

- `app_users`, `auth_sessions`, `courses`, `teams`, `criteria`, `votes`, `vote_scores`
- Funcoes `submit_vote` e `get_ranking`
- Policies basicas de RLS
- Seeds de cursos, equipes e criterios

## Configuracao

1. Configure um `.env` na raiz com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
2. Em producao na Vercel, use `VITE_API_BASE_URL=/api`.

## Rodando localmente

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3001`
