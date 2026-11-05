"""October 2026 MQLs by Boldt's definition: a company in HubSpot that actively engaged in the past 12 months.
Active engagement = website visit (Factors, includes visits from ad clicks), LinkedIn ad click (LinkedIn company data),
marketing email click (HubSpot). Counted by organization (unique domain). Healthcare only."""
import json, re, datetime as dt
from collections import defaultdict

HS = json.load(open("hs_companies.json"))
V = json.load(open("visits.json"))
LI = json.load(open("li_clicks.json"))
EM = json.load(open("email_clicks.json"))
SE = json.load(open("sales_email_clicks.json"))

def root(d):
    d = (d or "").lower().strip().removeprefix("http://").removeprefix("https://").split("/")[0].removeprefix("www.")
    p = d.split(".")
    return ".".join(p[-2:]) if len(p) >= 2 else d

SENIOR = re.compile(r"senior|retirement|assisted living|memory care|brookdale|erickson|sunrise|life ?plan|\bliving\b|nursing home|skilled nursing", re.I)
HC_IND = {"HOSPITAL_HEALTH_CARE", "MEDICAL_PRACTICE", "HEALTH_WELLNESS_AND_FITNESS", "MENTAL_HEALTH_CARE", "Medical & Surgical Hospitals",
          "Hospitals & Physicians Clinics", "MEDICAL_DEVICES", "PHARMACEUTICALS"}
HC_NAME = re.compile(r"health|hospital|medical|medicine|clinic|children'?s|physician|surg|rehab|behavioral|care\b|healthcare|cancer|orthop|pediatric|baptist|mercy|methodist|adventist", re.I)
OWN = {"boldt.com", "theboldtcompany.com"}

# organizations in HubSpot, keyed by root domain
ORG = {}
for cid, c in HS.items():
    r = root(c["domain"])
    if not r or r in OWN: continue
    o = ORG.setdefault(r, {"names": set(), "ind": set(), "ids": {}})
    o["names"].add(c["name"] or ""); o["ind"].add(c["industry"] or ""); o["ids"].setdefault(c["name"] or "", cid)
def is_hc(r):
    o = ORG[r]; nm = " ".join(o["names"])
    if SENIOR.search(nm) and not re.search(r"hospital|health system|medical center", nm, re.I): return False
    return bool(o["ind"] & HC_IND) or bool(HC_NAME.search(nm))
HC = {r for r in ORG if is_hc(r)}

# name index for LinkedIn company names
def norm(s):
    s = re.sub(r"[​®]", "", (s or "").lower()).replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(the|inc|llc|corp|corporation|co)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()
NAME = defaultdict(set)
for r in ORG:
    for n in ORG[r]["names"]: NAME[norm(n)].add(r)

events = defaultdict(list)   # root -> [(date or month, channel)]
# website visits (Factors): week ranges
for k, rows in V.items():
    start = k.split(":")[0]
    for d in rows:
        r = root(d)
        if r in ORG: events[r].append((start, "Website visit", {"end": k.split(":")[1], "sessions": rows[d][2] if isinstance(rows, dict) else None}))
# LinkedIn ad clicks by company (month)
unmatched = []; FUZZY = []
BAD_FUZZY = {"Saint Luke's", "Indiana University Health", "Methodist Healthcare System", "HCA Houston Healthcare", "UNC Health Johnston"}
for m, rows in LI.items():
    for x in rows:
        nm = x["member_company_name"]
        if not nm or SENIOR.search(nm): continue
        n = norm(nm); hit = NAME.get(n)
        if not hit and len(n.split()) >= 2 and nm not in BAD_FUZZY:      # LinkedIn name is the start of a HubSpot name, or the reverse
            cand = {r for k, rs in NAME.items() if (k.startswith(n + " ") or n.startswith(k + " ")) and len(k.split()) >= 2 for r in rs}
            hit = cand if 0 < len(cand) <= 3 else None
            if hit: FUZZY.append((nm, sorted({sorted(ORG[r]["names"], key=len)[0] for r in hit})))
        if hit:
            key = sorted(hit)[0]                 # one organization per LinkedIn company, even if several HubSpot records share the name
            events[key].append((m + "-01", "LinkedIn ad click", {"clicks": x.get("clicks", 0)}))
        else: unmatched.append(nm)
