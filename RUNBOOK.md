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
- `paid.googleAdGroups`: Windsor `google_ads` fields campaign, ad_group_name, month, clicks, impressions, spend, April 2026 through month `m`. One row per campaign, ad group and month: `{campaign, adGroup, month, clicks, impr, spend, shared}` (month 1 to 12, spend to 2 decimals). Leave out senior living, DemandGen and YouTube campaigns. Brand and National General rows get `shared: true`; the dashboard counts them at half. Healthcare spend by month must match `paid.google.HC.spend` and shared must match `paid.google.SH.spend` within $1.
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
- `accounts`: use the whole month. Set `window` (for example "November 1 to 30, 2026"), `knownVisitsDaily` (Factors saved report "HubSpot Company Website Visits", one row per day) and `knownVisitsMonth` (its month total, which should match `knownCompanies`). From "Linkedin Ad Viewed > Website Session" for the month (saves to a file), keep healthcare campaign rows only and drop senior living pages: `liHalo.HC` = companies reached and companies that visited, `liVisitors` = the visitors with HubSpot name, first visit date and landing page. `overlap` comes from "Linkedin Ad Viewed > Paid Search/Google Ads" and "Paid Search/Google Ads > Linkedin Ad Viewed", filtered to industry Health Care Providers & Services and excluding senior living names. Also set `liHalo.HC` (companies reached by healthcare LinkedIn ads and how many visited), `liVisitors` (healthcare only), and `overlap` (LinkedIn → paid search and paid search → LinkedIn).
- `accounts.allSources` (all-source view of healthcare companies on the site): Factors saved report "Account Details + Website Metrics" in 2-day windows across the month (a 7-day pull is too large for the connector; each 2-day pull saves to a file). Keep the last result group (no date column: company, domain, industry, channel, landing page, time on site; each row is one session) in `details/<from>_<to>.json`, then run `scripts/build_accounts_all_sources.py`. Healthcare = industry "Health Care Providers & Services" or a healthcare company in HubSpot; drop senior living names, pages and campaigns. Ignore the report's date column: it is in a different time zone and repeats rows.
- `jobTitles.HC`: LinkedIn impressions by job title for healthcare campaigns, grouped into seniority levels, functions and top titles.
- `landingYtd` and `blogYtd`: GA4 (Windsor `googleanalytics4`) year to date. Drop any senior living pages or posts.
- `blogBySource` (Website page, "Top blog posts by source"): GA4 `page_path`, `session_source_medium`, `screen_page_views`, January 1 to the end of month `m`, filter `page_path` contains `blog`. Group sources into LinkedIn ads (linkedin / paid*), Google Ads (google / cpc), Organic search (* / organic), Direct, AI assistants (chatgpt, claude, gemini, perplexity, notebooklm), LinkedIn organic, Email, Other. Drop senior living posts and the blog home page. Keep `{sources, ytd: {window, posts (top 10: title, path, total, by), totals, allViews, postCount}}`; copy the title map in the previous file. Year to date only; single-month GA4 blog counts are too small to show.

