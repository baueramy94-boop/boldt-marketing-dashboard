"""Build sqlJourneys for the Leads & accounts page.

Inputs (saved in this folder):
  li_company_monthly.json  Windsor LinkedIn member_company_name x month (healthcare campaigns only; senior campaigns filtered out)
  factors_sql.json         Factors agent mql_journey_agent_(dashboard)_lQKvZ results by domain (last 180 days)
SQL companies: HubSpot companies whose lifecycle stage entered "Sales qualified lead" in 2026
(hs_v2_date_entered_salesqualifiedlead), healthcare only.
"""
import json, re, datetime as dt

SQL = [  # company, domain, hubspot id, date entered SQL, LinkedIn member company names
    ("Southern Illinois Healthcare", "sih.net", 25107555942, "2026-01-08", ["Southern Illinois Healthcare"]),
    ("Encompass Health", "encompasshealth.com", 15274058851, "2026-01-22", ["Encompass Health"]),
    ("UCHealth", "uchealth.org", 4519570116, "2026-01-30", ["UCHealth"]),
    ("Northern Light Health", "northernlighthealth.org", 52068957248, "2026-02-25", None),   # any "Northern Light ..." name
    ("Mercy", "mercy.net", 4488671630, "2026-02-26", ["Mercy"]),
    ("Prime Healthcare Services", "primehealthcare.com", 4488347829, "2026-03-02", ["Prime Healthcare"]),
    ("Ashley Regional Medical Center", "ashleyregional.com", 8951638595, "2026-03-02", ["Ashley Regional Medical Center"]),
    ("Cone Health", "conehealth.com", 4488672133, "2026-05-07", ["Cone Health"]),
    ("Adventist HealthCare", "adventisthealthcare.com", 15456693784, "2026-05-08", ["Adventist HealthCare"]),
    ("Sinai Chicago", "sinaichicago.org", 31397850217, "2026-05-13", ["Sinai Chicago"]),
    ("The University of Vermont Health", "uvmhealth.org", 8951594558, "2026-05-18", ["University of Vermont Health"]),
    ("Penn Medicine", "pennmedicine.org", 31827969937, "2026-05-18", None),                  # any "Penn Medicine ..." name
    ("Catawba Valley Health System", "catawbavalleyhealth.org", 899383144, "2026-05-21", ["Catawba Valley Health System"]),
    ("Edward-Elmhurst Health", "eehealth.org", 15435138629, "2026-09-24", ["Edward-Elmhurst Health", "Endeavor Health"]),
]
PREFIX = {"northernlighthealth.org": "Northern Light", "pennmedicine.org": "Penn Medicine"}

LI = json.load(open("li_company_monthly.json"))
FA = json.load(open("factors_sql.json"))
MONTHS = sorted(LI)
FACTORS_START = "2026-05-09"   # 180 days before the pull on Nov 5, 2026
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ml = lambda ym: f"{MON[int(ym[5:7]) - 1]} {ym[:4]}"

def match(dom, names, n):
    if dom in PREFIX: return n.startswith(PREFIX[dom])
    return n in names

CH = {"LinkedIn ad view": "LinkedIn ad view", "LinkedIn ad click": "LinkedIn ad click", "Google Ads": "Google Ads visit",
      "Bing Ads": "Bing Ads visit", "LinkedIn (organic or paid visit)": "Visit from LinkedIn", "Organic search": "Organic search visit",
      "Direct": "Direct visit", "Sales email": "Sales email sent", "Meeting": "Meeting with Boldt", "Email": "Email visit", "Form fill": "Form fill"}
GENERIC = {"Sales email sent": "Sales email sent", "Meeting with Boldt": "Meeting on the calendar"}  # never show subject lines (they carry names)

def clean(s):
    s = str(s).replace("—", ",").replace("–", ",").replace(" , ", ", ")
    s = re.sub(r"\s+from [A-Z][A-Za-z .]+ [A-Z]{2}$", "", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" :,")
    return s