# email clicks, all types: marketing emails (first and last click) and 1:1 sales emails (last click)
for e in EM:
    r = root(e["domain"])
    if r not in ORG: continue
    for f in ("first", "last"):
        if e[f]: events[r].append((e[f][:10], "Email click", {"type": "Marketing email"}))
for e in SE:
    r = root(e["domain"])
    if r in ORG and e["date"]: events[r].append((e["date"], "Email click", {"type": "1:1 email"}))

# Google and Bing ad visits (Factors "Google Ads / Paid Search Website Session" and "Bing Ads Website Sessions" reports, from Mar 16, 2026)
import glob
SENC = re.compile(r"senior|demandgen", re.I)
BING = [x for f in sorted(glob.glob("paid/bing_*.json")) for x in json.load(open(f)) if x.get("source") == "bing" and x.get("campaign") and not SENC.search(x["campaign"]) and not SENC.search(x.get("page") or "") and not SENC.search(x.get("keyword") or "")]
bkey = {(root(x["domain"]), x["date"]) for x in BING}
for x in BING:
    r = root(x["domain"])
    if r in ORG: events[r].append((x["date"], "Bing ad click", {"campaign": x["campaign"], "keyword": None if x["keyword"] in ("$none", None) else x["keyword"], "page": x.get("page")}))
for f in sorted(glob.glob("paid/google_*.json")):
    for x in json.load(open(f)):
        c = x["campaign"]
        if not c or c == "$none" or SENC.search(c) or SENC.search(x.get("keyword") or ""): continue   # healthcare only: drop senior living campaigns and searches
        r = root(x["domain"])
        if r not in ORG or (r, x["date"]) in bkey: continue
        events[r].append((x["date"], "Google ad click", {"campaign": c, "keyword": None if x["keyword"] in ("$none", None) else x["keyword"], "n": x.get("n", 1)}))

def active(r, a, b): return [ev[1] for ev in events[r] if a <= ev[0] <= b]
W_OCT = ("2026-10-01", "2026-10-31")
W_12 = ("2025-11-01", "2026-10-31")          # 12 months through October
W_PRIOR = ("2025-10-01", "2026-09-30")       # 12 months before October

total = sorted(r for r in HC if active(r, *W_12))
octa = sorted(r for r in HC if active(r, *W_OCT))
new = sorted(r for r in octa if not active(r, *W_PRIOR))
known_oct_any = sorted(r for r in ORG if active(r, *W_OCT) and any(ch == "Website visit" for ch in active(r, *W_OCT)))

import calendar
def mrange(y, m): return (f"{y}-{m:02d}-01", f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]}")
def prior12(y, m):
    a = dt.date(y - 1, m, 1); b = dt.date(y, m, 1) - dt.timedelta(days=1); return (a.isoformat(), b.isoformat())
monthly_new = {}
first_new = {}
for mth in range(1, 11):
    w = mrange(2026, mth); p = prior12(2026, mth)
    nn = [r for r in HC if active(r, *w) and not active(r, *p)]
    monthly_new[mth] = len(nn)
    for r in nn: first_new.setdefault(r, mth)
ytd_new = len(first_new)
W_YTD = ("2026-01-01", "2026-10-31")
engaged_ytd_set = [r for r in HC if active(r, *W_YTD)]
engaged_ytd = len(engaged_ytd_set)

def bych(rs, w):
    c = defaultdict(int)
    for r in rs:
        for ch in set(active(r, *w)): c[ch] += 1
    return dict(c)

