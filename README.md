# S2M Health × Aspire — Behaviour & Performance Impact Survey

A self-hosted, multilingual (English / தமிழ் / हिन्दी) 13-section survey. Static React
front end on Vercel, responses written straight to Supabase.

This started as a Fillout/Zite export. All Zite runtime coupling has been removed —
nothing calls `zite.com` or `fillout.com` at build or at run time.

## Layout

```
vercel.json            Deploy config when Vercel's Root Directory is the repo root
package.json           Root build wrapper (installs + builds apps/)
apps/
  vercel.json          Deploy config when Vercel's Root Directory is `apps`
  vite.config.ts       Vite config; validates required env vars at build time
  tailwind.config.js
  tsconfig.app.json
  supabase/schema.sql  Table + row level security policy
  .env.example
  Aspire-Survey/
    index.html
    public/favicon.svg
    src/
      App.tsx          Step machine + submit handler
      api/submitSurvey.ts  Maps answers to columns, POSTs to Supabase REST
      components/      Survey inputs, per-section Steps, vendored ui/ primitives
      i18n/            Language context + translations
      data/SurveyData.ts
```

## Local development

```bash
cp apps/.env.example apps/.env.local   # then fill in the two values
npm --prefix apps install
npm --prefix apps run dev              # http://localhost:8080
```

Production build and preview:

```bash
npm --prefix apps run build
npm --prefix apps run preview
```

## Environment variables

Both are read at **build time** and baked into the bundle, so changing them requires
a redeploy. The build fails fast if either is missing.

| Name | Notes |
| --- | --- |
| `VITE_SUPABASE_URL` | e.g. `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Publishable anon key. Safe in the browser — writes are gated by RLS. |

On Vercel these live under **Settings → Environment Variables** (set them for
Production, Preview and Development).

## Database

Apply `apps/supabase/schema.sql` in the Supabase SQL editor. It creates
`public.survey_responses`, enables row level security, and adds a single policy
allowing `anon` to INSERT.

Deliberately, there is **no** SELECT policy for `anon`, so submitted responses cannot
be read back from the browser. Because of that the client sends
`Prefer: return=minimal` — `return=representation` would need SELECT permission and
makes every insert fail with `42501`.

`employee_id` is `unique`, so a second submission returns HTTP 409 and the user sees
"a response has already been submitted for this Employee ID".

Read responses via the Supabase dashboard, or with the service role key from a
trusted server — never from this front end.

## Deploying

Vercel builds on push to `main`. Either Root Directory setting works:

- Root Directory = repo root → uses `vercel.json`, output `apps/Aspire-Survey/dist`
- Root Directory = `apps` → uses `apps/vercel.json`, output `Aspire-Survey/dist`

## Gotchas

Vercel builds on Linux, which is case-sensitive; Windows is not. An import whose
casing does not match the file will build locally and fail on Vercel.
`forceConsistentCasingInFileNames` is on in `tsconfig.app.json` so `npm run build`
catches this on Windows too.
