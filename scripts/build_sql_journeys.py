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
