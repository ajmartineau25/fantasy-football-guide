# 2026 Fantasy Football Guide

Multi-factor fantasy football draft dashboard with **0.5 PPR** / **1 PPR**, natural-unit factor metrics, **Sleeper & ESPN** live draft, and a full **How It Works** methodology page.

## Live use (no local server)

Host as a **static site** on Vercel (recommended):

1. Import this GitHub repo at [vercel.com/new](https://vercel.com/new)
2. Framework preset: **Other** (static)
3. Deploy — open the production URL anytime

Or GitHub Pages: Settings → Pages → Deploy from branch `main` / root.

**Sleeper** works fully from the hosted site (public API).
**ESPN** works best for public leagues; private leagues may need cookies.

## Local preview

```bash
python -m http.server 8765
```

Open http://localhost:8765

## Updates workflow

1. Edit code/data (or ask Grok)
2. Optional: `python scripts/generate_data.py`
3. Commit + push to GitHub
4. Vercel auto-deploys production

## Docs

Open **How It Works** in the app (`/how-it-works`) for every factor, model math, and draft connections.
