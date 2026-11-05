"""Write the October definition MQL block into the site's month file."""
import json
SITE = "/home/claude/site/public/data/2026-10.json"
o = json.load(open("def_mql_oct.json"))
d = json.load(open(SITE))
keep = {k: d.get("defMql", {}).get(k) for k in ("newRule",)}
d["defMql"] = {
    "month": "2026-10",
    "definition": "A healthcare company in HubSpot that actively engaged in the past 12 months: a website visit, a LinkedIn, Google or Bing ad click, or an email click (marketing or 1:1). Counted by organization.",
    "newRule": keep["newRule"] or "New = engaged in October with no engagement in the 12 months before.",
    "newOct": o["newOct"], "total12": o["total12"], "activeOct": o["activeOct"],
    "ytdNew": o["ytdNew"], "engagedYtd": o["engagedYtd"], "ytdByChannel": o["ytdByChannel"],
    "monthlyNew": [o["monthlyNew"][str(m)] for m in range(1, 11)],
    "totalByChannel": o["totalByChannel"], "octByChannel": o["octByChannel"], "newByChannel": o["newByChannel"],
    "manual": o["manual"],
    "window": "LinkedIn clicks and email clicks are tracked back to November 2025. Website visits and Google ad clicks are counted from March 16, 2026, and Bing ad clicks from their September 2026 launch. For 1:1 emails HubSpot keeps the most recent click on each contact.",
    "domainNote": "Parent and child companies that share one website domain, such as a health system and its hospitals, can't always be told apart, so their activity may be combined. We're working through this with Factors.",
    "ytdNote": "Website visits are tracked from March 16, so January and February count LinkedIn and email engagement only.",
    "listNote": "LinkedIn reports clicks by company for each campaign, not for each ad within it. LinkedIn click dates come from Factors, which records LinkedIn activity every few days. Google and Bing clicks are website visits from those ads. Pages viewed and impressions come from Factors and cover May 9 to October 31. Website visits are counted by week, so the most recent date for a visit is the start of that week.",
    "companies": o["companies"],
}
json.dump(d, open(SITE, "w"), separators=(",", ":"), ensure_ascii=False)
print("written", len(d["defMql"]["companies"]), "companies")
