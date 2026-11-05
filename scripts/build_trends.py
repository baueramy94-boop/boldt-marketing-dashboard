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
json.dump({"dow": dow, "loc": loc, "outreach": out_s, "firstOutreach": {str(c["hubspotId"]): c.get("firstOutreach") for c in S}}, open("trends_oct.json", "w"), indent=1)
print(json.dumps(dow)); print(json.dumps({k: {"top": v["states"][:8], "regions": v["regions"], "unknown": v["unknown"], "n": v["n"]} for k, v in loc.items()})); print(out_s)
print(sorted(round(g) for g in gaps))
