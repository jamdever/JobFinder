# JobFinder

Hey — I built this for my own job hunt in Ireland, and figured I’d share it.

It’s a **local** app that pulls roles from **LinkedIn** and **Indeed**, drops them on a dashboard, and can run Easy Apply in a dedicated browser that remembers your login (and that annoying Indeed Cloudflare check).

No cloud deploy. No “upload your LinkedIn password to a mystery server.” Just your laptop, Docker, and a browser JobFinder controls.

---

## Why it exists

Job boards are great until you’re opening fifty tabs, re-logging in, and losing track of what you already applied to.

JobFinder is my answer to that:

1. Tell it what you’re looking for  
2. Hit **Find jobs**  
3. Review the list  
4. Auto Apply when you’re ready (dry-run first if you want)

Optional AI (Ollama / OpenAI / keyword-only) can help during apply — but you don’t need it just to search.

---

## What it does

| Feature | In plain English |
|--------|------------------|
| **Find jobs** | Searches LinkedIn + Indeed.ie with your titles, counties, and “how recent?” |
| **Dashboard** | Your collected listings in one place |
| **Auto Apply** | Scan Easy Apply, then dry-run or submit for real |
| **Indeed unlock** | Beat Cloudflare once; JobFinder saves that access |
| **Applied** | A simple “already done” list so you don’t double-apply |

---

## You’ll need

- Node.js **20+**
- **Docker Desktop** (MongoDB + Redis)
- About 10 minutes and a cup of tea

---

## Get it running

```powershell
git clone https://github.com/jamdever/JobFinder.git
cd JobFinder

npm install
npm run playwright:install

copy .env.example .env
copy config\profile.example.yaml config\profile.yaml
copy apps\web\.env.local.example apps\web\.env.local

# Drop your CV in here (gitignored — it stays private):
#   resumes\resume.pdf

npm run docker:up
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** and you’re in.

**First loop**

1. **Settings** — titles, counties (or all Ireland), LinkedIn / Indeed  
2. **Dashboard → Find jobs** — watch the progress bar do its thing  
3. **Auto Apply** — log in once in JobFinder’s browser, then scan / apply  

On Mac/Linux, use `cp` instead of `copy`. Same npm commands after that.

---

## Handy commands

| Command | What it does |
|---------|----------------|
| `npm run docker:up` | Wake up Mongo + Redis |
| `npm run docker:down` | Put them back to sleep |
| `npm run dev` | API + web + worker — the daily driver |
| `npm run dev:clean` | Ports stuck? This frees 3000/4000 and starts fresh |
| `npm run playwright:install` | Install Chromium for search / apply |
| `npm run ollama:check` | “Is Ollama actually running?” |
| `npm run build` | Production build |

---

## Tweaking things

Copy `.env.example` → `.env`. Defaults are fine for local Docker.

| Setting | Notes |
|---------|--------|
| `AI_PROVIDER` | `ollama` · `local` · `openai` |
| `OPENAI_API_KEY` | Only if you’re on OpenAI |
| `CAPSOLVER_API_KEY` | Optional — auto-solves Indeed Cloudflare |
| `MONGODB_URI` / `REDIS_URL` | Leave as-is with `docker:up` |

Titles and boards live in the **Settings** UI (MongoDB). Your CV goes in `resumes/` and stays gitignored.

---

## Under the hood

```
apps/web          Next.js UI
apps/api          Express + Playwright (search & apply)
packages/shared   Shared types
config/           Example profile (copy locally)
resumes/          Your CV — never committed
data/             Browser profile & session stuff — never committed
```

JobFinder uses its **own** Chromium profile, so your normal Chrome/Edge stays out of it.

---

## Privacy (please don’t doxx yourself)

These are gitignored on purpose:

- `.env` and keys  
- `config/profile.yaml`  
- everything in `resumes/`  
- `data/` (logins, Cloudflare unlock, local junk)

If it’s personal, it doesn’t belong in a commit. Future you will thank present you.

---

## License

[MIT](./LICENSE) — use it, fork it, improve it, land the job.

Built by [jamdever](https://github.com/jamdever) for hunting roles in Ireland without losing my mind.
