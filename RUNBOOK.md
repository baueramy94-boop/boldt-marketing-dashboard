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

### Ad performance (`adPerf`) and archive captions
- Windsor `linkedin` `creative_id, campaign, year_month, impressions, clicks, spend, conversions` and `creative_id, sponsored_creative_content_title, sponsored_creative_content_commentary, sponsored_creative_content_description, impressions`; Windsor `google_ads` `ad_id, campaign, ad_group_name, year_month, impressions, clicks, cost`. January through month `m`, campaign ncontains Senior/senior, impressions gt 0. Save to `li_ad_monthly.json`, `li_ad_text.json`, `google_ad_monthly.json` and run `scripts/build_ad_perf.py` after the ads archive is refreshed (it adds LinkedIn captions to `ads-archive.json`). The Ads & Creative page lets readers switch between the report month, the last 3 months and year to date, and between LinkedIn and Google search ads. Google conversions are never shown.

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
- Follow-up task button: `netlify/functions/hs-task.mts` creates a HubSpot task on the company. It needs the `HUBSPOT_TOKEN` environment variable in Netlify (a HubSpot service key, marked secret, with owners read, companies read and tasks write). The Notes box is prefilled with what the company engaged with that month, one "- date: Channel: detail" line per engagement (no intro line, no impressions). The function sends the notes to HubSpot as HTML: each such line becomes a bullet with the channel in bold. Without it the button says task creation isn't turned on. Tasks are assigned to Chris White by default (HubSpot owner 128093036, `TASK_OWNER` in index.html); the Assign to menu can still change it. The form also creates a second follow-up task, checked by default, due 14 days after the first (the date moves when the first due date changes, and can be edited or unchecked). Both are sent in one request; if the second fails, the page says the first was created and the second wasn't. When the list loads, `hs-company` also reads each company's tasks (companies to tasks associations, then task status). If a company has any task that isn't completed, the button turns green and shows how many are open and the next due date. If the key can't read tasks, the response carries `tasksNote` and the buttons stay gold. Keep the parent and child domain note on the page until Factors resolves it.
- Company list: run the Factors agent on each new company's domain (max 9 at a time, collect within 10 minutes) and save results to `factors_new.json`. For companies with LinkedIn clicks but no Factors detail, pull Windsor `member_company_name, clicks` for the month filtered by campaign and save to `li_oct_by_campaign.json` (rename per month). Then run `build_definition_mqls.py` and `merge_defmql.py` (update the month and file paths). LinkedIn clicks show at campaign level with the campaign's active ads (LinkedIn does not report clicks by company for single ads); Google ad IDs map to headlines through `ads-archive.json`. Impressions are listed by campaign only.

