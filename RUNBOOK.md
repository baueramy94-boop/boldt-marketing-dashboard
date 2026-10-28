# Boldt Marketing Dashboard: Monthly Report Runbook

Owner: Amy Copeland. Run by the AI Analytics & Reporting Lead on the 1st of every month (6:13 AM Central) for the month that just ended. Healthcare only: senior living is excluded everywhere.

## What the run produces

1. **A new monthly data file**, `public/data/YYYY-MM.json` for the month just ended, committed to the dashboard's GitHub repository (named in the scheduled task). `public/data/index.json` lists every month, newest first. Pushing to the repository redeploys the password-protected site (boldt-marketing-dashboard.netlify.app), which opens on the newest month and keeps older months in its month picker.
2. **The claude.ai preview** (artifact `https://claude.ai/artifact/VV6znZqXm4SEVq9AwXDYJa`) republished with the same data as `data.json`, so Amy can check it in Claude.
3. **A data health note for Amy only**: a Google Doc named `Data health YYYY-MM` in the Marketing Analytics folder (ID `1qIzkbIZPje2m6fqy2L7SGQYP9b6JfYGe`), plus a short summary in the run's final message.
4. **Nothing else changes.** Do not edit the budget Sheet, the tracker Sheet, the site code or Netlify settings.

## Golden rules for the report

- The dashboard and executive summary go to Heidi and leadership. **Never mention setup or data-quality problems in them**: tracking breaks, GA4 undercounting, conversion actions counting page views, late lead entry, missing inputs, connector errors, reconciliations. Those go only in the data health note.
- If a number can't be trusted, leave it out of the report and explain why in the data health note. Never print a number you know is wrong.
- No em dashes. No AI-pattern phrasing ("delve", "leverage", "it's worth noting", "in today's landscape", "not only... but also", rhetorical questions, three-adjective lists). Write plainly, like a marketing manager writing to her VP.
- Every claim in the text must match a number in the data file. Recompute; don't copy last month's sentences.
- Report healthcare only. Leave senior living campaigns, budget lines, search terms, pages and ads out entirely.

## Step 1. Load the base file

- Attach the GitHub repository with push access, clone it, and read the newest month listed in `public/data/index.json`.
- If the repository isn't available, use the Artifact tool's `read` action on `https://claude.ai/artifact/VV6znZqXm4SEVq9AwXDYJa` with `path` `data.json`; it saves the file locally. Parse it with Python; don't read it into the conversation.
- Copy it to `base.json`. Every array indexed by month uses index 0 = January. Let `m` = month just ended (1 to 12), `i = m - 1`.

## Step 2. Pull the month's data

Use the connectors listed here. If a source fails, keep last month's values for that section, set nothing to zero, and record the failure in the data health note.

### Paid media (Windsor.ai)
- Connectors: `linkedin` (LinkedIn Ads) and `google_ads`. Pull by month for January through month `m` (refreshing the prior month catches late adjustments): campaign group, campaign name, impressions, clicks, spend, conversions.
- Division rules:
  - LinkedIn: campaign group or campaign name contains "senior" → senior living, exclude. Everything else → healthcare (`HC`).
  - Google: name contains "senior", "demandgen", "demand gen" or "youtube" → senior living, exclude. "Brand" or "National General" → shared (`SH`), counted 50% to healthcare. Everything else → `HC`.
- Update `paid.linkedin.HC.{impr,clicks,spend,conv}[i]`, `paid.google.HC[...]`, `paid.google.SH[...]`.
- Replace `campaigns` rows for months `m-1` and `m` (objects: platform, month, div, name, impr, clicks, spend). Keep other months.
- `searchTerms`: Google search terms for the last two months, healthcare and shared campaigns only, terms with 3 or more clicks (term, campaign, impr, clicks, spend, window, div). Set `searchTermsWindow`, for example "Oct 1 to Nov 30".

### Ads and creative (Windsor `linkedin`, creative level)
- `creatives`: every healthcare ad active in the last three months with 1,000+ impressions: id, div "HC", headline (share title), thumb (image URL if available), status, impr, clicks, spend, conv, format (Single image, Document, Video).
- `creativeAnalysis`: rerun the full-year analysis on all healthcare ads January through `m`. Method (also saved in memory at `/areas/boldt-ad-creative-playbook.md`):
  1. Tag each headline: theme, headline form (point-of-view statement, command, question), names Boldt (yes/no), length (6 words or fewer vs 7+), speaks to "you" (yes/no), includes a number. Format comes from the campaign.
  2. For each tag value: CTR = total clicks ÷ total impressions (weighted, not averaged), CPC, conversions, cost per conversion, number of ads.
  3. Compare copy tags within single-image ads only (`HC_image`); `HC` holds all formats (the Format table).
  4. Mark anything under 10,000 impressions or fewer than 2 ads as directional.
  5. `fatigue`: ads running 5+ months, monthly CTR series (`{div,title,months,start,end,ctrFirst,ctrLast,series:[{m,ctr,impr}]}`).
  6. Set `through` (for example "November 30"), `ads` (count of healthcare ads) and `adMonths`.
- Update `text.bestPractices` (8 items, `[title, detail]`) and `text.fatigueNote` from the new results. Keep the practices that still hold and change the numbers; replace any the data no longer supports.

