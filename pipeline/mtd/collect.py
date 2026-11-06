"""Collect this session's pulls for the month-to-date New MQL list into pipeline/mtd/in/<month>/.
usage: python3 pipeline/mtd/collect.py 2026-11
Reads every tool result in this session's transcript(s) and saved tool-result files under /root/.claude/projects/,
recognises each pull by its fields, keeps only rows for the month, and drops personal details (contact names and emails).
  Factors "Accounts Active On Website"      -> visits.json  {"from:to": {domain: [name, industry, sessions]}}
  Factors "Google Ads / Paid Search ..."    -> google.json  [{date, campaign, keyword, domain, n}]
  Factors "Bing Ads Website Sessions"       -> bing.json    [{date, campaign, source, keyword, page, domain}]
  Windsor linkedin year_month, member_company_name, clicks            -> li.json           {company: clicks}
  Windsor linkedin year_month, member_company_name, campaign, clicks  -> li_campaign.json  [{co, campaign, clicks}]
  HubSpot contacts hs_email_domain + hs_email_first/last_click_date    -> email.json        [{domain, first, last}]
  HubSpot contacts hs_email_domain + hs_sales_email_last_clicked       -> sales_email.json  [{domain, date}]
  HubSpot companies name, domain, industry, createdate (new this month, and lookups) -> hs_companies.json {id: {...}}
  Factors agent mql_journey_agent_(dashboard) results (status OK)      -> factors.json      {domain: result}
"""
import json, sys, os, re, glob, datetime as dt
M = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "in", M); os.makedirs(OUT, exist_ok=True)
TZ = dt.timezone(dt.timedelta(hours=-5))
P = lambda n: os.path.join(OUT, n)
def load(n, d): return json.load(open(P(n))) if os.path.exists(P(n)) else d
visits, google, bing = load("visits.json", {}), {}, {}
li, lic, email, sales, comps, fac = {}, {}, {}, {}, load("hs_companies.json", {}), load("factors.json", {})
for x in load("google.json", []): google[json.dumps(x, sort_keys=True)] = x
for x in load("bing.json", []): bing[json.dumps(x, sort_keys=True)] = x

def texts():
    for f in glob.glob("/root/.claude/projects/*/*/tool-results/*.txt") + glob.glob("/root/.claude/projects/*/tool-results/*.txt"):
        try: yield open(f).read()
        except Exception: pass
    for j in glob.glob("/root/.claude/projects/*/*.jsonl"):
        for line in open(j):
            if '"tool_result"' not in line: continue
            try: o = json.loads(line)
            except Exception: continue
            c = (o.get("message") or {}).get("content")
            for x in c if isinstance(c, list) else []:
                if x.get("type") != "tool_result": continue
                t = x.get("content")
                yield t if isinstance(t, str) else " ".join(y.get("text", "") for y in t or [] if isinstance(y, dict))

def parse(t):
    try: o = json.loads(t)
    except Exception: return None
    for _ in range(2):
        if isinstance(o, dict) and isinstance(o.get("result"), str):
            try: o = json.loads(o["result"])
            except Exception: break
    return o

def factors(r):
    g = (r.get("results") or {}).get("result_group") or []
    if not g or not r.get("from"): return
    fr = dt.datetime.fromtimestamp(r["from"], TZ).date().isoformat(); to = dt.datetime.fromtimestamp(r["to"], TZ).date().isoformat()
    if fr[:7] != M: return
    H1 = g[1]["headers"] if len(g) > 1 else []
    if "$6Signal_domain" in H1:
        i, n, ind = H1.index("$6Signal_domain"), H1.index("$6Signal_name"), H1.index("$6Signal_industry")
        visits[f"{fr}:{to}"] = {row[i]: [row[n], row[ind], row[-1]] for row in g[1]["rows"] if row[i] and row[i] != "$none"}
        return
    gg = [x for x in g if "datetime" in x["headers"] and "$keyword" in x["headers"] and "$domain_name" in x["headers"]]
    if gg:
        H = gg[0]["headers"]; ix = {h: k for k, h in enumerate(H)}
        for x in gg[0]["rows"]:
            if not x[ix["aggregate"]] or not str(x[ix["datetime"]]).startswith(M): continue
            row = {"date": x[ix["datetime"]][:10], "campaign": x[ix["$campaign"]], "keyword": x[ix["$keyword"]], "domain": x[ix["$domain_name"]], "n": x[ix["aggregate"]]}
            google[json.dumps(row, sort_keys=True)] = row
        return
    if "$initial_page_url" in g[0]["headers"]:
        H = g[0]["headers"]; ix = {h: k for k, h in enumerate(H)}
        for x in g[0]["rows"]:
            url = x[ix["$initial_page_url"]] or ""; d = str(x[ix["$timestamp"]])[:10]
            if not d.startswith(M): continue
            m = re.search(r"utm_campaign=([^&]+)", url); s = re.search(r"utm_source=([^&]+)", url)
            row = {"date": d, "campaign": m.group(1) if m else None, "source": s.group(1) if s else None, "keyword": x[ix["$term"]],
                   "page": url.split("#")[0].split("?")[0].replace("www.boldthealthcarerealestate.com", ""), "domain": x[ix["$domain_name"]]}
            bing[json.dumps(row, sort_keys=True)] = row