### New MQLs so far this month (`public/data/mtd.json`), refreshed every Monday by a scheduled task
The New MQL section on Leads has a toggle: the report month (final) and the current month so far. Same rules as `defMql`, same columns, pop-ups, task button, lifecycle editing and removals.
- Month `M` = the month of yesterday (America/Chicago); `THRU` = yesterday. Everything below uses `M-01` through `THRU`.
- State in the repo: `pipeline/mtd/state/orgs.json` (the healthcare HubSpot companies, as salted hashes of root domains and normalized names, because the repository is public) and `pipeline/mtd/state/history.json` (per company hash, per month: website sessions, LinkedIn ad clicks, email clicks, Google or Bing ad visits; `through` = last finished month). Names and record IDs for each week's new companies come from a HubSpot lookup at run time, and last week's `mtd.json` is reused. Pulls go to `pipeline/mtd/in/<M>/`, which is not committed (it holds non-healthcare companies and contact-level rows).
- Finish last month first: if `history.json` `through` is earlier than the month before `M`, run steps 1 to 6 for each missing month `P` with `THRU` = the last day of `P` (skip the Factors agent), then `python3 pipeline/mtd/build_mtd.py P <last day> --finalize`. This adds that month to the history so it counts in the 12-month lookback.
1. Factors "Accounts Active On Website" (`TnNNtMqp1773408448s6TybBgQMieErQTa2UpTWi6twtz3EdhsKG1WjW3raV`), 7-day pulls from `M-01` (1 to 7, 8 to 14, 15 to 21, 22 to 28, 29 to end), the last one ending `THRU`.
2. Factors "Google Ads / Paid Search Website Session" (`Y1QbkryaOa41780400539fE3bOGS8jZ5EQpcTcXTbqgScIDOcjbsSTmEYj7e`), the same 7-day pulls. Factors "Bing Ads Website Sessions" (`oYuKrCZEV4E7Mf9AnowFl7AYvwaEesvrXiHd4IMHIihgvKV61791902748QD`), one pull `M-01` to `THRU`.
3. Windsor `linkedin`, `M-01` to `THRU`: fields `year_month, member_company_name, clicks` with filters clicks gt 0 and campaign ncontains "enior"; then fields `year_month, member_company_name, campaign, clicks` with the same filters plus member_company_name notnull. Keep `year_month` in both: the collector uses it to date the rows.
4. HubSpot, with dates as epoch milliseconds for `M-01` 00:00 UTC: CONTACT search where `hs_email_last_click_date` GTE that value (properties `hs_email_domain, hs_email_first_click_date, hs_email_last_click_date`); CONTACT search where `hs_sales_email_last_clicked` GTE that value (properties `hs_email_domain, hs_sales_email_last_clicked`); COMPANY search where `createdate` GTE that value (properties `name, domain, industry, createdate`). Page through with `offset` until every result is read. The collector keeps only domains and dates, never names or emails.
5. `python3 pipeline/mtd/collect.py M`, then `python3 pipeline/mtd/build_mtd.py M THRU`. It prints the new companies and `missingFactors`. If it prints `LOOKUP NEEDED`, search HubSpot COMPANY with `domain` IN each listed domain and its `www.` form, and with `query` set to each listed LinkedIn name (properties `name, domain, industry, createdate`), then run `collect.py` and `build_mtd.py` again. A company stays off the list until it has a HubSpot name and record.
6. Run the Factors agent `mql_journey_agent_(dashboard)_lQKvZ` on each domain in `missingFactors` (at most 9 at a time; poll `get_agent_run` every 15 seconds; results expire after 10 minutes). Then run `collect.py` and `build_mtd.py` again.
7. Check: the new count is the length of `companies`; every company is healthcare; no senior living campaign, page or search term appears. Commit `public/data/mtd.json` and `pipeline/mtd/state/` to `main` and push; confirm the Netlify deploy goes live.
- If the Factors website pull fails, don't publish (a partial pull would drop companies); leave last week's list up and tell Amy what failed.
- The list counts companies once they qualify, so it only grows during the month. The final New MQL count for the month comes from the monthly report, which uses the same rules over the full month.