### Leads (HubSpot)
- MQLs = HubSpot **Lead** records whose `hs_v2_date_entered_new_stage_id_1318266061` falls in month `m` (count with `search_crm_objects` totals). Set `leads.mql[i]`.
- `mqlMonth`: the companies behind those leads (name, date entered as "Mon D", `engaged` true if Factors shows the company saw healthcare LinkedIn ads before visiting).
- SQLs come from the budget Sheet `Inputs` tab (`19SXdl16vuH4QP9wFv7X8kaXk1MfuV9VW67YUEqZOHD0`), row 3, columns C (Jan) through N (Dec). Set `leads.sql[i]` only if the cell has a number; otherwise leave `null` and note it in the data health note.
- Do not use HubSpot deals, Factors net-new ICP accounts, Factors engagement levels (hot, warm, cool, ice) or Factors deal influence.

### Website and accounts (Factors.ai)
- `factorsWeb`: saved report "Healthcare Website Sessions by Source". Append the month label to `months` and the session counts to each source (Google Ads, LinkedIn, Bing, Direct and other). `knownCompanies[<Mon>]` = HubSpot companies with a session that month.
- `accounts`: use the last full week of the month. Set `window` (for example "Nov 24 to 30, 2026"), `knownVisitsDaily`, `knownVisitsWeek`, `liHalo.HC` (companies reached by healthcare LinkedIn ads and how many visited), `liVisitors` (healthcare only), and `overlap` (LinkedIn → paid search and paid search → LinkedIn).
- `jobTitles.HC`: LinkedIn impressions by job title for healthcare campaigns, grouped into seniority levels, functions and top titles.
- `landingYtd` and `blogYtd`: GA4 (Windsor `googleanalytics4`) year to date. Drop any senior living pages or posts.

### Budget (Google Sheet `19SXdl16vuH4QP9wFv7X8kaXk1MfuV9VW67YUEqZOHD0`)
- Tab `2026 Actual Marketing Budget`: line names in column A. Month `m` Actual is column B + 4×(m−1), Budget is the next column (October = AL/AM, November = AP/AQ, December = AT/AU).
- For every object in `budget.lines`, match on `line` and set `actual[i]` (and refresh `budget` if it changed). Don't add senior living lines.
- `budget.hcSpend[i]` = sum of `actual[i]` for lines where `hcTab` is true. `budget.hcAdSpend[i]` = "Google - (50% healthcare)" + "LinkedIn - Healthcare".

### Project calendar (Google Sheet "Marketing Project Tracker (live)", `1AZz9DbfXMM87n29O37nv3jLlgWalGcAVhv6YD49VzNI`)
- Read tab `Items` (owners are "; "-separated, subtasks are JSON).
- `projects`: items Complete with `completedAt` in month `m` (or no `completedAt` and `due` in month `m`), plus items In progress or In review. Objects: project, cat (workstream), owner, status.
- `upcoming`: items not Complete, not recurring, with `due` in month `m+1`. Objects: project, cat, owner, due, prec, status.
- If the Items tab is empty, fall back to the seed data inside "Marketing Project Tracker 2026-10-15.html" in Drive.

## Step 3. Set the report fields

- `report = {"month": "YYYY-MM", "complete": true, "through": "<Mon> <last day>"}`
- `currentMonth = m`, `asOf` = today (YYYY-MM-DD), `asOfLabel` = for example "Dec 1, 2026, 6:15 AM CT".

## Step 4. Write the words

Write these from the new numbers. Keep each item to one or two sentences with the specific figures.

- `text.summaryFlags`: 2 to 4 `[severity, title, detail]` items (severity `bad`, `warn` or `info`). Business issues only.
- `text.summaryWins`: 3 or 4 `[title, detail]` items.
- `text.narrative.<page>` for paid, creative, website, leads, accounts, roi, budget: `{"well": [[title, detail]], "improve": [[title, detail, optional severity]]}`. Two or three of each.
- `text.searchTermsNote`, `text.budgetNote`: one sentence each, or an empty string.
- `recs`: 4 to 6 recommendations for next month, `{pri: High|Medium|Low, title, detail, owner}`. Tie each one to a number from this month. No setup or data-fix tasks.
- `exec` (the executive summary leadership reads first):
  - `prepared`: "Final report for [Month] 2026." (for example "Final report for November 2026.")
  - `headline`: two sentences on the month's story.
  - `sections`: Results (paragraph), What went well (3 or 4 bullets), Where we are focused (2 or 3 bullets), Budget (paragraph).
  - `nextMonth`: 3 to 5 priorities that match `recs`.
  - Compare with last month and the same month last year wherever the data allows.

## Step 5. Check before saving

Run these in Python and fix anything that fails:
- Every month-indexed array has a value at index `i`, and nothing after `i` except the budget arrays.
- `leads.mql[i]` equals the HubSpot total. Spend totals match Windsor within $1.
- Each percentage in the text recomputes from the data within 0.5 points.
- Search the text for "senior", "GA4", "tracking", "conversion action", "Inputs tab", "connector", "—" (em dash): none may appear.
- The JSON parses, with keys matching the base file.

## Step 6. Save and report

- Write `public/data/YYYY-MM.json` (minified) and put the month first in `public/data/index.json`. Commit with the message "Report data for <Month> YYYY" and push to the default branch. Netlify deploys it automatically.
- Republish the preview: Artifact `read` `index.html` from the artifact URL above, then publish it with that `url`, `file_path` set to the downloaded index.html and `files` `{"data.json": "<path to the new month file>"}`.
- If the push fails, still republish the preview and say so at the top of the data health note.
- Create the data health note `Data health YYYY-MM` (Google Doc, Marketing Analytics folder). List:
  - every source that failed or looked wrong, and what you did instead
  - missing inputs: SQLs, awarded projects, subscribers
  - known tracking problems (GA4 sessions vs Factors, Google Ads conversions per click)
  - budget lines over 110% of budget
  - anything in the tracker marked "Confirm status"
- Final message for Amy, 6 lines max: the month's MQLs, SQLs and spend vs budget, the data file name, and the top data health items.
