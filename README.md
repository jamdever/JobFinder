# JobFinder

Local job search for Ireland. Collects listings from LinkedIn and Indeed, shows them on a dashboard, and supports Easy Apply automation in a dedicated browser profile.

Runs on your machine only. Browser scraping is not designed for cloud hosting.

## Features

| Feature | Description |
|---------|-------------|
| **Find jobs** | Search LinkedIn and Indeed.ie using your titles, counties, and posting age |
| **Dashboard** | Review collected listings and open apply flows in JobFinder’s browser |
| **Auto Apply** | Scan Easy Apply on LinkedIn or Indeed; dry-run or submit from the UI |
| **Indeed unlock** | Complete Cloudflare once; access is saved for later applies |
| **Applied** | Track jobs you have already applied to |

Optional AI (Ollama, OpenAI, or keyword-only) can assist during apply. It is not required for collecting jobs.

## Requirements

- Node.js 20+
- Docker Desktop (MongoDB and Redis)
- Playwright Chromium (`npm run playwright:install`)

## Quick start

```powershell
git clone https://github.com/jamdever/JobFinder.git
cd JobFinder

npm install
npm run playwright:install

copy .env.example .env
copy config\profile.example.yaml config\profile.yaml
copy apps\web\.env.local.example apps\web\.env.local

# Place your CV at resumes\resume.pdf (gitignored)

npm run docker:up
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. **Settings** — set titles, counties (or all Ireland), and boards  
2. **Dashboard → Find jobs** — collect listings  
3. **Auto Apply** — sign in once in JobFinder’s browser, then scan or apply  

On macOS or Linux, use `cp` instead of `copy`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run docker:up` | Start MongoDB and Redis |
| `npm run docker:down` | Stop MongoDB and Redis |
| `npm run dev` | Start API, web, and worker |
| `npm run dev:clean` | Free ports 3000/4000, then start |
| `npm run playwright:install` | Install Chromium |
| `npm run ollama:check` | Check Ollama when `AI_PROVIDER=ollama` |
| `npm run build` | Production build |

## Configuration

Copy `.env.example` to `.env`. Defaults work with local Docker.

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` / `REDIS_URL` | Database and queue URLs |
| `AI_PROVIDER` | `ollama`, `local`, or `openai` |
| `OPENAI_API_KEY` | Required only for OpenAI |
| `CAPSOLVER_API_KEY` | Optional Cloudflare solver for Indeed |
| `NEXT_PUBLIC_API_URL` | Default `http://localhost:4000` |

- `config/profile.yaml` — local profile (from `profile.example.yaml`, gitignored)  
- `resumes/` — CV PDFs (gitignored)  
- Search criteria are edited in Settings and stored in MongoDB  

## Project layout

```
apps/web          Next.js UI
apps/api          Express API, Playwright search, apply automation
packages/shared   Shared types and helpers
config/           Example profile
resumes/          Local CV files (not committed)
data/             Browser profile and runtime data (not committed)
```

JobFinder uses its own Chromium profile under `data/`, separate from your everyday browser.

## Privacy

The following are gitignored and should not be committed:

- `.env` and API keys  
- `config/profile.yaml`  
- files under `resumes/`  
- `data/` (logins, Cloudflare unlock, local data)  

## License

[MIT](./LICENSE)