out = []
for name, dom, cid, sqld, names in SQL:
    sqm = sqld[:7]
    monthly = []
    for m in MONTHS:
        rows = [r for r in LI[m] if match(dom, names, r["member_company_name"])]
        imp = sum(r["impressions"] for r in rows); clk = sum(r["clicks"] for r in rows)
        monthly.append((m, imp, clk))
    seen = [m for m, i, c in monthly if i > 0]
    clicked = [m for m, i, c in monthly if c > 0]
    before = [(m, i, c) for m, i, c in monthly if m < sqm]
    same = [(m, i, c) for m, i, c in monthly if m == sqm]
    after = [(m, i, c) for m, i, c in monthly if m > sqm]
    first = seen[0] if seen else None
    lead = None
    if first and first <= sqm:
        lead = (int(sqm[:4]) - int(first[:4])) * 12 + int(sqm[5:7]) - int(first[5:7])
    f = FA.get(dom, {})
    c = f.get("counts", {})
    tl = []
    for t in f.get("timeline", []):
        if re.search(r"senior", t.get("what", ""), re.I): continue
        ch = CH.get(t["channel"], t["channel"])
        if ch == "Other": continue
        what = GENERIC.get(ch) or clean(t.get("what", ""))
        tl.append({"date": t["date"], "channel": ch, "what": what, "beforeSql": t["date"] < sqld})
    g_before = [t for t in tl if t["channel"] == "Google Ads visit" and t["beforeSql"]]
    recent = {"liViews": c.get("linkedin_ad_views", 0) > 0, "liClicks": c.get("linkedin_ad_clicks", 0),
              "google": sum(1 for t in tl if t["channel"] == "Google Ads visit") if tl else c.get("google_ad_sessions", 0),
              "pages": c.get("page_views", 0), "meetings": c.get("meetings", 0), "salesEmails": c.get("sales_emails", 0)}
    out.append({
        "company": name, "domain": dom, "hubspotId": cid, "sql": sqld,
        "firstAd": {"month": first, "label": ml(first), "channel": "LinkedIn ad view"} if first else None,
        "firstClick": {"month": clicked[0], "label": ml(clicked[0])} if clicked else None,
        "leadMonths": lead,
        "before": {"months": sum(1 for m, i, c2 in before if i > 0), "impr": sum(i for m, i, c2 in before), "clicks": sum(c2 for m, i, c2 in before)},
        "sqlMonth": {"impr": sum(i for m, i, c2 in same), "clicks": sum(c2 for m, i, c2 in same)},
        "after": {"months": sum(1 for m, i, c2 in after if i > 0), "impr": sum(i for m, i, c2 in after), "clicks": sum(c2 for m, i, c2 in after)},
        "googleBefore": g_before[-1]["date"] if g_before else None,
        "monthly": [{"m": m, "i": i, "c": c2} for m, i, c2 in monthly if m >= "2024-11"],
        "recent": recent,
        "timeline": sorted(tl, key=lambda t: t["date"], reverse=True)[:8],
    })

