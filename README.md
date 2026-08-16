# QuiroFlow

A practice management app for multi-location chiropractic/allied-health
clinics — scheduling, patient records with clinical notes, invoicing, and
a basic client portal.

Built with Nuxt 3 + TypeScript + Tailwind, Supabase (Postgres + Auth +
Storage), and Resend for email.

**Node**: this project needs Node ≥20.19 / ≥22.12 (the installed system
Node was 20.14, which is too old for some deps). A `.nvmrc` pins Node 22;
run `nvm use` before installing/running if you have nvm.

## 1. Install

```bash
nvm use   # if you use nvm
npm install
```

## 2. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. Copy the Project URL and `anon` public key from Project Settings → API.
3. `cp .env.example .env` and fill in `SUPABASE_URL` / `SUPABASE_KEY`.
4. Run the SQL migrations in `supabase/migrations/` (via the Supabase SQL
   editor or the CLI) to create the schema.

## 3. Set up Resend (email)

Get an API key at [resend.com](https://resend.com) and set
`RESEND_API_KEY` in `.env`.

## 4. Run it

```bash
npm run dev
```

Visit http://localhost:3000.

## Status

Early scaffold — see the project plan for the full Phase 1 (MVP) scope:
auth & multi-tenant accounts, dashboard, calendar, patients + clinical
notes, billing/invoicing, core settings, and a basic client portal.
