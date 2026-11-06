"""Which LinkedIn campaigns and ads each hot MQL and new MQL clicked, by month, for the journey pop-up.
Inputs: li_company_campaign.json (Windsor `linkedin` `year_month, member_company_name, campaign, clicks`, clicks gt 0,
campaign ncontains "enior", member_company_name in the LinkedIn names of the hot and new MQL companies),
li_name_to_org.json (LinkedIn company name -> organization root domain, same matching as compute.py),
../ads/li_ad_monthly.json (Windsor creative_id, campaign, year_month, clicks) and the ads archive (titles, images, posts).
LinkedIn splits a company's clicks by campaign only where the company has 3 or more clicks in that campaign that month,
so the rest of the month's clicks stay unassigned. LinkedIn never reports which ad a company clicked; when only one ad in
the campaign had clicks that month, that ad is marked as the one clicked.
Run after merge_trends.py. Writes defMql.hot[].liAds, defMql.companies[].liAds, defMql.adLib and defMql.liCampaignsByMonth."""
import json, re
from collections import defaultdict
P = "/home/claude/site/public/data/2026-10.json"
D = json.load(open(P)); X = D["defMql"]
rows = json.load(open("li_company_campaign.json")); N2O = json.load(open("li_name_to_org.json"))
AM = json.load(open(__import__("os").environ.get("LI_AD_MONTHLY","../ads/li_ad_monthly.json")))
AR = json.load(open("/home/claude/site/public/data/ads-archive.json"))
SEN = re.compile("senior", re.I)
lib, camp_ads = {}, defaultdict(list)
for g in AR["linkedin"]:
    for c in g["campaigns"]:
        for a in c["ads"]:
            lib[a["id"]] = {"t": a.get("title") or "", "th": a.get("thumb") or "", "p": a.get("post") or ""}
            camp_ads[c["campaign"]].append(a["id"])
ym = lambda s: f"{s.split('|')[0]}-{int(s.split('|')[1]):02d}"
mon_ads = defaultdict(list); running = defaultdict(set)   # (campaign, month) -> [(clicks, creative)]
for r in AM:
    if SEN.search(r["campaign"] or ""): continue
    m = ym(r["year_month"])
    if r.get("impressions"): running[m].add(r["campaign"])
    if r.get("clicks"): mon_ads[(r["campaign"], m)].append((r["clicks"], r["creative_id"]))
by = defaultdict(lambda: defaultdict(list))
for r in rows:
    org = N2O.get(r["co"])
    if org: by[org][r["m"]].append([r["campaign"], r["clicks"]])
used = set()
def build(domain, tl):
    out = {}
    for x in tl or []:
        m, li = x[0], x[2]
        if not li: continue
        cs = []
        for camp, n in sorted(by[domain].get(m, []), key=lambda z: -z[1]):
            ads = [cid for _, cid in sorted(mon_ads.get((camp, m), []), reverse=True) if cid in lib]
            month_known = (camp, m) in mon_ads
            if not month_known: ads = [a for a in camp_ads.get(camp, [])]
            used.update(ads)
            cs.append({"c": camp, "n": n, "ads": ads[:8], "more": max(0, len(ads) - 8), "exact": month_known and len(ads) == 1, "monthKnown": month_known})
        out[m] = {"total": li, "camps": cs, "rest": max(0, li - sum(c["n"] for c in cs))}
    return out
for h in X["hot"]: h["liAds"] = build(h["domain"], h.get("tl"))
for c in X["companies"]: c["liAds"] = build(c["domain"], c.get("tl"))
X["adLib"] = {k: lib[k] for k in sorted(used)}
X["liCampaignsByMonth"] = {m: sorted(v) for m, v in sorted(running.items())}
X["liAdsNote"] = ("LinkedIn reports a company's clicks by campaign only where the company has 3 or more clicks in that campaign in the month, "
                  "and never says which ad a company clicked. Where one ad in the campaign had clicks that month, it is shown as the ad clicked.")
json.dump(D, open(P, "w"), separators=(",", ":"))
tot = sum(v["total"] for h in X["hot"] for v in h["liAds"].values()); rest = sum(v["rest"] for h in X["hot"] for v in h["liAds"].values())
print("hot LinkedIn clicks", tot, "assigned to a campaign", tot - rest, "ads in library", len(X["adLib"]))
