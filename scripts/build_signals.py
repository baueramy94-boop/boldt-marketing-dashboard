"""Data signals for the R&D tab's strategic insights, content ideas and Generate Blog.
usage: python3 scripts/build_signals.py   (run after each monthly report and before the weekly R&D briefing)
Reads the newest monthly file in public/data, public/data/engaged.json, public/data/mtd.json and public/data/ads-archive.json.
Writes public/data/rnd/signals.json: engagement trend, channel mix, top content (with AI-assistant and organic views), messaging
themes by CTR, top paid search terms (search demand), and companies showing buying intent. Healthcare only; company names only."""
import json, os, re
B = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data")
J = lambda f: json.load(open(os.path.join(B, f)))
months = sorted(f for f in os.listdir(B) if re.fullmatch(r"\d{4}-\d{2}\.json", f))
D = J(months[-1]); M = months[-1][:7]
E = J("engaged.json"); MT = J("mtd.json") if os.path.exists(os.path.join(B, "mtd.json")) else {}
SEN = re.compile("senior", re.I)
R = E["months"]; last, prev = R[-1], R[-2]
yr = [r for r in R if r["m"].startswith(M[:4])]
eng = {"month": last["m"], "engaged": last["engaged"], "prev": prev["engaged"], "new": last["new"], "prevNew": prev["new"],
       "avgYear": round(sum(r["engaged"] for r in yr) / len(yr)), "peak": max(yr, key=lambda r: r["engaged"])["m"],
       "channels": {c: {"now": last[c], "prev": prev[c]} for c in "wles"},
       "monthToDate": {"month": MT.get("month"), "through": MT.get("through"), "engaged": MT.get("activeCount"), "new": MT.get("newCount")} if MT else None}
# content: blog posts year to date, with AI assistant and organic search views
bb = (D.get("blogBySource") or {}).get("ytd", {})
posts = [{"title": p["title"], "path": p["path"], "views": p["total"], "ai": p["by"].get("AI assistants", 0), "organic": p["by"].get("Organic search", 0),
          "linkedinAds": p["by"].get("LinkedIn ads", 0)} for p in bb.get("posts", []) if not SEN.search(p["title"] + p["path"])][:12]
landing = [x for x in (D.get("landingYtd") or []) if not SEN.search(x["page"])][:10]
# messaging themes (LinkedIn healthcare creative analysis)
th = (D.get("creativeAnalysis") or {}).get("HC", {}).get("Theme", [])
themes = sorted([{"theme": t["k"], "impr": t["impr"], "clicks": t["clicks"], "ctr": round(t["ctr"] * 100, 2), "ads": t["ads"]} for t in th if t["impr"] >= 5000], key=lambda t: -t["ctr"])
# top LinkedIn ads last month by CTR (min 1,000 impressions)
A = J("ads-archive.json"); mi = int(M[5:]) - 1; ads = []
for g in A.get("linkedin", []):
    for c in g["campaigns"]:
        if SEN.search(c["campaign"]): continue
        for a in c["ads"]:
            v = (a.get("m") or {}).get(M)
            if v and v[0] >= 1000: ads.append({"title": a.get("title") or "", "campaign": c["campaign"], "impr": v[0], "clicks": v[1], "ctr": round(v[1] / v[0] * 100, 2)})
ads.sort(key=lambda a: -a["ctr"])
# search demand: paid search terms (healthcare)
terms = [{"term": t["term"], "clicks": t["clicks"], "impr": t["impr"]} for t in D.get("searchTerms", []) if t.get("div") == "HC" and not SEN.search(t["term"])][:12]
# buying intent: hot MQLs with a contact page visit or the most engagement, and the newest MQLs this month
X = D["defMql"]
hot = sorted(X.get("hot", []), key=lambda h: (-(1 if h.get("contact") else 0), -h.get("total", 0)))
intent = [{"name": h["name"], "domain": h["domain"], "engagements": h["total"], "contactPage": bool(h.get("contact")), "last": h.get("last"),
           "newThisMonth": bool(h.get("newOct"))} for h in hot[:12]]
mtdNew = [{"name": c["name"], "domain": c["domain"], "channels": c.get("channels", [])} for c in (MT.get("companies") or [])][:10]
# internal links for Generate Blog: real pages on the Boldt site (core pages plus blog posts with traffic this year)
SITE_URL = "https://www.boldthealthcarerealestate.com"
core = [("/", "Boldt Healthcare Real Estate home"), ("/about/", "About Boldt Real Estate"), ("/leadership/", "Boldt Real Estate leadership team"),
        ("/contact/", "Contact Boldt (start a conversation)"), ("/blog/", "Boldt healthcare real estate blog"), ("/lp-lowest-responsible-cost/", "Lowest responsible cost and cost certainty")]
links = [{"title": t, "url": SITE_URL + u} for u, t in core]
links += [{"title": p["title"], "url": SITE_URL + p["path"]} for p in posts if "/blog/" in p["path"] and "welcomes" not in p["path"]]
out = {"generated": __import__("datetime").date.today().isoformat(), "reportMonth": M, "engagement": eng, "topContent": posts, "topLanding": landing,
       "messagingThemes": themes, "topLinkedInAds": ads[:8], "searchDemand": {"window": D.get("searchTermsWindow"), "terms": terms},
       "buyingIntent": intent, "newThisMonth": mtdNew, "internalLinks": links, "hotCount": len(X.get("hot", [])),
       "notes": "Company names only. Search demand is from paid search terms until Search Console is connected."}
json.dump(out, open(os.path.join(B, "rnd", "signals.json"), "w"), indent=1, ensure_ascii=False)
print("signals", M, "| engaged", eng["engaged"], "vs", eng["prev"], "| posts", len(posts), "| themes", len(themes), "| ads", len(ads), "| terms", len(terms), "| intent", len(intent))
