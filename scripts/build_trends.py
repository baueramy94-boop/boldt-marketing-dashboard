"""Day-of-week and location trends for the Leads & accounts tab, plus first outreach to SQL.
Day of week: dated engagements by healthcare HubSpot companies, January to October 2026 (Google and Bing ad visits,
email clicks), and HubSpot companies on the site per day in October (Factors). LinkedIn clicks are monthly and website
visits weekly in the source data, so they can't be placed on a day.
Locations: HubSpot company state for the engaged companies (hs_state.json, from HubSpot company records)."""
import json, io, contextlib, runpy, datetime as dt, statistics
from collections import Counter, defaultdict
with contextlib.redirect_stdout(io.StringIO()):
    G = runpy.run_path("compute.py", run_name="lib")
ORG, HC, events, active, new = G["ORG"], G["HC"], G["events"], G["active"], G["new"]
SC = "/tmp/claude-0/-home-claude/95ce0a98-4263-51ce-817f-f46684818c9e/scratchpad/"
ST = json.load(open("hs_state.json")) if __import__("os").path.exists("hs_state.json") else json.load(open(SC + "hs_state.json"))
json.dump(ST, open("hs_state.json", "w"))
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# engagements by weekday (one per company per day per channel)
seen = set(); wd = Counter(); wdc = defaultdict(Counter)
for r in HC:
    for d, ch, _ in events[r]:
        if ch not in ("Google ad click", "Bing ad click", "Email click") or not ("2026-01-01" <= d <= "2026-10-31") or len(d) != 10: continue
        k = (r, d, ch)
        if k in seen: continue
        seen.add(k)
        w = dt.date.fromisoformat(d).weekday(); wd[w] += 1
        wdc["Ad visit" if ch != "Email click" else "Email click"][w] += 1
D = json.load(open("/home/claude/site/public/data/2026-10.json"))
kv = D["accounts"]["knownVisitsDaily"]; kvw = defaultdict(list)
for i, x in enumerate(kv):
    kvw[dt.date(2026, 10, i + 1).weekday()].append(x["count"])
dow = {"days": DAYS, "engagements": [wd[i] for i in range(7)], "ads": [wdc["Ad visit"][i] for i in range(7)], "emails": [wdc["Email click"][i] for i in range(7)],
       "total": sum(wd.values()), "visitsAvg": [round(sum(kvw[i]) / len(kvw[i]), 1) for i in range(7)], "visitDays": [len(kvw[i]) for i in range(7)]}
# locations
AB = {"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","DC":"District of Columbia","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming"}
REG = {"Northeast": "CT ME MA NH RI VT NJ NY PA", "Midwest": "IL IN MI OH WI IA KS MN MO NE ND SD", "South": "DE DC FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX", "West": "AZ CO ID MT NV NM UT WY AK CA HI OR WA"}
FULL2AB = {v.lower(): k for k, v in AB.items()}
def norm(s):
    s = (s or "").strip()
    if not s: return None
    if s.upper() in AB: return s.upper()
    return FULL2AB.get(s.lower())
def state_of(r):
    for cid in ORG[r]["ids"].values():
        a = norm(ST.get(str(cid)))
        if a: return a
    return None
ytd = [r for r in HC if active(r, "2026-01-01", "2026-10-31")]
octa = [r for r in HC if active(r, "2026-10-01", "2026-10-31")]
def tally(rs):
    c = Counter(state_of(r) for r in rs); unk = c.pop(None, 0)
    reg = Counter(next(k for k, v in REG.items() if s in v.split()) for s in c.elements())
    return {"states": [{"state": AB[s], "ab": s, "n": n} for s, n in c.most_common()], "regions": dict(reg.most_common()), "unknown": unk, "n": len(rs)}
loc = {"ytd": tally(ytd), "oct": tally(octa), "new": tally(new)}
# first sales outreach (1:1 email or call) to SQL, from HubSpot contact "Date of first engagement" (current owner's first email or call)
FO = {"15435138629": None, "899383144": "2023-08-22", "8951594558": "2023-04-14", "31827969937": "2020-05-22", "31397850217": "2026-03-13",
      "15456693784": "2024-09-18", "4488672133": "2021-11-16", "4488347829": "2022-03-14", "8951638595": "2026-02-18", "4488671630": "2022-05-12",
      "52068957248": "2022-01-19", "4519570116": "2022-07-11", "15274058851": "2023-04-11", "25107555942": "2024-11-05"}
FOT = {"25107555942": "call"}
S = D["sqlJourneys"]["companies"]; gaps = []
for c in S:
    f = FO.get(str(c["hubspotId"]))
    if not f: continue
    m = (dt.date.fromisoformat(c["sql"]) - dt.date.fromisoformat(f)).days / 30.44
    gaps.append(m); c["firstOutreach"] = {"date": f, "type": FOT.get(str(c["hubspotId"]), "1:1 email"), "months": round(m)}