n = len(out)
saw_before = [x for x in out if x["firstAd"] and x["firstAd"]["month"] < x["sql"][:7]]
saw_by = [x for x in out if x["firstAd"] and x["firstAd"]["month"] <= x["sql"][:7]]
clicked_before = [x for x in out if x["before"]["clicks"] > 0 or x["sqlMonth"]["clicks"] > 0]
leads = sorted(x["leadMonths"] for x in saw_by)
med = leads[len(leads) // 2] if len(leads) % 2 else (leads[len(leads) // 2 - 1] + leads[len(leads) // 2]) / 2
still = [x for x in out if x["after"]["impr"] > 0]
firsts = {}
for x in saw_by: firsts[x["firstAd"]["label"]] = firsts.get(x["firstAd"]["label"], 0) + 1
summary = {
    "n": n, "sawBefore": len(saw_before), "sawBy": len(saw_by), "clickedBefore": len(clicked_before),
    "medianLead": med, "maxLead": max(leads) if leads else None, "stillReached": len(still),
    "googleBefore": sum(1 for x in out if x["googleBefore"]),
    "firstMonths": firsts,
    "window": "LinkedIn ads by company, November 2024 (first healthcare campaigns) through October 2026. Website and Google Ads visits from Factors cover May 9 to October 31, 2026.",
    "source": "SQL companies: HubSpot companies that entered the Sales qualified lead stage in 2026.",
}
json.dump({"year": 2026, "summary": summary, "companies": sorted(out, key=lambda x: x["sql"], reverse=True)}, open("sqlJourneys.json", "w"), indent=1)
print(json.dumps(summary, indent=1))
for x in sorted(out, key=lambda x: x["sql"]):
    print(f'{x["company"][:28]:28} sql {x["sql"]} first {x["firstAd"]["label"] if x["firstAd"] else "-":9} lead {x["leadMonths"]} before {x["before"]} sqlm {x["sqlMonth"]} after {x["after"]["impr"]} g {x["googleBefore"]}')

# ---------------------------------------------------------------------------------------------------------------
# Full customer journey (added Nov 5, 2026): every touch we can see for each SQL company, by month.
#   LinkedIn ad impressions and clicks by month (Windsor, Nov 2024 on); LinkedIn clicks by campaign (Factors, May 9 on)
#   Google and Bing ad visits (Factors paid search reports, Mar 16, 2026 on); website visits by week (Factors, Mar 16 on)
#   with pages viewed (Factors account journey, May 9 on); marketing email clicks (HubSpot first and most recent click per
#   contact, email name from Factors when it saw the click); 1:1 email clicks (HubSpot, most recent per contact);
#   1:1 emails sent, calls and meetings (Factors from HubSpot, May 9 on) plus HubSpot's most recent call and meeting dates.
# Never includes people's names, email addresses, titles or email subject lines.
import os, io, contextlib, runpy
_cwd = os.getcwd(); os.chdir("/home/claude/dashboard/defmql")
with contextlib.redirect_stdout(io.StringIO()):
    DM = runpy.run_path("compute.py")
os.chdir(_cwd)
EVENTS, ROOT, GCAMP, nk, SENC, TEMPLATE = DM["events"], DM["root"], DM["GCAMP"], DM["nk"], DM["SENC"], DM["TEMPLATE"]
F3 = json.load(open("/home/claude/dashboard/defmql/factors_v3.json"))
HSP = {k: v for k, v in json.load(open("hs_sql_props.json")).items() if not k.startswith("_")}
REPORT_END = "2026-10-31"
MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
dl = lambda d: f"{MS[int(d[5:7]) - 1]} {int(d[8:10])}"
def campn(s):
    s = re.sub(r"^\d+-", "", (s or "").strip()); s = re.sub(r"\s*\|\s*2026\s*$", "", s)
    return s.replace("Awareness | Healthcare | ", "").replace("Lead Generation | Healthcare | ", "").strip(" |")
PAGE = lambda p: re.sub(r"^https?://", "", p or "").replace("www.boldthealthcarerealestate.com", "") or "/"

def journey(x):
    dom = x["domain"]; r = ROOT(dom); f = F3.get(dom, {}); hp = HSP.get(dom, {})
    items = []   # (date, sortkey, channel, what, kind)
    for d, ch, ev in EVENTS.get(r, []):
        if d > REPORT_END: continue
        if ch == "Website visit":
            items.append((d, "w", "Website visit", f'{ev.get("sessions") or 1} session{"s" if (ev.get("sessions") or 1) != 1 else ""}, week of {dl(d)}', "w", ev.get("sessions") or 1))
        elif ch in ("Google ad click", "Bing ad click"):
            cn = GCAMP.get(nk(ev["campaign"]), ev["campaign"].replace("+", " "))
            kw = f', searched "{ev["keyword"]}"' if ev.get("keyword") else ""
            items.append((d, "s", ch.replace(" click", " visit"), f"{cn}{kw}", "s", ev.get("n", 1)))
        elif ch == "Email click":
            if ev["type"] == "Marketing email":
                nm = next((e.get("email") for e in f.get("email_clicks", []) if e.get("date") and abs((dt.date.fromisoformat(e["date"]) - dt.date.fromisoformat(d)).days) <= 1 and not SENC.search(e.get("email") or "")), None)
                items.append((d, "e", "Email click", f"Clicked a marketing email: {nm}" if nm else "Clicked a marketing email", "e", 1))
            else:
                best = None
                for t in f.get("sales_touches", []):
                    sj = TEMPLATE(t.get("subject"))
                    if t.get("type") == "1:1 email" and sj and t.get("date") and t["date"] <= d and (dt.date.fromisoformat(d) - dt.date.fromisoformat(t["date"])).days <= 14 and (not best or t["date"] > best[1]): best = (sj, t["date"])
                items.append((d, "e", "Email click", f"Clicked a 1:1 email from Boldt: {best[0]} (sent {dl(best[1])})" if best else "Clicked a 1:1 email from Boldt", "e", 1))
    # pages viewed (Factors) attach to the website visits; paid landing pages attach to the ad visit
    pv = {}
    for v in f.get("page_visits", []):
        pg = [PAGE(p) for p in (v.get("pages") or []) if isinstance(p, str) and not SENC.search(p)]
        if pg: pv.setdefault(v["date"], []).append((v.get("source"), pg))
    for a in f.get("clicked_ads", []):
        if a.get("channel") == "LinkedIn ad click" and a.get("date") and not SENC.search(json.dumps(a)):
            items.append((a["date"], "l", "LinkedIn ad click", f'{a.get("clicks") or 1} click{"s" if (a.get("clicks") or 1) != 1 else ""} on {campn(a.get("ad") or a.get("campaign"))}' + (f', landed on {PAGE(a["landing_page"])}' if a.get("landing_page") else ""), "c0", 0))
    st = {"1:1 email": "Sent by Boldt", "Call": "Logged in HubSpot", "Meeting": "On the calendar"}
    seen = set()
    for t in f.get("sales_touches", []):
        if not t.get("date") or t["date"] > REPORT_END: continue
        k = (t["date"], t["type"])
        if k in seen: continue
        seen.add(k)
        items.append((t["date"], "t", t["type"] if t["type"] != "1:1 email" else "1:1 email", st.get(t["type"], t["type"]), "t", 1))
    for key, typ in (("lastCall", "Call"), ("lastMeeting", "Meeting")):
        d = hp.get(key)
        if d and d <= REPORT_END and (d, typ) not in seen:
            items.append((d, "t", typ, "Most recent in HubSpot", "t", 1)); seen.add((d, typ))
    if hp.get("conversion"):
        items.append((hp["conversion"]["date"], "f", "Form fill", hp["conversion"]["what"], "f", 1))
    # attach pages
    out_items = []
    for d, sk, ch, what, kind, n in items:
        if kind == "w":
            wk = [pv[k] for k in sorted(pv) if d <= k <= (dt.date.fromisoformat(d) + dt.timedelta(days=6)).isoformat()]
            pages = sorted({p for grp in wk for src, pg in grp for p in pg})[:4]
            srcs = sorted({src for grp in wk for src, pg in grp if src})
            if pages: what += f'. Pages: {", ".join(pages)}'
            elif d < "2026-05-09": what += ". Pages not recorded: Factors page detail starts May 9, 2026"
            else: what += ". Pages not recorded: Factors counted this visit in its weekly company report, but the visit isn't in the company's Factors timeline, which is where page detail comes from"
            if srcs: what += f' (from {", ".join(srcs)})'
        if kind == "s" and d in pv:
            pages = sorted({p for src, pg in pv[d] for p in pg})[:3]
            if pages: what += f'. Landed on {", ".join(pages)}'
        out_items.append({"date": d, "channel": ch, "what": what, "kind": kind, "n": n, "beforeSql": d < x["sql"]})
    out_items.append({"date": x["sql"], "channel": "Became an SQL", "what": "Lifecycle stage set to Sales qualified lead in HubSpot", "kind": "q", "n": 0, "beforeSql": False})
    # months: LinkedIn monthly summary plus the dated touches
    months = {}
    for mrow in x["monthly"]:
        if mrow["i"] or mrow["c"]: months.setdefault(mrow["m"], {"m": mrow["m"], "li": {"i": mrow["i"], "c": mrow["c"]}, "items": []})
    for it in out_items:
        months.setdefault(it["date"][:7], {"m": it["date"][:7], "li": None, "items": []})["items"].append(it)
    for m in months.values():
        m["items"].sort(key=lambda it: (it["date"], it["kind"] != "q"), reverse=True)
        if m["li"] is None:
            mm = next((z for z in x["monthly"] if z["m"] == m["m"]), None)
            if mm and (mm["i"] or mm["c"]): m["li"] = {"i": mm["i"], "c": mm["c"]}
    # markers for the strip
    mk = {}
    for it in out_items:
        z = mk.setdefault(it["date"][:7], {"s": 0, "w": 0, "e": 0, "t": 0})
        if it["kind"] in z: z[it["kind"]] += it["n"] or 1
    for mrow in x["monthly"]:
        z = mk.get(mrow["m"], {})
        mrow.update({k: z.get(k, 0) for k in ("s", "w", "e", "t")})
    kinds_before = {it["kind"] for it in out_items if it["beforeSql"]}
    if x["before"]["impr"] or x["before"]["clicks"]: kinds_before.add("li")
    return sorted(months.values(), key=lambda m: m["m"], reverse=True), kinds_before, hp.get("salesActivities")

J = json.load(open("sqlJourneys.json"))
cb = {"li": 0, "s": 0, "w": 0, "e": 0, "t": 0}
for x in J["companies"]:
    x["journey"], kb, x["salesActivities"] = journey(x)
    x.pop("timeline", None)
    for k in cb:
        if k in kb: cb[k] += 1
J["summary"]["touchesBefore"] = {"LinkedIn ads": cb["li"], "Google or Bing ads": cb["s"], "Website visit": cb["w"], "Email click": cb["e"], "Call, meeting or 1:1 email": cb["t"]}
J["summary"]["window"] = ("LinkedIn ads by company from November 2024 (first healthcare campaigns). Website visits and Google ads from March 16, 2026, Bing ads from "
                          "their September 2026 launch. Pages viewed, LinkedIn campaigns clicked, 1:1 emails, calls and meetings from Factors cover May 9 to October 31, 2026; "
                          "before May the journey shows HubSpot's most recent call and meeting date. Marketing email clicks show each contact's first and most recent click.")
J["summary"]["domainNote"] = "Parent and child companies that share one website domain, such as a health system and its hospitals, can't always be told apart, so their activity may be combined. We're working through this with Factors."
json.dump(J, open("sqlJourneys.json", "w"), indent=1)
print("touches before SQL", J["summary"]["touchesBefore"])
for x in J["companies"]:
    print(f'{x["company"][:26]:26} months {len(x["journey"]):2} items {sum(len(m["items"]) for m in x["journey"]):3}')
