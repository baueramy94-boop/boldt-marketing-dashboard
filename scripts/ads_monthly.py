"""Add month-by-month impressions and clicks to each ad in public/data/ads-archive.json, for the tracker's Ads archive month filter.
usage: python3 scripts/ads_monthly.py <li_ad_monthly.json> <google_ad_monthly.json>
Inputs are the Windsor pulls the monthly report already makes: linkedin creative_id, campaign, year_month, impressions, clicks
and google_ads ad_id, campaign, ad_group_name, year_month, impressions, clicks. Writes ad.m = {"YYYY-MM": [impressions, clicks]}
and archive.months = the months covered. Run after build_ads_archive.py."""
import json, sys, os
from collections import defaultdict
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data", "ads-archive.json")
A = json.load(open(P))
ym = lambda s: f"{s.split('|')[0]}-{int(s.split('|')[1]):02d}" if "|" in str(s) else str(s)[:7]
def load(f, key):
    m = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in json.load(open(f)):
        v = m[str(r[key])][ym(r["year_month"])]; v[0] += int(r.get("impressions") or 0); v[1] += int(r.get("clicks") or 0)
    return m
LM, GM = load(sys.argv[1], "creative_id"), load(sys.argv[2], "ad_id")
months, n = set(), 0
for g in A.get("linkedin", []):
    for c in g["campaigns"]:
        for a in c["ads"]:
            a["m"] = {k: v for k, v in sorted(LM.get(str(a["id"]), {}).items()) if v[0] or v[1]}; months |= set(a["m"]); n += bool(a["m"])
for c in A.get("google", []):
    for g in c["adGroups"]:
        for a in g["ads"]:
            a["m"] = {k: v for k, v in sorted(GM.get(str(a["id"]), {}).items()) if v[0] or v[1]}; months |= set(a["m"]); n += bool(a["m"])
A["months"] = sorted(months)
json.dump(A, open(P, "w"), separators=(",", ":"), ensure_ascii=False)
print("months", A["months"][0] if months else None, "to", A["months"][-1] if months else None, "| ads with monthly data", n)
