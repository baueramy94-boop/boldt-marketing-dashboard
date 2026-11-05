"""Known accounts on the site, all sources. Input: Factors saved report "Account Details + Website Metrics", pulled in
2-day windows (larger windows are too big for the connector), compacted to details/*.json. Each row is one session:
company, domain, industry, channel, landing page, time on site. Healthcare only: health care industry or a healthcare
company in HubSpot; senior living pages and campaigns dropped."""
import json, glob, re, sys, io, contextlib, runpy
from collections import defaultdict, Counter
import os; _cwd = os.getcwd(); os.chdir("/home/claude/dashboard/defmql")
with contextlib.redirect_stdout(io.StringIO()):
    G = runpy.run_path("/home/claude/dashboard/defmql/compute.py", run_name="lib")
os.chdir(_cwd)
ORG, HC, root = G["ORG"], G["HC"], G["root"]
SEN = re.compile(r"senior|retirement|assisted|memory-care|life-plan|SeniorLiving|demandgen", re.I)
SENN = G["SENIOR"]
OWN = {"boldt.com", "theboldtcompany.com"}
ISP = re.compile(r"comcast|xfinity|verizon|at&t|spectrum|charter|brightspeed|frontier|cox|t-mobile|google|amazon|microsoft|apple|cloudflare|zscaler", re.I)
rows = []
for f in sorted(glob.glob("/home/claude/dashboard/accounts/details/*.json")):
    for r in json.load(open(f))["rows"]: rows.append(r)
def page(u):
    u = (u or "").split("#")[0].split("?")[0].replace("www.boldthealthcarerealestate.com", "") or "/"
    return u.rstrip("/") or "/"
CH = {"Paid Search": "Paid search (Google, Bing)", "Paid Social": "LinkedIn ads", "Organic Search": "Organic search", "Direct": "Direct",
      "Referral": "Referral", "Email": "Email", "Organic Social": "Organic social", "Google Ads Network": "Google display", "AI Search": "AI search"}
co = {}
for name, dom, ind, ch, url, t, n in rows:
    r = root(dom)
    if not r or r in OWN: continue
    known = r in ORG
    hc = (ind == "Health Care Providers & Services") or (r in HC)
    if not hc or SENN.search(name or "") or SEN.search(url or ""): continue
    c = co.setdefault(r, {"name": None, "domain": r, "hubspot": known, "sessions": 0, "ch": Counter(), "pages": Counter(), "time": 0.0})
    if known:
        c["name"] = sorted(ORG[r]["names"], key=len)[0]
        c["hubspotId"] = list(ORG[r]["ids"].values())[0]
    c["name"] = c["name"] or (name if name and name != "$none" else r)
    c["sessions"] += 1; c["ch"][CH.get(ch, ch)] += 1; c["pages"][page(url)] += 1
    try: c["time"] += float(t)
    except: pass
known = [c for c in co.values() if c["hubspot"]]
new = [c for c in co.values() if not c["hubspot"]]
def bych(cs):
    d = Counter()
    for c in cs:
        for k in c["ch"]: d[k] += 1
    return dict(d.most_common())
pg = Counter()
for c in co.values():
    for p in c["pages"]: pg[p] += 1
out = {
    "window": "October 1 to 31, 2026",
    "healthcareCompanies": len(co), "inHubspot": len(known), "notInHubspot": len(new),
    "sessions": sum(c["sessions"] for c in co.values()),
    "byChannel": bych(co.values()), "byChannelKnown": bych(known), "byChannelNew": bych(new),
    "sessionsByChannel": dict(sum((c["ch"] for c in co.values()), Counter()).most_common()),
    "topPages": [{"page": p, "companies": n} for p, n in pg.most_common(8)],
    "companies": sorted([{"name": c["name"], "domain": c["domain"], "hubspot": c["hubspot"], "hubspotId": c.get("hubspotId"),
        "sessions": c["sessions"], "channels": [k for k, _ in c["ch"].most_common()], "pages": [p for p, _ in c["pages"].most_common(3)],
        "minutes": round(c["time"] / 60, 1)} for c in co.values()], key=lambda c: (-c["sessions"], c["name"])),
}
json.dump(out, open("/home/claude/dashboard/accounts/all_sources_oct.json", "w"), indent=1)
if __name__ == "__main__":
    print({k: v for k, v in out.items() if k not in ("companies",)})
    for c in out["companies"][:25]: print(c["name"], c["hubspot"], c["sessions"], c["channels"], c["pages"], c["minutes"])
