"""Compact a saved Factors report file into rows. usage: compact.py <kind google|bing> <file> ; writes paid/<kind>_<from>.json and deletes the file"""
import json, sys, os, re, datetime as dt
kind, f = sys.argv[1], sys.argv[2]
r = json.loads(json.load(open(f))["result"])
fr = dt.datetime.fromtimestamp(r["from"], dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
out = []
gs = r["results"]["result_group"]
if kind == "google":
    g = [x for x in gs if "datetime" in x["headers"]][0]
    H = g["headers"]; ix = {h: i for i, h in enumerate(H)}
    for x in g["rows"]:
        if not x[ix["aggregate"]]: continue
        out.append({"date": x[ix["datetime"]][:10], "campaign": x[ix["$campaign"]], "keyword": x[ix["$keyword"]], "domain": x[ix["$domain_name"]], "n": x[ix["aggregate"]]})
else:
    g = gs[0]; H = g["headers"]; ix = {h: i for i, h in enumerate(H)}
    seen = set()
    for x in g["rows"]:
        url = x[ix["$initial_page_url"]] or ""
        m = re.search(r"utm_campaign=([^&]+)", url); src = re.search(r"utm_source=([^&]+)", url)
        key = (x[ix["$timestamp"]], x[ix["$domain_name"]], x[ix["$term"]], url[:200])
        if key in seen: continue
        seen.add(key)
        out.append({"date": x[ix["$timestamp"]][:10], "campaign": m.group(1) if m else None, "source": src.group(1) if src else None, "keyword": x[ix["$term"]],
                    "page": url.split("#")[0].split("?")[0].replace("www.boldthealthcarerealestate.com", ""), "domain": x[ix["$domain_name"]], "secs": x[ix["$session_spent_time"]]})
p = f"/home/claude/dashboard/defmql/paid/{kind}_{fr}.json"
json.dump(out, open(p, "w")); os.remove(f)
print(kind, fr, len(out), "rows")
