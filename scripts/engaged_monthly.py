"""Engaged healthcare companies by month for the Leads tab "Engaged companies, month over month" section.
usage: python3 scripts/engaged_monthly.py   (build_mtd.py also embeds summary() in mtd.json "engaged" on every run, and runs this after --finalize)
Reads pipeline/mtd/state/history.json ({orgs: {hash: {YYYY-MM: [website sessions, LinkedIn clicks, email clicks, Google or Bing ad visits]}}})
and writes public/data/engaged.json with counts only: per month the engaged organizations, new (no engagement in the 12 months
before; only from the 13th month of history on), returning, and how many engaged through each channel."""
import json, os
B = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
add = lambda m, k: f"{int(m[:4]) + (int(m[5:]) - 1 + k) // 12}-{(int(m[5:]) - 1 + k) % 12 + 1:02d}"

def summary(H):
    """Counts only, from the hashed history: per month engaged, new, returning and engaged by channel."""
    O = H["orgs"]
    months = sorted({m for o in O.values() for m in o if sum(o[m]) > 0})
    first, rows = months[0], []
    for m in months:
        act = [k for k, o in O.items() if sum(o.get(m, [0])) > 0]
        full = m >= add(first, 12)
        new = [k for k in act if not any(sum(O[k].get(add(m, -j), [0])) > 0 for j in range(1, 13))] if full else None
        ch = {c: sum(1 for k in act if O[k][m][i] > 0) for i, c in enumerate("wles")}
        rows.append({"m": m, "engaged": len(act), "new": len(new) if new is not None else None,
                     "returning": len(act) - len(new) if new is not None else None, **ch})
    return {"through": H.get("through"), "first": first, "months": rows,
            "definition": "Healthcare companies in HubSpot that engaged in the month: a website visit, a LinkedIn, Google or Bing ad click, or an email click. Counted by organization.",
            "newRule": "New = no engagement in the 12 months before. Shown from the first month with a full 12 months of history before it.",
            "coverage": "LinkedIn ad clicks and email clicks go back to November 2024. Website visits and Google ad clicks are counted from March 16, 2026, and Bing ad clicks from their September 2026 launch, so earlier months show fewer companies."}

if __name__ == "__main__":
    out = summary(json.load(open(os.path.join(B, "pipeline", "mtd", "state", "history.json"))))
    rows, first = out["months"], out["first"]
    json.dump(out, open(os.path.join(B, "public", "data", "engaged.json"), "w"), indent=0)
    print("engaged.json", first, "to", rows[-1]["m"], "| months", len(rows), "| latest", rows[-1])
