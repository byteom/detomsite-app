# DETOMSITE Deployment Guide

The repo has **one backend** (FastAPI + Supabase Postgres) and **three independent
portal apps** — each portal is its own Vercel project.

```
detomsite/
├── backend/                  → Vercel project detomsite-backend (root directory: backend)
├── frontend/student/         → Vercel project (root directory: frontend/student)
├── frontend/admin/           → Vercel project (root directory: frontend/admin)
└── frontend/shopkeeper/      → Vercel project (root directory: frontend/shopkeeper) + PWA
```

**Live production URLs**

| Service | URL |
|---------|-----|
| Backend API | `https://detomsite-backend.vercel.app` |
| Student portal | `https://detomsite-student.vercel.app` |
| Admin portal | `https://detomsite-admin.vercel.app` |
| Shopkeeper portal | `https://detomsite-shopkeeper.vercel.app` |

> All four projects are linked to this GitHub repo, so **pushing to `master`
> deploys all four automatically**. The Render / OnRender host that older docs
> mention (`*.onrender.com`) is retired — nothing should point at it.

> The top-level `student/`, `admin/`, `shopkeeper/` folders in the repo are
> **local-only duplicates** and are NOT deployed.

## 1. Backend → Vercel

The backend is a Vercel project named **`detomsite-backend`**:

- Root Directory: `backend`
- `backend/vercel.json` routes every request to `app/main.py` via `@vercel/python`
- Framework preset: Other (the `builds`/`routes` pair in `vercel.json` is the config)

Environment variables (Production; mirror into Preview if you use preview URLs):

```env
USE_SUPABASE_DB=True
USE_LOCAL_DB=False
USE_TURSO_DB=False
SUPABASE_DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
JWT_SECRET=replace-with-long-random-secret
DEBUG=False
FRONTEND_URL=https://detomsite-shopkeeper.vercel.app
BACKEND_URL=https://detomsite-backend.vercel.app
ALLOWED_ORIGINS=https://detomsite-student.vercel.app,https://detomsite-admin.vercel.app,https://detomsite-shopkeeper.vercel.app
DEFAULT_SUPER_ADMIN_EMAIL=12@gmail.com
DEFAULT_SUPER_ADMIN_PASSWORD=8989
SMS_FORWARD_KEY=<android-agent-key>
VAPID_PUBLIC_KEY=<web-push-public>
VAPID_PRIVATE_KEY=<web-push-private>
VAPID_SUBJECT=mailto:you@example.com
DATABASE_NAME=detomsite
```

Verify a deploy with `GET https://detomsite-backend.vercel.app/health` — it returns
`status`, `version`, and the cache status (`postgres`, `redis`).

> **No keep-alive needed.** Vercel does not idle-sleep the way the old Render free
> tier did, so the 15-minute cold-start problem is gone. `backend/scripts/keep_alive.py`
> is kept for portability (its `FALLBACK` points at the live Vercel URL) and is
> harmless to run — it just pings `/health`.

## 2. Portals → Vercel (3 projects)

For **each** portal on [vercel.com](https://vercel.com) (import the same GitHub repo):

| Portal | Root Directory | Vercel env var |
|--------|---------------|----------------|
| Student | `frontend/student` | `VITE_API_URL=https://detomsite-backend.vercel.app/api/v1` |
| Admin | `frontend/admin` | `VITE_API_URL=https://detomsite-backend.vercel.app/api/v1` |
| Shopkeeper | `frontend/shopkeeper` | `VITE_API_URL=https://detomsite-backend.vercel.app/api/v1` |

Set `VITE_API_URL` for **both Production and Preview** targets — `Vite` inlines it at
build time, so a wrong value ships a bundle that talks to the wrong host. After a
deploy, confirm what the live bundle actually contains:

```bash
curl -s https://detomsite-student.vercel.app/ | grep -oE '/assets/index-[^"]+\.js'
# then grep the printed asset for baseURL:"…
```

Framework auto-detects **Vite**; Build `npm run build`; Output `dist`.

### CLI deploys: always run from the repo root

Every project sets a **Root Directory**, so the Vercel CLI must be invoked from the
repository root, not from the portal folder:

```bash
cd /path/to/Detomsite-main     # repo root — NOT frontend/admin
vercel --prod --yes            # uploads the repo; the project's Root Directory applies
```

Running `cd frontend/admin && vercel --prod` fails with
`The specified Root Directory "frontend/admin" does not exist`, because the CLI uploads
only that folder and then looks for `frontend/admin` inside it. The normal path is
simply `git push` — all three portals rebuild from the repo root automatically.

After the frontends are live, make sure the backend's `ALLOWED_ORIGINS` lists the
real Vercel URLs.

## 3. Phone install (vendor app)

Open `https://<shopkeeper>.vercel.app` on the phone → Chrome menu → **Install app**
(Android) or Safari → Share → **Add to Home Screen** (iPhone).

## Notes

- Each portal has `vercel.json` SPA rewrites, so deep links like `/mobile` work.
- Admin login is **derived from the backend's env**, so it is whatever you configured —
  there are no universal defaults:
  - username = `DEFAULT_SUPER_ADMIN_EMAIL` up to the `@`, lowercased
    (`12@gmail.com` → `12`; `yokesksekar@gmail.com` → `yokesksekar`)
  - password = `DEFAULT_SUPER_ADMIN_PASSWORD`
  The account is seeded with `role='admin'` on backend boot (`ensure_admin_user`). It is
  idempotent: if a user with that username already exists it is left untouched, so an
  existing account's password wins over the env value. The env-only fallback path in
  `POST /api/v1/admin/login` is **dev-only** (`DEBUG=True`) — in production the admin
  must exist in the DB with `role='admin'`, otherwise login returns
  `401 Invalid admin username or password`.
- The Supabase schema (`backend/supabase/schema.sql`) is applied automatically at backend
  startup via idempotent migrations — no manual SQL needed.
- **Never point anything at `*.onrender.com`** — that host is retired. The only backend
  URL in use is `https://detomsite-backend.vercel.app`.
- Rotate `JWT_SECRET` if it has ever been committed to the repo: the value signs
  every session, so rotating it signs all users out (they simply log in again).
