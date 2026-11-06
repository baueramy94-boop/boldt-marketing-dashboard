"""Month-to-date New MQL companies, in the same shape as defMql.companies, for the toggle on Leads.
usage: python3 pipeline/mtd/build_mtd.py 2026-11 2026-11-08            -> public/data/mtd.json
       python3 pipeline/mtd/build_mtd.py 2026-11 2026-11-30 --finalize -> also folds the month into state/history.json
Same rules as scripts/build_definition_mqls.py: a healthcare company in HubSpot (by root domain; senior living and Boldt's
own domains excluded) with a website visit, a LinkedIn, Google or Bing ad click, or an email click in the month, and no
engagement in the 12 months before. Inputs: state/orgs.json, state/history.json and in/<month>/ (see collect.py)."""
import json, re, sys, os, datetime as dt, calendar
from collections import defaultdict
M, THRU = sys.argv[1], sys.argv[2]
FINAL = "--finalize" in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = os.path.abspath(os.path.join(HERE, "..", ".."))
S = lambda n: os.path.join(HERE, "state", n)
I = lambda n, d=None: json.load(open(os.path.join(HERE, "in", M, n))) if os.path.exists(os.path.join(HERE, "in", M, n)) else d
ORGS = json.load(open(S("orgs.json"))); HIST = json.load(open(S("history.json")))
y, mo = int(M[:4]), int(M[5:7]); MONTH = calendar.month_name[mo]
W = (f"{M}-01", THRU)

def root(d):
    d = (d or "").lower().strip().removeprefix("http://").removeprefix("https://").split("/")[0].removeprefix("www.")
    p = d.split("."); return ".".join(p[-2:]) if len(p) >= 2 else d
SENIOR = re.compile(r"senior|retirement|assisted living|memory care|brookdale|erickson|sunrise|life ?plan|\bliving\b|nursing home|skilled nursing", re.I)
HC_IND = {"HOSPITAL_HEALTH_CARE", "MEDICAL_PRACTICE", "HEALTH_WELLNESS_AND_FITNESS", "MENTAL_HEALTH_CARE", "Medical & Surgical Hospitals",
          "Hospitals & Physicians Clinics", "MEDICAL_DEVICES", "PHARMACEUTICALS"}