### Trends and first outreach (`trends`, `sqlJourneys.summary.outreach`)
- Day of week: dated Google and Bing ad visits and email clicks by healthcare companies in HubSpot, January through month `m` (one per company per day per channel), plus `accounts.knownVisitsDaily` averaged by weekday. LinkedIn clicks (monthly) and website visits (weekly) can't be placed on a day.
- Locations: HubSpot company `state` for every company in Total Engaged Companies (year), saved to `hs_state.json` (search COMPANY with `hs_object_id` IN batches of 100, property `state`). Normalize abbreviations to state names and group into Census regions.
- First outreach to SQL: for each SQL company, search its contacts with `hs_sa_first_engagement_object_type` IN EMAIL, CALL, sorted by `hs_sa_first_engagement_date` ascending, limit 1. Update the `FO` table in `scripts/build_trends.py`, then run it and `scripts/merge_trends.py`. Report the median in months.
- Day of week, all sources (heat table): Windsor `linkedin` `date, clicks` (campaign ncontains Senior/senior, clicks gt 0), `google_ads` `day_of_week, clicks` (same campaign filter) and `googleanalytics4` `day_of_week_name, sessions` (landing_page ncontains senior), January 1 through the end of month `m`; save to `dow_sources.json`. Bing visits and email clicks come from the definition MQL data, HubSpot companies on the site from `knownVisitsDaily`. Show each source's share by weekday. Do not use Factors LinkedIn dates for weekdays: Factors loads LinkedIn company data every two to four days, so its dates bunch up on load days.
- New MQLs by source, month by month (`defMql.newBySource`): for each month, the new companies and which sources they engaged through that month.
- Hot MQLs (`defMql.hot`): healthcare HubSpot companies with 15 or more engagements (raised from 5 in November 2026) (website sessions + LinkedIn ad clicks + email clicks) in the 12 months through month `m`, or a contact page visit. Contact page visits come from the "Account Details + Website Metrics" landing pages and the Factors agent's page visits, which only cover part of the year; a Factors saved report of contact page views by company would cover all of it.
- Lifecycle stage column (New MQL companies): save each company's HubSpot `lifecyclestage` to `hs_lifecycle.json` (search COMPANY with `hs_object_id` IN, property `lifecyclestage`). On the page, `netlify/functions/hs-company.mts` reads the live stage and saves changes back to HubSpot with the same `HUBSPOT_TOKEN`; saving needs the key's companies write permission (crm.objects.companies.write). A backward move is cleared first, then set, and the old stage is restored if the save fails.
- New MQLs by month: no 2025 comparison (website and Google tracking started March 16, 2026). From January 2027, add 2026 `monthlyNew` as the comparison year, the same way New SQLs by month compares years.
- Removing anomalies: anyone with the dashboard password can remove a company from the MQL counts (New MQL and Hot MQL rows, "Remove from MQL counts"). The list lives in Netlify Blobs (`netlify/functions/exclusions.mts`, store `dashboard-exclusions`, key `mql`) and applies to every month. The page and the Ask assistant subtract removed companies using `defMql.lists` (`newYtd` [domain, first new month, sources], `engagedYtd`, `activeOct`), so keep building those lists each month. Written text in the Executive Summary is not recalculated; check its MQL numbers if companies were removed.
- Last 1:1 email or call (New MQL list): HubSpot company `hs_last_logged_outgoing_email_date` and `hs_last_logged_call_date`, saved to `hs_last_outreach.json` (merged by `scripts/merge_trends.py`). The page refreshes it live through `/api/hs-company`.
- Task notes carry links: LinkedIn ad post URLs (Windsor `linkedin` `creative_id, ad_post_url`, saved to `li_post_urls.json` and added by `scripts/build_ad_perf.py`, which must run after `merge_defmql.py`) and Google landing pages.
- Written MQL numbers: after companies are removed, the Executive Summary and the New MQL panel show "Update the written numbers". It replaces the old New MQL and Total Engaged Companies counts in the written text (only where the number sits next to "companies", "MQLs" and similar) and saves through the edits store, recording the numbers it applied under `meta.mqlNums`.
- Selecting a company in the New MQL list, Hot MQLs or SQL journeys opens a full-screen journey view with Previous and Next buttons (arrow keys work) and Esc to close. Its timeline runs month by month from the first tracked engagement: each month is a clickable column of stacked bars, and the selected month shows what the company engaged with underneath (arrow keys move between months when a month is focused). New MQLs and Hot MQLs open on the latest month; SQL companies open on their SQL month, with LinkedIn impressions in a row under the bars.
- Timeline data: `scripts/build_trends.py` builds `tl` for every hot MQL and every new MQL (`[month, website sessions, LinkedIn clicks, email clicks, Google or Bing ad visits, [[type, text]]]`, types web, li, ad, em, from the first tracked month through month `m`); `scripts/merge_trends.py` copies the new MQL timelines onto `defMql.companies`. Website sessions include ad visits, so the page shows them net of ad visits. For the report month, new MQLs show the full October detail (`rows`). SQL timelines use `sqlJourneys.companies[].monthly`, trimmed to the first month with activity, and `journey` for the month detail.
- LinkedIn ads in the month detail: `scripts/li_campaigns.py` (run after `merge_trends.py`) adds `liAds` to hot MQLs and new MQLs, plus `defMql.adLib` (ad title, image, post link) and `defMql.liCampaignsByMonth`. Inputs: Windsor `linkedin` `year_month, member_company_name, campaign, clicks` (clicks gt 0, campaign ncontains "enior", member_company_name in the LinkedIn names of the hot and new MQL companies, saved as `li_company_campaign.json`; the names come from `li_name_to_org.json`), `li_ad_monthly.json` and the ads archive. LinkedIn splits a company's clicks by campaign only at 3 or more clicks in a campaign that month and never names the ad a company clicked, so the pop-up shows the campaign and the ads that had clicks in it that month, marks the ad as clicked only when one ad had clicks, and lists the campaigns running when no split is available. In October 2026 about 60% of hot MQL LinkedIn clicks had a campaign.
- New MQL section is list only (the calendar view was removed Nov 6, 2026 at Amy's request).
- New MQL list columns: Company, How they engaged, Last 1:1 email or call, Most recent engagement, HubSpot lifecycle stage, Follow-up. The gold follow-up task button is the last column. Task notes carry no links.
- Hot MQLs and SQL journeys show one summary row per company (Hot: engagements, how they engaged as a mix bar, active months of the past 12 and the first tracked month, most recent; SQL: SQL date, first tracked touch, months of ads and touches before SQL, most recent touch), with search, and Hot also has sort and filter. Hot MQLs have no task button.
- Company names on Leads open the HubSpot company record (portal 4587932) in a new tab.
- Hot MQLs also carry `months` (the past 12 months) for the active months count.
- The Dashboard tab was merged into the Executive summary in November 2026 (old #summary links open the Executive summary). The "How they engaged" and "Where they are" panels were removed; their data stays in the file.
- Leads & accounts layout: top charts are New MQLs by month (definition) and New SQLs by month; the MQL to SQL rate sits with the SQL journey tiles. The all-source company list and the LinkedIn visitor list were removed in November 2026 (data stays in the file for the Ask assistant).

### MQL company journeys (Factors agent + HubSpot), kept in the data file for the Ask assistant (no longer shown on the page)
- For each company behind this month's MQLs (HubSpot Lead records entering New in month `m`; use `hs_primary_company_id` and the company `domain`, without `www.`), run the Factors agent `mql_journey_agent_(dashboard)_lQKvZ` with `run_agent_async`, then poll `get_agent_run`. Results expire after 10 minutes, so start no more than 9 at a time and collect them before starting more. Save each JSON result to a file.
- From HubSpot, get each company's contacts (job title, `hs_email_last_open_date`, `hs_email_last_click_date`, `hs_sales_email_last_clicked`) and the lead's label (Hot or Warm).
- Build `mqlJourneys` = `{month, summary, companies}` with `scripts/build_mql_journeys.py` (edit its inputs). Rules: ad and website touches cover the 6 months before each MQL date (Factors' limit); email covers 12 months. "Actively engaged" = clicked an ad, visited from an ad or clicked an email. Show LinkedIn ad views only as "saw LinkedIn ads" because Factors counts them inconsistently. Drop any senior living touch, page or campaign. Never include people's names or email addresses.

### Ads archive (tracker's Ads archive tab)
- Rebuild `public/data/ads-archive.json` with `scripts/build_ads_archive.py`, then run `scripts/ads_monthly.py <li_ad_monthly.json> <google_ad_monthly.json>` (the Windsor monthly ad pulls: linkedin creative_id, campaign, year_month, impressions, clicks; google_ads ad_id, campaign, ad_group_name, year_month, impressions, clicks) so each ad carries its month-by-month numbers for the Ads archive period filter (From and to months; Active now, Ran in this period, Didn't run in this period, All ads). from two Windsor pulls for January 1 through today: `linkedin` (campaign_group_name, campaign, creative_id, share_title, creative_status, landing_page, creative_thumbnail, impressions, clicks) and `google_ads` (campaign, ad_group_name, ad_id, ad_group_ad_status, campaign_status, ad_strength, ad_responsive_search_ad_headlines, ad_responsive_search_ad_descriptions, ad_final_urls, impressions, clicks). Leave out senior living, DemandGen and YouTube. Set `updated` to today. LinkedIn thumbnail links expire about a week after the pull; that's expected.

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

### Engagement after 1:1 outreach (Leads)
- Panel after Hot MQLs. Calls and 1:1 emails are read live from HubSpot by `netlify/functions/hs-outreach.mts` (HUBSPOT_TOKEN; the key can read calls, emails and tasks, checked with `/api/hs-access` on Nov 6, 2026). It returns dates, call or email, and company name, domain and industry only. No contacts, subjects or bodies.
- Engagement comes from `public/data/engage-<month>.json`, built by `scripts/outreach_engage.py <month>` from the month's Factors "Account Details + Website Metrics" 2-day pulls (accounts/details), the Google and Bing Factors pulls (defmql/paid) and HubSpot email clicks (defmql/email_clicks.json). Healthcare only, senior living left out. Run it each month after those pulls; without the file the panel says it isn't available for that month.
- Rules: healthcare companies (same industry and name test as compute.py), counted by root domain. A company engaged when a website session, ad visit or email click falls from the outreach day through 7 days after. Outreach in the last 7 days of the month is listed but kept out of the percentages. "Without recent outreach" = share of 8-day stretches in the month, for the same companies, with no 1:1 outreach from 7 days before through the end of the stretch, that had engagement (shown when there are 30 or more stretches).

### Journey pop-ups on Leads (full history)
- Hot MQL, New MQL and SQL pop-ups run month by month from the first tracked touch to the most recent month, with empty months shown.
- Hot and New MQLs: when a pop-up opens, `hs-outreach?company=<HubSpot id>` returns that company's calls, emails Boldt sent and replies (dates only) and they are added as a "Calls, 1:1 emails and replies" bar segment and listed in each month. SQL pop-ups already carry HubSpot touches in `sqlJourneys` and now start at the first one, even before the monthly counts begin.
- The current month so far comes from `mtd.json` `cur` (written by `build_mtd.py` for domains in the last monthly report: [website sessions, LinkedIn clicks, email clicks, Google or Bing ad visits]). It appears after the Monday refresh; the detail comes with the monthly report.

### Project calendar (tracker.html) Now view
- Each project shows once. "Waiting on others" and "On hold" always go in the waiting lane (due date on the card, waiting first, soonest first); the date columns hold the other open work. "No due date" lists open projects without a date that aren't waiting or on hold. Changed Nov 9, 2026 at Amy's request.
- Ads archive: no headline over the image (a "No image preview" box only shows when the image fails); cards grow on hover on desktop and the image opens full size on click.

### New MQLs by source
- One stacked bar per month (`sbars`): height is the month's new MQLs, split by each source's share of the source counts (a company with several sources is split across them). Bars grow in on load; hover or keyboard focus on a month highlights it and shows the actual source counts and the total.

### Leads tab top (Nov 9, 2026)
- The New MQLs by month and New SQLs by month charts were removed at Amy's request. The monthly average now shows on New MQLs by source as a dashed gold line, in the legend and subtitle, and in each month's hover box (above or below the average).

### MQL follow-up panel (Leads)
- Live from HubSpot through `netlify/functions/hs-leadtasks.mts` (HUBSPOT_TOKEN). Tasks assigned to Chris White (owner 128093036) whose title contains "marketing lead #1", created since Jan 1, 2026.
- Overdue list = Amy's HubSpot report: status not In progress, Completed, Waiting or Deferred, and due date passed. Shows company name (task's company, else the contact's primary company), due date, days overdue, created date. Never task titles or contacts.
- No month-by-month table (removed Nov 11, 2026 at Amy's request).
- Speed to lead = task created to completed (completion date) or deleted (archived). Deleted tasks come from HubSpot's archived list, scanned a few seconds per request with progress in Netlify Blobs store "leadtasks" (keys scan, result). Results cached 10 minutes; `?fresh=1` skips the cache.
