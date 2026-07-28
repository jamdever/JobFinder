# JobFinder

**Personal job search for Ireland — LinkedIn + Indeed, on your machine.**

Find roles from the boards you already use, review them on a local dashboard, and run Easy Apply through a dedicated browser that keeps your login (and Indeed Cloudflare access) saved.

> Local only. JobFinder drives a real browser for search and apply — it is not meant for cloud hosting.

---

## What you get

| | |
|---|---|
| **Find jobs** | Search LinkedIn and Indeed.ie from your titles, counties, and recency settings |
| **Dashboard** | See collected listings; open Apply in JobFinder’s browser with your saved session |
| **Auto Apply** | Scan Easy Apply on LinkedIn or Indeed, dry-run or submit from the UI |
| **Indeed unlock** | One-time Cloudflare pass, saved for later applies (CapSolver optional) |
| **Applied** | Simple list of roles you’ve marked as applied |

Optional AI (Ollama, OpenAI, or keyword-only) can help score and fill during apply — not required to collect jobs.

---

## Requirements

- **Node.js 20+**
- **Docker Desktop** (MongoDB + Redis)
- **Playwright Chromium** (installed with the project)

---

## Quick start

```powershell
git clone https://github.com/jamdever/JobFinder.git
cd JobFinder

npm install
npm run playwright:install

copy .env.example .env
copy config\profile.example.yaml config\profile.yaml
copy apps\web\.env.local.example apps\web\.env.local

# Put your CV here (used for apply / AI):
#   resumes\resume.pdf

npm run docker:up
npm run dev
```

Then open **[http://localhost:3000](http://localhost:3000)**

| Step | Where | What to do |
|------|--------|------------|
| 1 | **Settings** | Titles, counties (or all Ireland), LinkedIn / Indeed |
| 2 | **Dashboard** | **Find jobs** — wait for the progress bar |
| 3 | **Auto Apply** | Set up LinkedIn or Indeed login once, then scan / apply |

macOS / Linux: use `cp` instead of `copy`, then the same `npm` commands.

---

## Everyday commands

| Command | Purpose |
|---------|---------|
| `npm run docker:up` | Start MongoDB + Redis |
| `npm run docker:down` | Stop them |
| `npm run dev` | API + web + worker |
| `npm run dev:clean` | Free ports 3000/4000, then start |
| `npm run playwright:install` | Install Chromium for search / apply |
| `npm run ollama:check` | Verify Ollama if `AI_PROVIDER=ollama` |
| `npm run build` | Production build |

---

## Configuration

### `.env` (from `.env.example`)

| Variable | Notes |
|----------|--------|
| `MONGODB_URI` / `REDIS_URL` | Defaults work with `npm run docker:up` |
| `AI_PROVIDER` | `ollama` · `local` · `openai` |
| `OPENAI_API_KEY` | Only if using OpenAI |
| `CAPSOLVER_API_KEY` | Optional — auto-solve Indeed Cloudflare |
| `NEXT_PUBLIC_API_URL` | Default `http://localhost:4000` |

### Profile & CV

- `config/profile.yaml` — local copy of `profile.example.yaml` (gitignored)
- `resumes/*.pdf` — your CV (gitignored); point `resume.path` at it in the profile

Search titles and boards are edited in the **Settings** UI and stored in MongoDB.

---

## How it fits together

```
apps/web          Next.js UI (Dashboard, Auto Apply, Settings)
apps/api          Express API, Playwright search, apply automation
packages/shared   Shared types / helpers
config/           Example profile only
resumes/          Your CV (not committed)
data/             Browser profile & runtime files (not committed)
```

JobFinder uses its **own** Chromium profile under `data/` so LinkedIn / Indeed logins stay separate from your everyday browser.

---

## Privacy

These stay on your machine and are **gitignored**:

- `.env` and API keys  
- `config/profile.yaml`  
- anything in `resumes/`  
- `data/` (saved logins, Cloudflare unlock, local DB leftovers)

Do not commit them.

---

## License

[MIT](./LICENSE)