out = {
    "month": "2026-10",
    "definition": "HubSpot companies (healthcare) with a website visit, LinkedIn ad click or email click (marketing or 1:1). Counted by organization.",
    "total12": len(total), "activeOct": len(octa), "newOct": len(new),
    "totalByChannel": bych(total, W_12), "octByChannel": bych(octa, W_OCT), "newByChannel": bych(new, W_OCT),
    "check_websiteKnownAll_Oct": len(known_oct_any),
    "newNames": [sorted(ORG[r]["names"], key=len)[0] for r in new],
    "monthlyNew": monthly_new, "ytdNew": ytd_new, "engagedYtd": engaged_ytd, "ytdByChannel": bych(engaged_ytd_set, W_YTD),
    "newDomains": new,
}
json.dump(out, open("def_mql_oct.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != "newNames"}, indent=1))
print("HubSpot orgs", len(ORG), "healthcare orgs", len(HC))
print("LinkedIn names unmatched:", len(set(unmatched)), sorted(set(unmatched))[:15])
print("fuzzy:", FUZZY[:40])
print("sample new:", out["newNames"][:25])

import sys; sys.path.insert(0, "/home/claude/dashboard/journeys")
from hubspot import LEADS
mq = {root(d) for d in LEADS}
both_oct = sorted(r for r in mq if r in set(octa)); both_12 = sorted(r for r in mq if r in set(total))
print("Oct HubSpot MQL orgs", len(mq), "active by definition in Oct", len(both_oct), "active in 12 months", len(both_12), "new in Oct", len([r for r in mq if r in set(new)]))
out["manual"] = {"orgs": len(mq), "activeOct": len(both_oct), "active12": len(both_12), "newOct": len([r for r in mq if r in set(new)])}
json.dump(out, open("def_mql_oct.json", "w"), indent=1)

# ---- October new definition MQLs: what each company engaged with, when and how ----
# Website visits by week (Factors account report), LinkedIn ad clicks (LinkedIn company data, by month; campaign and date
# from the Factors account timeline), Google and Bing ad visits (Factors), email clicks (HubSpot). Impressions by campaign only.
import os
FA = json.load(open("factors_new.json")) if os.path.exists("factors_new.json") else {}
if os.path.exists("factors_v3.json"): FA.update(json.load(open("factors_v3.json")))   # newer runs add pages viewed, email names, calls and meetings
ARCH = json.load(open("/home/claude/site/public/data/ads-archive.json"))
GAD = {}
for c in ARCH.get("google", []):
    for g in c.get("adGroups", []):
        for a in g.get("ads", []):
            GAD[str(a.get("id"))] = {"campaign": c["campaign"], "adGroup": g["adGroup"], "headlines": a.get("headlines", [])[:3]}
LAD, LCAMP = {}, {}
for g in ARCH.get("linkedin", []):
    for c in g.get("campaigns", []):
        ads = [{"id": str(a["id"]), "title": a.get("title") or "", "thumb": a.get("thumb") or "", "active": a.get("status") == "ACTIVE"} for a in c.get("ads", [])]
        for a in ads: LAD[a["id"]] = dict(a, campaign=c["campaign"])
        LCAMP.setdefault(re.sub(r"\s*\|\s*2026\s*$", "", c["campaign"]).replace("Awareness | Healthcare | ", "").strip(), []).extend(ads)
nk = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
GCAMP = {nk(c["campaign"]): c["campaign"] for c in ARCH.get("google", [])}
LIC = {k: v for k, v in json.load(open("li_oct_by_campaign.json")).items() if not k.startswith("_")}
# 1:1 email templates: subjects Boldt sends from sequences. A subject also counts when it was sent to two or more companies.
TEMPLATES = {"Choosing the Right Real Estate Partner", "Low-Cost Real Estate Strategy", "Open Book Transparency: A Better Way to Deliver Healthcare Real Estate"}
def _strip(sj): return re.sub(r"^((re|fw|fwd)\s*:\s*)+", "", (sj or "").strip(), flags=re.I).strip()
from collections import Counter as _C
_seen = _C()
for _d, _f in FA.items():
    for _s in {_strip(t.get("subject")) for t in _f.get("sales_touches", []) if t.get("subject")}: _seen[_s] += 1
def TEMPLATE(sj):
    s_ = _strip(sj)
    return s_ if s_ and (s_ in TEMPLATES or _seen[s_] >= 2) else None
MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
def dl(d): return f"{MONS[int(d[5:7]) - 1]} {int(d[8:10])}"
def camp(s):
    s = re.sub(r"^\d+-", "", (s or "").strip())
    s = re.sub(r"\s*\([A-Z][a-z]{2} \d{1,2}\)$", "", s)
    while s.startswith("Awareness | Healthcare | Awareness | Healthcare"): s = s[len("Awareness | Healthcare | "):]
    s = re.sub(r"\s*\|\s*2026\s*$", "", s)
    s = s.replace("Awareness | Healthcare | ", "").replace("Lead Generation | Healthcare | ", "")
    s = s.replace("—", "-").replace("–", "-")
    return re.sub(r"\s+", " ", s).strip(" |")
def camp_group(s):
    return "Awareness" if s.startswith("Awareness") else "Lead generation" if s.startswith("Lead Gen") else ""

companies = []
for r in new:
    ev = sorted([e for e in events[r] if W_OCT[0] <= e[0] <= W_OCT[1]], key=lambda e: e[0])
    f = FA.get(r, {})
    web = {}
    for d, ch, x in ev:
        if ch == "Website visit":
            w = web.setdefault(d, {"start": d, "end": x["end"], "sessions": 0}); w["sessions"] += x.get("sessions") or 0
    web = [{"week": dl(w["start"]) + (" to " + dl(w["end"]) if w["end"] != w["start"] else ""), "start": w["start"], "sessions": w["sessions"]} for w in sorted(web.values(), key=lambda w: w["start"])]
    li_month = sum(x.get("clicks", 0) for d, ch, x in ev if ch == "LinkedIn ad click")
    li, search = [], []
    for a in f.get("clicked_ads", []):
        if not a.get("date", "").startswith("2026-10") or re.search(r"senior", json.dumps(a), re.I): continue
        if a["channel"] == "LinkedIn ad click":
            aid = (a.get("ad") or "").strip()
            if aid.isdigit() and aid in LAD:
                nm = camp(a.get("campaign")) or camp(LAD[aid]["campaign"]); ads = [{k: LAD[aid][k] for k in ("id", "title", "thumb")}]; exact = True
            else:
                nm = camp(a.get("ad") or a.get("campaign")); pool = LCAMP.get(nm, [])
                act = [x for x in pool if x["active"]] or pool
                ads = [{k: x[k] for k in ("id", "title", "thumb")} for x in act][:6]; exact = False
            li.append({"date": a["date"], "campaign": nm, "ads": ads, "exactAd": exact, "group": camp_group(a.get("campaign") or a.get("ad") or ""), "clicks": a.get("clicks") or 1, "landing": a.get("landing_page")})
    # Google and Bing visits come from the Factors paid search reports; the account journey adds the ad and landing page when it has them
    agent_paid = [a for a in f.get("clicked_ads", []) if a.get("channel") in ("Google Ads", "Bing Ads") and a.get("date", "").startswith("2026-10")]
    ms = {}
    for d, ch, x in ev:
        if ch not in ("Google ad click", "Bing ad click"): continue
        chn = "Google Ads" if ch.startswith("Google") else "Bing Ads"
        k = (d, chn, x["campaign"], x.get("keyword"))
        if k in ms: ms[k]["clicks"] += x.get("n", 1); continue
        cname = GCAMP.get(nk(x["campaign"]), x["campaign"].replace("+", " "))
        row = {"date": d, "channel": chn, "campaign": cname, "adGroup": None, "headlines": [], "keyword": x.get("keyword"), "landing": x.get("page"), "clicks": x.get("n", 1)}
        for a_ in agent_paid:
            if a_["date"] == d and a_["channel"] == chn:
                m = re.search(r"(\d{9,})", a_.get("ad") or ""); gg = GAD.get(m.group(1)) if m else None
                if gg: row.update(adGroup=gg["adGroup"], headlines=gg["headlines"])
                row["landing"] = row["landing"] or a_.get("landing_page"); row["keyword"] = row["keyword"] or a_.get("keyword")
        ms[k] = row
    search = sorted(ms.values(), key=lambda x: x["date"])
    if li_month and not li:      # Factors had no LinkedIn detail: campaign from the Windsor company report by campaign
        for cname, comp in LIC.items():
            n_ = sum(v for k, v in comp.items() if norm(k) in {norm(x) for x in ORG[r]["names"]} or any(norm(x).startswith(norm(k)) for x in ORG[r]["names"]))
            if n_:
                pool = LCAMP.get(cname, []); act = [x for x in pool if x["active"]] or pool
                li.append({"date": "2026-10-00", "campaign": cname, "ads": [{k: x[k] for k in ("id", "title", "thumb")} for x in act][:6], "exactAd": False, "group": "Awareness", "clicks": n_, "landing": None})
    ml = {}
    for x in li:
        k = (x["date"], x["campaign"])
        if k in ml: ml[k]["clicks"] += x["clicks"]; ml[k]["landing"] = ml[k]["landing"] or x["landing"]
        else: ml[k] = dict(x)
    li = sorted(ml.values(), key=lambda x: x["date"])
    emails = sorted({(d, x["type"]) for d, ch, x in ev if ch == "Email click"})
    # which marketing email was clicked: Factors records the email name for clicks it can see (last 180 days)
    enames = [e for e in f.get("email_clicks", []) if not SENC.search(e.get("email") or "")]
    def ename(d):
        for e in enames:
            if e.get("date") and abs((dt.date.fromisoformat(e["date"]) - dt.date.fromisoformat(d)).days) <= 1: return e.get("email"), e.get("link")
        return None, None
    # which 1:1 email was clicked: the template email Boldt sent most recently before the click (Factors, last 180 days).
    # Only known sequence templates are shown; one-off subject lines can carry people's names.
    def oneone(d):
        best = None
        for t in f.get("sales_touches", []):
            sj = TEMPLATE(t.get("subject"))
            if t.get("type") == "1:1 email" and sj and t.get("date") and t["date"] <= d and (dt.date.fromisoformat(d) - dt.date.fromisoformat(t["date"])).days <= 14:
                if not best or t["date"] > best[1]: best = (sj, t["date"])
        return best or (None, None)
    visits = []
    for v in f.get("page_visits", []):
        if not v.get("date", "").startswith("2026-10"): continue
        pg = [p for p in (v.get("pages") or []) if isinstance(p, str) and not SENC.search(p)]
        if pg or v.get("source"): visits.append({"date": v["date"], "source": v.get("source"), "pages": pg[:4]})
    visits.sort(key=lambda v: v["date"])
    imps = []
    for i in f.get("impression_campaigns", []):
        if re.search(r"senior", i.get("campaign", ""), re.I): continue
        imps.append({"campaign": camp(i["campaign"]) or i["campaign"].strip(), "group": camp_group(i["campaign"]), "views": i.get("views", 0), "last": i.get("last_date")})
    # first touch in October: exact dates where we have them, week start for website, month for LinkedIn without a Factors date
    cands = [(x["date"], x["channel"].replace(" Ads", "") + " ad click", "day") for x in search] + [(x["date"], "LinkedIn ad click", "day") for x in li if not x["date"].endswith("-00")] + \
            [(d, "Email click", "day") for d, t in emails] + [(w["start"], "Website visit", "week") for w in web]
    if li_month and not any(not x["date"].endswith("-00") for x in li): cands.append(("2026-10-01", "LinkedIn ad click", "month"))
    first = min(cands, key=lambda c: (c[0], c[2] != "day")) if cands else (ev[0][0], ev[0][1], "day")
    lcands = cands + [(v["date"], "Website visit", "day") for v in visits]
    last = max(lcands, key=lambda c: (c[0], c[2] == "day")) if lcands else first
    last = {"date": last[0], "label": {"day": dl(last[0]), "week": "Week of " + dl(last[0]), "month": "October"}[last[2]], "channel": last[1], "precision": last[2]}
    chans = sorted({ch for d, ch, x in ev})
    companies.append({
        "name": sorted(ORG[r]["names"], key=len)[0], "domain": r, "hubspotId": ORG[r]["ids"].get(sorted(ORG[r]["names"], key=len)[0]), "first": {"date": first[0], "label": {"day": dl(first[0]), "week": "Week of " + dl(first[0]), "month": "October"}[first[2]], "channel": first[1], "precision": first[2]},
        "channels": chans, "web": web, "pages": [p for p in f.get("top_pages", [])[:4] if isinstance(p, str)],
        "liClicksMonth": li_month, "li": li, "search": search,
        "email": [dict(zip(("date", "label", "type", "name", "link"), (d, dl(d), t) + (ename(d) if t == "Marketing email" else (None, None))), **({"name": oneone(d)[0], "sent": oneone(d)[1]} if t == "1:1 email" else {})) for d, t in emails],
        "visits": visits,
        "last": last,
        "impressions": sorted(imps, key=lambda x: -x["views"])[:6],
    })
companies.sort(key=lambda c: (c["first"]["precision"] == "month", c["first"]["date"], c["name"]))
out["companies"] = companies
out["missingFactors"] = [r for r in new if r not in FA]
json.dump(out, open("def_mql_oct.json", "w"), indent=1)
print("companies", len(companies), "without Factors detail", len(out["missingFactors"]))
