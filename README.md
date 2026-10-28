# Boldt Marketing Dashboard

Password-protected healthcare marketing dashboard and shared project calendar for Boldt Real Estate.

- `public/index.html`: dashboard (executive summary first). Loads `public/data/index.json`, then the newest `public/data/YYYY-MM.json`.
- `public/tracker.html`: the Marketing Project Tracker. Edits save to the Google Sheet "Marketing Project Tracker (live)" through `/api/tracker`.
- `netlify/edge-functions/gate.ts`: shared-password sign-in for the whole site. Env vars: `SITE_PASSWORD`, `COOKIE_SECRET`.
- `netlify/functions/api.mts`: server bridge to the Apps Script web app. Env vars: `SCRIPT_URL`, `SCRIPT_TOKEN`.
- `apps-script/Code.gs`: paste into the tracker Sheet's Apps Script and deploy as a web app.
- `RUNBOOK.md`: what the monthly report run does on the 1st of each month.

To change the password, edit `SITE_PASSWORD` in Netlify (Project configuration > Environment variables) and redeploy.