out_s = {"n": len(gaps), "of": len(S), "medianMonths": round(statistics.median(gaps)), "minMonths": round(min(gaps)), "maxMonths": round(max(gaps)),
         "within12": sum(1 for g in gaps if g <= 12), "byEmail": sum(1 for c in S if c.get("firstOutreach", {}).get("type") == "1:1 email"),
         "byCall": sum(1 for c in S if c.get("firstOutreach", {}).get("type") == "call")}
# --- all sources by weekday (Jan to Oct 2026) ---
SRC = json.load(open("/home/claude/dashboard/trends/dow_sources.json"))
bing = Counter(dt.date.fromisoformat(x["date"]).weekday() for x in G["BING"] if "2026-01-01" <= x["date"] <= "2026-10-31")
rows_all = [
    {"k": "LinkedIn ad clicks", "src": "LinkedIn, healthcare campaigns", "v": SRC["linkedin"]},
    {"k": "Google ad clicks", "src": "Google Ads, healthcare campaigns", "v": SRC["google"]},
    {"k": "Bing ad visits", "src": "Factors, from September", "v": [bing[i] for i in range(7)]},
    {"k": "Website sessions", "src": "GA4, senior living pages excluded", "v": SRC["ga4"]},
    {"k": "Email clicks", "src": "HubSpot, healthcare companies", "v": [wdc["Email click"][i] for i in range(7)]},
    {"k": "HubSpot companies on the site", "src": f"Factors, average per day in October", "v": dow["visitsAvg"]},
]
for r_ in rows_all:
    t = sum(r_["v"]) or 1; r_["share"] = [round(x / t * 100, 1) for x in r_["v"]]; r_["total"] = round(sum(r_["v"]), 1)
avg = [round(sum(r_["share"][i] for r_ in rows_all) / len(rows_all), 1) for i in range(7)]
dow["all"] = {"rows": rows_all, "avgShare": avg}
# --- new MQLs by source, month by month ---
CHS = ["Website visit", "LinkedIn ad click", "Google ad click", "Bing ad click", "Email click"]
import calendar
nbs = {ch: [] for ch in CHS}; nmon = []
for mth in range(1, 11):
    a_ = f"2026-{mth:02d}-01"; b_ = f"2026-{mth:02d}-{calendar.monthrange(2026, mth)[1]}"
    pa = dt.date(2025, mth, 1).isoformat(); pb = (dt.date(2026, mth, 1) - dt.timedelta(days=1)).isoformat()
    nn = [r for r in HC if active(r, a_, b_) and not active(r, pa, pb)]
    nmon.append(len(nn))
    for ch in CHS: nbs[ch].append(sum(1 for r in nn if ch in active(r, a_, b_)))
newBySource = {"months": 10, "total": nmon, "bySource": nbs}
# per-company lists so the page can drop companies Amy removes from the counts
newYtd = []
for mth in range(1, 11):
    a_ = f"2026-{mth:02d}-01"; b_ = f"2026-{mth:02d}-{calendar.monthrange(2026, mth)[1]}"
    pa = dt.date(2025, mth, 1).isoformat(); pb = (dt.date(2026, mth, 1) - dt.timedelta(days=1)).isoformat()
    for r in HC:
        if active(r, a_, b_) and not active(r, pa, pb) and r not in {x[0] for x in newYtd}:
            newYtd.append([r, mth, sorted(set(active(r, a_, b_)) & set(CHS))])
lists = {"newYtd": newYtd, "engagedYtd": sorted(r for r in HC if active(r, "2026-01-01", "2026-10-31")), "activeOct": sorted(r for r in HC if active(r, "2026-10-01", "2026-10-31"))}
# --- hot MQLs: 5+ engagements or a contact page visit in the 12 months through October ---
import glob as _g
W12 = ("2025-11-01", "2026-10-31")
contact = set()
for f in _g.glob("/home/claude/dashboard/accounts/details/*.json"):
    for nm, dom, ind, ch, url, t_, n_ in json.load(open(f))["rows"]:
        if "/contact" in (url or ""): contact.add(G["root"](dom))
for f in ("factors_v3.json", "factors_new.json", "/home/claude/dashboard/sql/factors_sql.json"):
    for d_, v_ in json.load(open(f)).items():
        if "/contact" in json.dumps(v_.get("page_visits", []) + v_.get("top_pages", [])).lower(): contact.add(G["root"](d_))