### SQL company customer journey (`sqlJourneys`), shown on the Leads & accounts page
- SQL companies = HubSpot companies whose `hs_v2_date_entered_salesqualifiedlead` falls in the current year (search COMPANY with that property ≥ Jan 1). Healthcare only. Note in the data health doc if the count differs from the Inputs tab SQL total.
- LinkedIn: Windsor `linkedin` with fields `member_company_name, impressions, clicks`, one call per month from 2024-11 (first healthcare campaigns) through month `m`, filtered to the SQL company names (contains/eq, OR'd) AND `campaign` ncontains "Senior" and "senior". Save each month's rows to `li_company_monthly.json` keyed `YYYY-MM`. Add new SQL companies' LinkedIn names to the filter (check spelling in a one-month pull without the company filter).
- Factors: run `mql_journey_agent_(dashboard)_lQKvZ` on each SQL company domain (max 9 at a time) for recent activity; save to `factors_sql.json`.
- Build with `scripts/build_sql_journeys.py` (update its SQL list). Sales email and meeting rows show only "Sales email sent" / "Meeting on the calendar", never subject lines or names.
- Full journey (added Nov 2026): after the LinkedIn step, run the Factors agent on all SQL domains (it now returns `page_visits`, `email_clicks` and `sales_touches` with 1:1 emails, calls and meetings, never names or subject lines) and save to `factors_v3.json`; save HubSpot company `hs_last_logged_call_date`, `hs_last_booked_meeting_date`, `num_contacted_notes` and any lead gen form conversion to `hs_sql_props.json`. `build_sql_journeys.py` adds Google and Bing ad visits, website visits by week, and email clicks from the definition MQL data, then builds `journey` (by month) and `touchesBefore`. The HubSpot connection cannot read call, meeting or 1:1 email records, so before Factors' 180 days only the most recent call and meeting dates show.

### MQLs by our engagement definition (`defMql`), shown on the Leads & accounts page and as a tile on the Executive summary
- Definition: a healthcare company in HubSpot (by root domain; senior living and Boldt's own domains excluded) with a website visit, a LinkedIn, Google or Bing ad click, or an email click (marketing or 1:1) in the 12 months through month `m`. "New" = engaged in month `m` with no engagement in the 12 months before. YTD new = each company counted once, in the first month of the year it was new.
- Inputs, saved next to `scripts/build_definition_mqls.py`: `visits.json` (Factors "Accounts Active On Website" saved report, pulled in 7-day chunks; data starts Mar 16, 2026), `li_clicks.json` (Windsor `linkedin` `member_company_name, clicks`, one call per month, `clicks gt 0`, campaign ncontains "Senior"/"senior"), `hs_companies.json` (HubSpot companies: name, domain, industry), `email_clicks.json` (contacts' `hs_email_first_click_date` / `hs_email_last_click_date`), `sales_email_clicks.json` (contacts' `hs_sales_email_last_clicked`; HubSpot keeps only the latest 1:1 click).
- Google and Bing ad visits: Factors saved reports "Google Ads / Paid Search Website Session" (7-day pulls; each saves to a file) and "Bing Ads Website Sessions" (monthly pulls), compacted with `scripts/compact_paid_search.py` into `paid/google_*.json` and `paid/bing_*.json`. Drop senior living campaigns and senior living search terms (the shared National General campaign matches some). Google rows that match a Bing visit on the same day count as Bing.
- Leadership labels: New MQLs (month), New MQLs (year), Total Engaged Companies (month), Total Engaged Companies (year).
- 1:1 email clicks: the Factors agent returns each 1:1 email's subject; the builders show the template Boldt sent most recently (within 14 days) before the click. Only subjects in the template list in `build_definition_mqls.py` or sent to two or more companies are shown; one-off subjects can carry people's names.
- Follow-up task button: `netlify/functions/hs-task.mts` creates a HubSpot task on the company. It needs the `HUBSPOT_TOKEN` environment variable in Netlify (a HubSpot service key, marked secret, with owners read, companies read and tasks write). The Notes box is prefilled with what the company engaged with that month and the LinkedIn campaigns it saw. Without it the button says task creation isn't turned on. Keep the parent and child domain note on the page until Factors resolves it.
- Company list: run the Factors agent on each new company's domain (max 9 at a time, collect within 10 minutes) and save results to `factors_new.json`. For companies with LinkedIn clicks but no Factors detail, pull Windsor `member_company_name, clicks` for the month filtered by campaign and save to `li_oct_by_campaign.json` (rename per month). Then run `build_definition_mqls.py` and `merge_defmql.py` (update the month and file paths). LinkedIn clicks show at campaign level with the campaign's active ads (LinkedIn does not report clicks by company for single ads); Google ad IDs map to headlines through `ads-archive.json`. Impressions are listed by campaign only.

### Trends and first outreach (`trends`, `sqlJourneys.summary.outreach`)
- Day of week: dated Google and Bing ad visits and email clicks by healthcare companies in HubSpot, January through month `m` (one per company per day per channel), plus `accounts.knownVisitsDaily` averaged by weekday. LinkedIn clicks (monthly) and website visits (weekly) can't be placed on a day.
- Locations: HubSpot company `state` for every company in Total Engaged Companies (year), saved to `hs_state.json` (search COMPANY with `hs_object_id` IN batches of 100, property `state`). Normalize abbreviations to state names and group into Census regions.
- First outreach to SQL: for each SQL company, search its contacts with `hs_sa_first_engagement_object_type` IN EMAIL, CALL, sorted by `hs_sa_first_engagement_date` ascending, limit 1. Update the `FO` table in `scripts/build_trends.py`, then run it and `scripts/merge_trends.py`. Report the median in months.
- Day of week, all sources (heat table): Windsor `linkedin` `date, clicks` (campaign ncontains Senior/senior, clicks gt 0), `google_ads` `day_of_week, clicks` (same campaign filter) and `googleanalytics4` `day_of_week_name, sessions` (landing_page ncontains senior), January 1 through the end of month `m`; save to `dow_sources.json`. Bing visits and email clicks come from the definition MQL data, HubSpot companies on the site from `knownVisitsDaily`. Show each source's share by weekday. Do not use Factors LinkedIn dates for weekdays: Factors loads LinkedIn company data every two to four days, so its dates bunch up on load days.
- New MQLs by source, month by month (`defMql.newBySource`): for each month, the new companies and which sources they engaged through that month.
- Hot MQLs (`defMql.hot`): healthcare HubSpot companies with 5 or more engagements (website sessions + LinkedIn ad clicks + email clicks) in the 12 months through month `m`, or a contact page visit. Contact page visits come from the "Account Details + Website Metrics" landing pages and the Factors agent's page visits, which only cover part of the year; a Factors saved report of contact page views by company would cover all of it.
- Lifecycle stage column (New MQL companies): save each company's HubSpot `lifecyclestage` to `hs_lifecycle.json` (search COMPANY with `hs_object_id` IN, property `lifecyclestage`). On the page, `netlify/functions/hs-company.mts` reads the live stage and saves changes back to HubSpot with the same `HUBSPOT_TOKEN`; saving needs the key's companies write permission (crm.objects.companies.write). A backward move is cleared first, then set, and the old stage is restored if the save fails.
- Hot MQLs carry `months` (website sessions, LinkedIn clicks, email clicks, Google or Bing visits per month for the 12 months) for the month strip on each row.
- The Dashboard tab was merged into the Executive summary in November 2026 (old #summary links open the Executive summary). The "How they engaged" and "Where they are" panels were removed; their data stays in the file.
- Leads & accounts layout: top charts are New MQLs by month (definition) and New SQLs by month; the MQL to SQL rate sits with the SQL journey tiles. The all-source company list and the LinkedIn visitor list were removed in November 2026 (data stays in the file for the Ask assistant).

### MQL company journeys (Factors agent + HubSpot), kept in the data file for the Ask assistant (no longer shown on the page)
- For each company behind this month's MQLs (HubSpot Lead records entering New in month `m`; use `hs_primary_company_id` and the company `domain`, without `www.`), run the Factors agent `mql_journey_agent_(dashboard)_lQKvZ` with `run_agent_async`, then poll `get_agent_run`. Results expire after 10 minutes, so start no more than 9 at a time and collect them before starting more. Save each JSON result to a file.
- From HubSpot, get each company's contacts (job title, `hs_email_last_open_date`, `hs_email_last_click_date`, `hs_sales_email_last_clicked`) and the lead's label (Hot or Warm).
- Build `mqlJourneys` = `{month, summary, companies}` with `scripts/build_mql_journeys.py` (edit its inputs). Rules: ad and website touches cover the 6 months before each MQL date (Factors' limit); email covers 12 months. "Actively engaged" = clicked an ad, visited from an ad or clicked an email. Show LinkedIn ad views only as "saw LinkedIn ads" because Factors counts them inconsistently. Drop any senior living touch, page or campaign. Never include people's names or email addresses.

### Ads archive (tracker's Ads archive tab)
- Rebuild `public/data/ads-archive.json` with `scripts/build_ads_archive.py` from two Windsor pulls for January 1 through today: `linkedin` (campaign_group_name, campaign, creative_id, share_title, creative_status, landing_page, creative_thumbnail, impressions, clicks) and `google_ads` (campaign, ad_group_name, ad_id, ad_group_ad_status, campaign_status, ad_strength, ad_responsive_search_ad_headlines, ad_responsive_search_ad_descriptions, ad_final_urls, impressions, clicks). Leave out senior living, DemandGen and YouTube. Set `updated` to today. LinkedIn thumbnail links expire about a week after the pull; that's expected.

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
- `recs`: 4 to 6 recommendations for next month, `{pri: High|Medium|Low, title, detail, owner}`, shown on the Recommendations page. Tie each one to a number from this month. No setup or data-fix tasks.
- `qbr` (Quarterly review and Recommendations pages). The Quarterly review page computes its scorecard from the monthly arrays; `qbr` holds only the words. When `m` is 3, 6, 9 or 12, write a new one for that quarter against the quarter before: `{quarter: "YYYY-Qn", headline, takeaway, recs: [3 × {type: quick|strategic, title, why, action}], expansion: [up to 4 × {type, when, title, why, action}], note}`. Compute every figure the way the page does (sessions = sum of `factorsWeb` sources; Google includes half of shared campaigns; marketing spend = `budget.hcSpend`) and recheck in Python. In other months copy `qbr` from the base file unchanged. Never include net-new ICP accounts, sales outreach, deal influence, engagement levels or vendor product updates. Don't repeat a `qbr` item in `recs`.
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
