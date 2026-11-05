"""October 2026 MQLs by Boldt's definition: a company in HubSpot that actively engaged in the past 12 months.
Active engagement = website visit (Factors, includes visits from ad clicks), LinkedIn ad click (LinkedIn company data),
marketing email click (HubSpot). Counted by organization (unique domain). Healthcare only."""
import json, re, datetime as dt
from collections import defaultdict

HS = json.load(open("hs_companies.json"))
V = json.load(open("visits.json"))
LI = json.load(open("li_clicks.json"))
EM = json.load(open("email_clicks.json"))

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
    o = ORG.setdefault(r, {"names": set(), "ind": set()})
    o["names"].add(c["name"] or ""); o["ind"].add(c["industry"] or "")
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
        if r in ORG: events[r].append((start, "Website visit"))
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
            events[key].append((m + "-01", "LinkedIn ad click"))
        else: unmatched.append(nm)
# marketing email clicks (HubSpot contact last/first click)
for e in EM:
    r = root(e["domain"])
    if r not in ORG: continue
    for f in ("first", "last"):
        if e[f]: events[r].append((e[f][:10], "Marketing email click"))

def active(r, a, b): return [ch for d, ch in events[r] if a <= d <= b]
W_OCT = ("2026-10-01", "2026-10-31")
W_12 = ("2025-11-01", "2026-10-31")          # 12 months through October
W_PRIOR = ("2025-10-01", "2026-09-30")       # 12 months before October

total = sorted(r for r in HC if active(r, *W_12))
octa = sorted(r for r in HC if active(r, *W_OCT))
new = sorted(r for r in octa if not active(r, *W_PRIOR))
known_oct_any = sorted(r for r in ORG if active(r, *W_OCT) and any(ch == "Website visit" for ch in active(r, *W_OCT)))

def bych(rs, w):
    c = defaultdict(int)
    for r in rs:
        for ch in set(active(r, *w)): c[ch] += 1
    return dict(c)

out = {
    "month": "2026-10",
    "definition": "HubSpot companies (healthcare) with a website visit, LinkedIn ad click or marketing email click. Counted by organization.",
    "total12": len(total), "activeOct": len(octa), "newOct": len(new),
    "totalByChannel": bych(total, W_12), "octByChannel": bych(octa, W_OCT), "newByChannel": bych(new, W_OCT),
    "check_websiteKnownAll_Oct": len(known_oct_any),
    "newNames": [sorted(ORG[r]["names"], key=len)[0] for r in new],
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