newset = set(new); hot = []
for r in HC:
    s_ = li_ = 0; emd = set(); gb = 0; last = ""
    for d_, ch, x in events[r]:
        if not (W12[0] <= d_ <= W12[1]): continue
        last = max(last, d_)
        if ch == "Website visit": s_ += x.get("sessions") or 0
        elif ch == "LinkedIn ad click": li_ += x.get("clicks", 0)
        elif ch == "Email click": emd.add((d_, x.get("type")))
        elif ch in ("Google ad click", "Bing ad click"): gb += 1
    tot = s_ + li_ + len(emd); cp = r in contact
    if tot >= 15 or (cp and tot):
        nm = sorted(ORG[r]["names"], key=len)[0]
        MO = [f"{y}-{m:02d}" for y, m in [(2025, 11), (2025, 12)] + [(2026, k) for k in range(1, 11)]]
        mon = {k: {"w": 0, "l": 0, "e": 0, "s": 0} for k in MO}
        for d_, ch, x in events[r]:
            k = d_[:7]
            if k not in mon or not (W12[0] <= d_ <= W12[1]): continue
            if ch == "Website visit": mon[k]["w"] += x.get("sessions") or 0
            elif ch == "LinkedIn ad click": mon[k]["l"] += x.get("clicks", 0)
            elif ch == "Email click": mon[k]["e"] += 1
            elif ch in ("Google ad click", "Bing ad click"): mon[k]["s"] += 1
        emails = sorted({(d_, x.get("type"), x.get("name")) for d_, ch, x in events[r] if ch == "Email click" and W12[0] <= d_ <= W12[1]})
        for k in mon: mon[k]["e"] = sum(1 for e_ in emails if e_[0][:7] == k)
        hot.append({"months": [[k, mon[k]["w"], mon[k]["l"], mon[k]["e"], mon[k]["s"]] for k in MO],
                    "name": nm, "domain": r, "hubspotId": list(ORG[r]["ids"].values())[0], "total": tot, "sessions": s_, "liClicks": li_,
                    "emailClicks": len(emd), "adVisits": gb, "contact": cp, "last": last, "newOct": r in newset, "state": state_of(r)})
hot.sort(key=lambda h: (-h["total"], h["name"]))
# full timeline since the first tracked engagement, month by month, with what was engaged with
MSN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
def fdm(d): return f"{MSN[int(d[5:7])-1]} {int(d[8:10])}"
def nice(c): return (c or "").replace("+", " ").replace("-", " ").replace("Healthcare Development Tier", "Healthcare Development Tier ").replace("  ", " ").strip()
def timeline(r, end="2026-10"):
    ev = [e for e in events[r] if e[0][:7] <= end]
    if not ev: return []
    first = min(e[0][:7] for e in ev); y, m = int(first[:4]), int(first[5:7]); out = []
    while f"{y}-{m:02d}" <= end:
        k = f"{y}-{m:02d}"; w = l = e_ = s_ = 0; items = []; emails = set()
        for d, ch, x in sorted(ev, key=lambda e: (e[0], e[1])):
            if d[:7] != k: continue
            if ch == "Website visit":
                w += x.get("sessions") or 0; items.append([d, "web", f"Week of {fdm(d)}: {x.get('sessions')} website session{'s' if (x.get('sessions') or 0) != 1 else ''}"])
            elif ch == "LinkedIn ad click":
                l += x.get("clicks", 0); items.append([d, "li", f"{MSN[int(d[5:7])-1]}: {x.get('clicks')} LinkedIn ad click{'s' if x.get('clicks') != 1 else ''}"])
            elif ch in ("Google ad click", "Bing ad click"):
                s_ += 1; items.append([d, "ad", f"{fdm(d)}: {ch.split()[0]} ad click, {nice(x.get('campaign'))}" + (f', searched "{x["keyword"]}"' if x.get("keyword") else "")])
            elif ch == "Email click":
                key = (d, x.get("type"), x.get("name"))
                if key in emails: continue
                emails.add(key); e_ += 1
                items.append([d, "em", f"{fdm(d)}: clicked a {'1:1 email from Boldt' if x.get('type') == '1:1 email' else 'marketing email'}" + (f": {x['name']}" if x.get("name") else "")])
        out.append([k, w, l, e_, s_, [[t, txt] for _, t, txt in items]])
        m += 1
        if m == 13: y, m = y + 1, 1
    return out
for h in hot: h["tl"] = timeline(h["domain"])
newTl = {r: timeline(r) for r in new}
json.dump({"newTl": newTl, "lists": lists, "newBySource": newBySource, "hot": hot, "dow": dow, "loc": loc, "outreach": out_s, "firstOutreach": {str(c["hubspotId"]): c.get("firstOutreach") for c in S}}, open("trends_oct.json", "w"), indent=1)
print(json.dumps(dow["all"]["avgShare"]), json.dumps(newBySource), len(hot), sum(1 for h in hot if h["contact"])); print(json.dumps({k: {"top": v["states"][:8], "regions": v["regions"], "unknown": v["unknown"], "n": v["n"]} for k, v in loc.items()})); print(out_s)
print(sorted(round(g) for g in gaps))
