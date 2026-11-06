"""Dated engagement by company for the "Engagement after 1:1 outreach" panel.
usage: python3 outreach_engage.py 2026-10
Inputs (same pulls the monthly report already uses):
  accounts/details/*.json   Factors "Account Details + Website Metrics", 2-day windows; one row per session with channel
  defmql/paid/google_*.json Factors Google Ads sessions by day and domain
  defmql/paid/bing_*.json   Factors Bing Ads sessions by day and domain
  defmql/email_clicks.json  HubSpot contacts' first and last marketing email click by domain
Writes public/data/engage-<month>.json: {month, through, eng: {root domain: [[from, to, code, n], ...]}, codes, note}
code w = website visit, l = visit from a LinkedIn ad, g = visit from a Google or Bing ad, e = email click or visit from email.
Healthcare only (Factors health care industry, or a healthcare company in HubSpot). Senior living pages and campaigns are left out.
No people, only companies. The 1:1 outreach itself is read live from HubSpot by netlify/functions/hs-outreach.mts."""
import json, glob, re, sys, io, os, contextlib, runpy
from collections import defaultdict
M = sys.argv[1] if len(sys.argv) > 1 else "2026-10"
_cwd = os.getcwd(); os.chdir("/home/claude/dashboard/defmql")
with contextlib.redirect_stdout(io.StringIO()):
    G = runpy.run_path("/home/claude/dashboard/defmql/compute.py", run_name="lib")
os.chdir(_cwd)
HC, root, SENN = G["HC"], G["root"], G["SENIOR"]
SEN = re.compile(r"senior|retirement|assisted|memory-care|life-plan|SeniorLiving|demandgen", re.I)
OWN = {"boldt.com", "theboldtcompany.com"}
CODE = {"Paid Social": "l", "Paid Search": "g", "Google Ads Network": "g", "Email": "e"}
ev = defaultdict(lambda: defaultdict(int))   # root -> (from, to, code) -> n
through = ""
for f in sorted(glob.glob("/home/claude/dashboard/accounts/details/*.json")):
    d = json.load(open(f))
    if not d["from"].startswith(M): continue
    through = max(through, d["to"])
    for name, dom, ind, ch, url, t, n in d["rows"]:
        r = root(dom)
        if not r or r in OWN: continue
        if not ((ind == "Health Care Providers & Services") or (r in HC)): continue
        if SENN.search(name or "") or SEN.search(url or ""): continue
        ev[r][(d["from"], d["to"], CODE.get(ch, "w"))] += int(n or 1)
P = "/home/claude/dashboard/defmql/paid/"
for f in glob.glob(P + "google_*.json") + glob.glob(P + "bing_*.json"):
    for x in json.load(open(f)):
        day = str(x.get("date", ""))[:10]; r = root(x.get("domain"))
        if not day.startswith(M) or not r or r in OWN or r not in HC or SEN.search(x.get("campaign") or ""): continue
        ev[r][(day, day, "g")] += int(x.get("n") or 1)
for x in json.load(open("/home/claude/dashboard/defmql/email_clicks.json")):
    r = root(x.get("domain"))
    if not r or r in OWN or r not in HC: continue
    for k in ("first", "last"):
        day = str(x.get(k) or "")[:10]
        if day.startswith(M): ev[r][(day, day, "e")] = max(ev[r][(day, day, "e")], 1)
out = {"month": M, "through": through,
       "codes": {"w": "Website visit", "l": "LinkedIn ad visit", "g": "Google or Bing ad visit", "e": "Email"},
       "note": "Website sessions are dated in two-day blocks; Google and Bing ad visits and email clicks by day.",
       "eng": {r: sorted([a, b, c, n] for (a, b, c), n in v.items()) for r, v in sorted(ev.items())}}
OUT = f"/home/claude/site/public/data/engage-{M}.json"
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(M, "through", through, "companies", len(out["eng"]), "events", sum(len(v) for v in out["eng"].values()), "bytes", os.path.getsize(OUT))
