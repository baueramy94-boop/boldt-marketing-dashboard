"""Merge trends_oct.json (day of week, locations, first outreach) and accounts/all_sources_oct.json into the month file."""
import json
P = "/home/claude/site/public/data/2026-10.json"
D = json.load(open(P)); T = json.load(open("trends_oct.json")); A = json.load(open("/home/claude/dashboard/accounts/all_sources_oct.json"))
D["trends"] = {
    "dow": {**T["dow"], "note": "Google and Bing ad visits and email clicks by healthcare companies in HubSpot, January to October 2026, one per company per day. LinkedIn ad clicks and website visits are reported by month and week, so they aren't placed on a day."},
    "loc": {**T["loc"], "note": "State from each company's HubSpot record. Health systems are listed at their headquarters state."},
}
D["trends"]["dow"]["all"] = T["dow"]["all"]
D["trends"]["dow"]["allNote"] = "Share of each source's activity by day, January to October 2026. LinkedIn and Google clicks and GA4 sessions are daily totals from each platform. LinkedIn click dates in the MQL calendar come from Factors, which loads LinkedIn company data every two to four days, so they bunch up on those load days; LinkedIn's own daily clicks peak on Monday and Tuesday."
D["defMql"]["newBySource"] = T["newBySource"]
D["defMql"]["hot"] = T["hot"]
LC = json.load(open("hs_lifecycle.json"))
for c in D["defMql"]["companies"]:
    if c.get("hubspotId"): c["lifecycle"] = LC.get(str(c["hubspotId"]), "")
D["defMql"]["lifecycleStages"] = [["subscriber", "Subscriber"], ["lead", "Lead"], ["marketingqualifiedlead", "Marketing Qualified Lead"], ["salesqualifiedlead", "Sales Qualified Lead"], ["opportunity", "Opportunity"], ["customer", "Customer"], ["evangelist", "Evangelist"], ["other", "Other"]]
D["defMql"]["hotRule"] = "Hot MQLs: healthcare companies in HubSpot with 5 or more engagements (website sessions, LinkedIn ad clicks and email clicks) or a visit to the contact page, November 2025 to October 2026."
S = D["sqlJourneys"]["summary"]; S["outreach"] = T["outreach"]
S["outreachNote"] = "From HubSpot: the date a Boldt sales owner first emailed or called a contact at the company. Shown for the companies with a recorded first email or call."
for c in D["sqlJourneys"]["companies"]:
    fo = T["firstOutreach"].get(str(c["hubspotId"]))
    if fo: c["firstOutreach"] = fo
    else: c.pop("firstOutreach", None)
D["accounts"]["allSources"] = {**{k: v for k, v in A.items()}, "note": "Email clicks are tracked in HubSpot and appear in the MQL list above."}
json.dump(D, open(P, "w"), indent=1, ensure_ascii=False)
print("ok", len(A["companies"]))