HC_NAME = re.compile(r"health|hospital|medical|medicine|clinic|children'?s|physician|surg|rehab|behavioral|care\b|healthcare|cancer|orthop|pediatric|baptist|mercy|methodist|adventist", re.I)
OWN = {"boldt.com", "theboldtcompany.com"}
import hashlib
hsh = lambda v: hashlib.sha256(("boldt-mtd|" + v).encode()).hexdigest()[:16]   # the repo is public: state keeps hashes only
def norm(s):
    s = re.sub(r"[​®]", "", (s or "").lower()).replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s); s = re.sub(r"\b(the|inc|llc|corp|corporation|co)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()
ROOTS = set(ORGS["roots"]); NAMES = defaultdict(set, {k: set(v) for k, v in ORGS["names"].items()}); PREF = defaultdict(set, {k: set(v) for k, v in ORGS["prefix"].items()})
def is_hc(nm, ind):
    if SENIOR.search(nm or "") and not re.search(r"hospital|health system|medical center", nm or "", re.I): return False
    return ind in HC_IND or bool(HC_NAME.search(nm or ""))
PLAIN = {}   # root hash -> {"root", "name", "id"} from HubSpot lookups and last week's list
for cid, c in (I("hs_companies.json", {}) or {}).items():
    r = root(c.get("domain"))
    if not r or r in OWN: continue
    rk = hsh(r)
    if str(c.get("createdate") or "")[:7] >= M and is_hc(c.get("name"), c.get("industry")) and rk not in ROOTS:   # created this month: join the list
        ROOTS.add(rk); k = norm(c["name"]); NAMES[hsh(k)].add(rk); w = k.split()
        for i in range(2, len(w)): PREF[hsh(" ".join(w[:i]))].add(rk)
    if rk in ROOTS:
        o = PLAIN.setdefault(rk, {"root": r, "name": c.get("name"), "id": str(cid)})
        if c.get("name") and len(c["name"]) < len(o["name"] or "~" * 999): o.update(name=c["name"], id=str(cid))
PREV = os.path.join(SITE, "public", "data", "mtd.json")
if os.path.exists(PREV):
    for c in json.load(open(PREV)).get("companies", []):
        PLAIN.setdefault(hsh(c["domain"]), {"root": c["domain"], "name": c["name"], "id": c.get("hubspotId")})
BAD_FUZZY = {"Saint Luke's", "Indiana University Health", "Methodist Healthcare System", "HCA Houston Healthcare", "UNC Health Johnston"}
def li_org(nm):
    if not nm or SENIOR.search(nm): return None
    n = norm(nm); hit = NAMES.get(hsh(n)); w = n.split()
    if not hit and len(w) >= 2 and nm not in BAD_FUZZY:     # LinkedIn name is the start of a HubSpot name, or the reverse
        cand = set(PREF.get(hsh(n), set()))
        for i in range(2, len(w)): cand |= NAMES.get(hsh(" ".join(w[:i])), set())
        hit = cand if 0 < len(cand) <= 3 else None
    return sorted(hit)[0] if hit else None
ROOT_OF = {}   # root hash -> plain root domain, from this month's rows
def org(d):
    r = root(d); rk = hsh(r) if r and r not in OWN else None
    if rk in ROOTS: ROOT_OF[rk] = r; return rk
    return None
LI_NAMES = defaultdict(set)
events = defaultdict(list)
for k, rows in (I("visits.json", {}) or {}).items():
    a, b = k.split(":")
    for d, v in rows.items():
        r = org(d)
        if r: events[r].append((a, "Website visit", {"end": b, "sessions": v[2]}))
LIT = defaultdict(int)
for nm, n in (I("li.json", {}) or {}).items(): LIT[nm] = max(LIT[nm], n)
LIC = defaultdict(dict)   # org -> campaign -> clicks
byc = defaultdict(int)
for x in I("li_campaign.json", []) or []:
    byc[x["co"]] += x["clicks"]; r = li_org(x["co"])
    if r: LI_NAMES[r].add(x["co"])
    if r: LIC[r][x["campaign"]] = LIC[r].get(x["campaign"], 0) + x["clicks"]
for nm, n in byc.items(): LIT[nm] = max(LIT[nm], n)     # LinkedIn's company total and campaign split use different thresholds
for nm, n in LIT.items():
    r = li_org(nm)
    if r and n: events[r].append((M + "-01", "LinkedIn ad click", {"clicks": n})); LI_NAMES[r].add(nm)
for e in I("email.json", []) or []:
    r = org(e["domain"])
    if not r: continue
    for f in ("first", "last"):
        if e.get(f) and W[0] <= e[f][:10] <= W[1]: events[r].append((e[f][:10], "Email click", {"type": "Marketing email"}))
for e in I("sales_email.json", []) or []:
    r = org(e["domain"])
    if r and e.get("date") and W[0] <= e["date"] <= W[1]: events[r].append((e["date"], "Email click", {"type": "1:1 email"}))
SENC = re.compile(r"senior|demandgen", re.I)
BING = [x for x in I("bing.json", []) or [] if x.get("source") == "bing" and x.get("campaign") and not SENC.search(x["campaign"]) and not SENC.search(x.get("page") or "") and not SENC.search(x.get("keyword") or "")]
bkey = {(org(x["domain"]), x["date"]) for x in BING}
for x in BING:
    r = org(x["domain"])
    if r: events[r].append((x["date"], "Bing ad click", {"campaign": x["campaign"], "keyword": None if x["keyword"] in ("$none", None) else x["keyword"], "page": x.get("page")}))
for x in I("google.json", []) or []:
    c = x["campaign"]
    if not c or c == "$none" or SENC.search(c) or SENC.search(x.get("keyword") or ""): continue
    r = org(x["domain"])
    if not r or (r, x["date"]) in bkey: continue
    events[r].append((x["date"], "Google ad click", {"campaign": c, "keyword": None if x["keyword"] in ("$none", None) else x["keyword"], "n": x.get("n", 1)}))
for r in events: events[r] = [e for e in events[r] if W[0] <= e[0] <= W[1]]

def mshift(m, k):
    yy, mm = int(m[:4]), int(m[5:7]) + k
    while mm < 1: yy, mm = yy - 1, mm + 12
    while mm > 12: yy, mm = yy + 1, mm - 12
    return f"{yy}-{mm:02d}"
P0, P1 = mshift(M, -12), mshift(M, -1)
H = HIST["orgs"]
def prior(r): return any(P0 <= m <= P1 and sum(v) for m, v in H.get(r, {}).items())
def month_vals(r):
    w = l = e_ = s_ = 0; seen = set()
    for d, ch, x in events[r]:
        if ch == "Website visit": w += x.get("sessions") or 0
        elif ch == "LinkedIn ad click": l += x.get("clicks", 0)
        elif ch == "Email click":
            if (d, x.get("type")) in seen: continue
            seen.add((d, x.get("type"))); e_ += 1
        else: s_ += x.get("n", 1) if ch == "Google ad click" else 1
    return [w, l, e_, s_]
active = sorted(r for r in list(events) if events[r])
new = sorted(r for r in active if not prior(r))

# ---- company detail: same build as the monthly report ----
FA = I("factors.json", {}) or {}
ARCH = json.load(open(os.path.join(SITE, "public", "data", "ads-archive.json")))
GAD, LAD, LCAMP = {}, {}, {}
for c in ARCH.get("google", []):
    for g in c.get("adGroups", []):
        for a in g.get("ads", []): GAD[str(a.get("id"))] = {"campaign": c["campaign"], "adGroup": g["adGroup"], "headlines": a.get("headlines", [])[:3]}
for g in ARCH.get("linkedin", []):
    for c in g.get("campaigns", []):
        ads = [{"id": str(a["id"]), "title": a.get("title") or "", "thumb": a.get("thumb") or "", "active": a.get("status") == "ACTIVE"} for a in c.get("ads", [])]
        for a in ads: LAD[a["id"]] = dict(a, campaign=c["campaign"])
        LCAMP.setdefault(re.sub(r"\s*\|\s*2026\s*$", "", c["campaign"]).replace("Awareness | Healthcare | ", "").strip(), []).extend(ads)
nk = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
GCAMP = {nk(c["campaign"]): c["campaign"] for c in ARCH.get("google", [])}
TEMPLATES = {"Choosing the Right Real Estate Partner", "Low-Cost Real Estate Strategy", "Open Book Transparency: A Better Way to Deliver Healthcare Real Estate"}
def _strip(sj): return re.sub(r"^((re|fw|fwd)\s*:\s*)+", "", (sj or "").strip(), flags=re.I).strip()
from collections import Counter
_seen = Counter()
for _d, _f in FA.items():
    for _s in {_strip(t.get("subject")) for t in _f.get("sales_touches", []) if t.get("subject")}: _seen[_s] += 1
def TEMPLATE(sj):
    s_ = _strip(sj); return s_ if s_ and (s_ in TEMPLATES or _seen[s_] >= 2) else None
MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
def dl(d): return f"{MONS[int(d[5:7]) - 1]} {int(d[8:10])}"
def camp(s):
    s = re.sub(r"^\d+-", "", (s or "").strip()); s = re.sub(r"\s*\([A-Z][a-z]{2} \d{1,2}\)$", "", s)
    while s.startswith("Awareness | Healthcare | Awareness | Healthcare"): s = s[len("Awareness | Healthcare | "):]
    s = re.sub(r"\s*\|\s*2026\s*$", "", s); s = s.replace("Awareness | Healthcare | ", "").replace("Lead Generation | Healthcare | ", "")
    return re.sub(r"\s+", " ", s.replace("—", "-").replace("–", "-")).strip(" |")
def camp_group(s): return "Awareness" if s.startswith("Awareness") else "Lead generation" if s.startswith("Lead Gen") else ""
def inM(d): return bool(d) and W[0] <= d[:10] <= W[1]
def nice(c): return GCAMP.get(nk(c), (c or "").replace("+", " "))

companies = []; lookup = {"domains": [], "names": []}
for rk in new:
    pl = PLAIN.get(rk, {}); r = ROOT_OF.get(rk) or pl.get("root")
    if not r or not pl.get("name"):          # needs a HubSpot lookup for its name and record
        if r: lookup["domains"].append(r)
        else: lookup["names"].extend(sorted(LI_NAMES.get(rk, [])))
        continue
    ev = sorted(events[rk], key=lambda e: e[0]); f = FA.get(r, {}); nm0 = pl["name"]
    web = {}
    for d, ch, x in ev:
        if ch == "Website visit":
            w = web.setdefault(d, {"start": d, "end": x["end"], "sessions": 0}); w["sessions"] += x.get("sessions") or 0
    web = [{"week": dl(w["start"]) + (" to " + dl(w["end"]) if w["end"] != w["start"] else ""), "start": w["start"], "sessions": w["sessions"]} for w in sorted(web.values(), key=lambda w: w["start"])]
    li_month = sum(x.get("clicks", 0) for d, ch, x in ev if ch == "LinkedIn ad click")
    li = []
    for a in f.get("clicked_ads", []):
        if not inM(a.get("date")) or re.search(r"senior", json.dumps(a), re.I) or a["channel"] != "LinkedIn ad click": continue
        aid = (a.get("ad") or "").strip()
        if aid.isdigit() and aid in LAD:
            nm = camp(a.get("campaign")) or camp(LAD[aid]["campaign"]); ads = [{k: LAD[aid][k] for k in ("id", "title", "thumb")}]; exact = True
        else:
            nm = camp(a.get("ad") or a.get("campaign")); pool = LCAMP.get(nm, []); act = [x for x in pool if x["active"]] or pool
            ads = [{k: x[k] for k in ("id", "title", "thumb")} for x in act][:6]; exact = False
        li.append({"date": a["date"], "campaign": nm, "ads": ads, "exactAd": exact, "group": camp_group(a.get("campaign") or a.get("ad") or ""), "clicks": a.get("clicks") or 1, "landing": a.get("landing_page")})
    agent_paid = [a for a in f.get("clicked_ads", []) if a.get("channel") in ("Google Ads", "Bing Ads") and inM(a.get("date"))]
    ms = {}
    for d, ch, x in ev:
        if ch not in ("Google ad click", "Bing ad click"): continue
        chn = "Google Ads" if ch.startswith("Google") else "Bing Ads"; k = (d, chn, x["campaign"], x.get("keyword"))
        if k in ms: ms[k]["clicks"] += x.get("n", 1); continue
        row = {"date": d, "channel": chn, "campaign": nice(x["campaign"]), "adGroup": None, "headlines": [], "keyword": x.get("keyword"), "landing": x.get("page"), "clicks": x.get("n", 1)}
        for a_ in agent_paid:
            if a_["date"] == d and a_["channel"] == chn:
                mm = re.search(r"(\d{9,})", a_.get("ad") or ""); gg = GAD.get(mm.group(1)) if mm else None
                if gg: row.update(adGroup=gg["adGroup"], headlines=gg["headlines"])
                row["landing"] = row["landing"] or a_.get("landing_page"); row["keyword"] = row["keyword"] or a_.get("keyword")
        ms[k] = row
    search = sorted(ms.values(), key=lambda x: x["date"])
    if li_month and not li:      # no Factors detail: campaign from the Windsor company report by campaign
        for cname, n_ in LIC.get(rk, {}).items():
            short = camp(cname); pool = LCAMP.get(short, []); act = [x for x in pool if x["active"]] or pool
            li.append({"date": M + "-00", "campaign": short, "ads": [{k: x[k] for k in ("id", "title", "thumb")} for x in act][:6], "exactAd": False, "group": camp_group(cname), "clicks": n_, "landing": None})
    ml = {}
    for x in li:
        k = (x["date"], x["campaign"])
        if k in ml: ml[k]["clicks"] += x["clicks"]; ml[k]["landing"] = ml[k]["landing"] or x["landing"]
        else: ml[k] = dict(x)
    li = sorted(ml.values(), key=lambda x: x["date"])
    emails = sorted({(d, x["type"]) for d, ch, x in ev if ch == "Email click"})
    enames = [e for e in f.get("email_clicks", []) if not SENC.search(e.get("email") or "")]
    def ename(d):
        for e in enames:
            if e.get("date") and abs((dt.date.fromisoformat(e["date"]) - dt.date.fromisoformat(d)).days) <= 1: return e.get("email"), e.get("link")
        return None, None
    def oneone(d):
        best = None
        for t in f.get("sales_touches", []):
            sj = TEMPLATE(t.get("subject"))
            if t.get("type") == "1:1 email" and sj and t.get("date") and t["date"] <= d and (dt.date.fromisoformat(d) - dt.date.fromisoformat(t["date"])).days <= 14:
                if not best or t["date"] > best[1]: best = (sj, t["date"])
        return best or (None, None)
    visits = []
    for v in f.get("page_visits", []):
        if not inM(v.get("date")): continue
        pg = [p for p in (v.get("pages") or []) if isinstance(p, str) and not SENC.search(p)]
        if pg or v.get("source"): visits.append({"date": v["date"], "source": v.get("source"), "pages": pg[:4]})
    visits.sort(key=lambda v: v["date"])
    imps = [{"campaign": camp(i["campaign"]) or i["campaign"].strip(), "group": camp_group(i["campaign"]), "views": i.get("views", 0), "last": i.get("last_date")}
            for i in f.get("impression_campaigns", []) if not re.search(r"senior", i.get("campaign", ""), re.I)]
    cands = [(x["date"], x["channel"].replace(" Ads", "") + " ad click", "day") for x in search] + [(x["date"], "LinkedIn ad click", "day") for x in li if not x["date"].endswith("-00")] + \
            [(d, "Email click", "day") for d, t in emails] + [(w["start"], "Website visit", "week") for w in web]
    if li_month and not any(not x["date"].endswith("-00") for x in li): cands.append((M + "-01", "LinkedIn ad click", "month"))
    first = min(cands, key=lambda c: (c[0], c[2] != "day")) if cands else (ev[0][0], ev[0][1], "day")
    lc = cands + [(v["date"], "Website visit", "day") for v in visits]
    last = max(lc, key=lambda c: (c[0], c[2] == "day")) if lc else first
    lab = lambda c: {"day": dl(c[0]), "week": "Week of " + dl(c[0]), "month": MONTH}[c[2]]
    # month by month since the first tracked engagement: history counts, then this month
    hm = sorted(m for m, v in H.get(rk, {}).items() if sum(v))
    tl = []
    if hm:
        k = hm[0]
        while k < M:
            v = H[rk].get(k, [0, 0, 0, 0]); tl.append([k, v[0], v[1], v[2], v[3], []]); k = mshift(k, 1)
    mv = month_vals(rk); tl.append([M, mv[0], mv[1], mv[2], mv[3], []])
    companies.append({
        "name": nm0, "domain": r, "hubspotId": pl.get("id"),
        "first": {"date": first[0], "label": lab(first), "channel": first[1], "precision": first[2]},
        "channels": sorted({ch for d, ch, x in ev}), "web": web, "pages": [p for p in f.get("top_pages", [])[:4] if isinstance(p, str)],
        "liClicksMonth": li_month, "li": li, "search": search,
        "email": [dict(zip(("date", "label", "type", "name", "link"), (d, dl(d), t) + (ename(d) if t == "Marketing email" else (None, None))), **({"name": oneone(d)[0], "sent": oneone(d)[1]} if t == "1:1 email" else {})) for d, t in emails],
        "visits": visits, "last": {"date": last[0], "label": lab(last), "channel": last[1], "precision": last[2]},
        "impressions": sorted(imps, key=lambda x: -x["views"])[:6], "tl": tl,
    })
companies.sort(key=lambda c: (c["first"]["precision"] == "month", c["first"]["date"], c["name"]))
bych = defaultdict(int)
for c in companies:
    for ch in c["channels"]: bych[ch] += 1
out = {"month": M, "through": THRU, "asOf": dt.date.today().isoformat(), "newCount": len(companies), "activeCount": len(active), "newByChannel": dict(bych),
       "listNote": f"{MONTH} so far, through {dl(THRU)}. Refreshed every Monday morning, so the list grows through the month and the final count comes with the monthly report. LinkedIn reports clicks by company for each campaign, not for each ad, and its company data arrives a few days late. Website visits are counted by week, so the most recent date for a visit is the start of that week.",
       "domainNote": "Parent and child companies that share one website domain, such as a health system and its hospitals, can't always be told apart, so their activity may be combined. We're working through this with Factors.",
       "missingFactors": [c["domain"] for c in companies if c["domain"] not in FA], "companies": companies}
json.dump(out, open(os.path.join(SITE, "public", "data", "mtd.json"), "w"), separators=(",", ":"), ensure_ascii=False)
if FINAL:
    for r in active:
        v = month_vals(r)
        if sum(v): H.setdefault(r, {})[M] = v
    HIST["through"] = max(HIST["through"], M)
    json.dump(HIST, open(S("history.json"), "w"), separators=(",", ":"))
    ORGS.update(roots=sorted(ROOTS), names={k: sorted(v) for k, v in NAMES.items()}, prefix={k: sorted(v) for k, v in PREF.items()})
    json.dump(ORGS, open(S("orgs.json"), "w"), separators=(",", ":"))
json.dump(lookup, open(os.path.join(HERE, "in", M, "lookup.json"), "w"), indent=1)
print(M, "through", THRU, "| engaged", len(active), "| new", len(new), "| listed", len(companies), "| without Factors detail", len(out["missingFactors"]), "| finalized" if FINAL else "")
if lookup["domains"] or lookup["names"]: print("LOOKUP NEEDED (HubSpot companies):", json.dumps(lookup))
print("new:", [c["name"] for c in companies])
