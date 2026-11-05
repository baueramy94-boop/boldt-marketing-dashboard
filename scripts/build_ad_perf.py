"""Ad performance by month for the Ads & creative page (date range toggle) and LinkedIn captions for the ads archive.
Inputs: li_ad_monthly.json (Windsor linkedin creative_id, campaign, year_month, impressions, clicks, spend, conversions),
li_ad_text.json (creative_id, title, commentary, description), google_ad_monthly.json (ad_id, campaign, ad_group_name,
year_month, impressions, clicks, cost), and the site's ads-archive.json for thumbnails, status, landing pages and Google copy.
Healthcare only (senior living campaigns are filtered in the pulls). Google conversions are not used."""
import json, re
SITE = "/home/claude/site/public/data/"
A = json.load(open(SITE + "ads-archive.json"))
LM = json.load(open("li_ad_monthly.json")); LT = {x["creative_id"]: x for x in json.load(open("li_ad_text.json"))}
GM = json.load(open("google_ad_monthly.json"))
NM = 10
LA = {a["id"]: dict(a, campaign=c["campaign"], group=g["group"]) for g in A["linkedin"] for c in g["campaigns"] for a in c["ads"]}
GA = {a["id"]: dict(a, campaign=c["campaign"], adGroup=gr["adGroup"], shared=c.get("shared", False)) for c in A["google"] for gr in c["adGroups"] for a in gr["ads"]}
def mi(ym): return int(ym.split("|")[1]) - 1
def clean(t): return re.sub(r"\s+\n", "\n", (t or "").replace("\\~", "~").replace("\\_", "_")).strip()
li = {}
for x in LM:
    i = x["creative_id"]; a = LA.get(i, {}); t = LT.get(i, {})
    o = li.setdefault(i, {"id": i, "headline": clean(t.get("sponsored_creative_content_title")) or a.get("title") or "", "caption": clean(t.get("sponsored_creative_content_commentary")),
        "campaign": x["campaign"], "thumb": a.get("thumb") or "", "status": a.get("status") or "", "landing": a.get("landing") or "",
        "format": "Document" if re.search(r"document|docad", x["campaign"], re.I) else "Single image", "m": [[0, 0, 0, 0] for _ in range(NM)]})
    m = o["m"][mi(x["year_month"])]; m[0] += x["impressions"]; m[1] += x["clicks"]; m[2] = round(m[2] + x["spend"], 2); m[3] += x["conversions"] or 0
go = {}
for x in GM:
    i = x["ad_id"]; a = GA.get(i, {})
    o = go.setdefault(i, {"id": i, "campaign": x["campaign"], "adGroup": x["ad_group_name"], "shared": a.get("shared", x["campaign"] == "National General"),
        "headlines": a.get("headlines", [])[:15], "descriptions": a.get("descriptions", [])[:4], "url": a.get("url", ""), "status": a.get("status", ""), "m": [[0, 0, 0] for _ in range(NM)]})
    m = o["m"][mi(x["year_month"])]; m[0] += x["impressions"]; m[1] += x["clicks"]; m[2] = round(m[2] + x["cost"], 2)
out = {"months": NM, "linkedin": sorted(li.values(), key=lambda a: -sum(m[0] for m in a["m"])), "google": sorted(go.values(), key=lambda a: -sum(m[0] for m in a["m"]))}
P = SITE + "2026-10.json"; D = json.load(open(P)); D["adPerf"] = out; json.dump(D, open(P, "w"), indent=1, ensure_ascii=False)
# captions into the archive
n = 0
for g in A["linkedin"]:
    for c in g["campaigns"]:
        for a in c["ads"]:
            t = LT.get(a["id"])
            if t and t.get("sponsored_creative_content_commentary"): a["caption"] = clean(t["sponsored_creative_content_commentary"]); n += 1
json.dump(A, open(SITE + "ads-archive.json", "w"), indent=1, ensure_ascii=False)
print(len(li), len(go), "captions", n, sum(1 for a in go.values() if not a["headlines"]))