ym = lambda s: f"{s.split('|')[0]}-{int(s.split('|')[1]):02d}" if "|" in str(s) else str(s)[:7]
for t in texts():
    if not t or len(t) < 20: continue
    o = parse(t)
    if not isinstance(o, dict): continue
    if "results" in o and isinstance(o["results"], dict): factors(o); continue
    if isinstance(o.get("data"), list):              # Windsor
        for r in o["data"]:
            if not r.get("member_company_name") or "year_month" not in r or ym(r["year_month"]) != M: continue
            if "campaign" in r:
                if re.search("senior", r.get("campaign") or "", re.I): continue
                lic[(r["member_company_name"], r["campaign"])] = r.get("clicks") or 0
            else: li[r["member_company_name"]] = r.get("clicks") or 0
        continue
    if isinstance(o.get("results"), list):           # HubSpot
        for r in o["results"]:
            p = r.get("properties") or {}
            if "hs_email_domain" in p and "hs_email_last_click_date" in p:
                if str(p["hs_email_last_click_date"] or "")[:7] == M or str(p.get("hs_email_first_click_date") or "")[:7] == M:
                    email[r["id"]] = {"domain": p["hs_email_domain"], "first": p.get("hs_email_first_click_date"), "last": p["hs_email_last_click_date"]}
            elif "hs_email_domain" in p and "hs_sales_email_last_clicked" in p:
                if str(p["hs_sales_email_last_clicked"] or "")[:7] == M:
                    sales[r["id"]] = {"domain": p["hs_email_domain"], "date": p["hs_sales_email_last_clicked"][:10]}
            elif "domain" in p and "name" in p and ("industry" in p or "createdate" in p):
                comps[str(r["id"])] = {"name": p["name"], "domain": p["domain"], "industry": p.get("industry"), "createdate": p.get("createdate")}
        continue
    if o.get("status") == "OK" and isinstance(o.get("response"), (str, dict)):   # Factors agent
        res = parse(o["response"]) if isinstance(o["response"], str) else o["response"]
        if isinstance(res, dict) and res.get("domain"): fac[res["domain"].lower()] = res

json.dump(visits, open(P("visits.json"), "w"))
json.dump(list(google.values()), open(P("google.json"), "w")); json.dump(list(bing.values()), open(P("bing.json"), "w"))
json.dump(li, open(P("li.json"), "w"), indent=0)
json.dump([{"co": k[0], "campaign": k[1], "clicks": v} for k, v in lic.items()], open(P("li_campaign.json"), "w"), indent=0)
json.dump(list(email.values()), open(P("email.json"), "w"), indent=0); json.dump(list(sales.values()), open(P("sales_email.json"), "w"), indent=0)
json.dump(comps, open(P("hs_companies.json"), "w"), indent=0); json.dump(fac, open(P("factors.json"), "w"))
print(M, "visits chunks", sorted(visits), "| google", len(google), "bing", len(bing), "| LinkedIn companies", len(li), "by campaign", len(lic),
      "| email", len(email), "sales email", len(sales), "| HubSpot companies", len(comps), "| Factors agent", len(fac))
