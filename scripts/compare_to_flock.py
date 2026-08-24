#!/usr/bin/env python3
"""Compare our Balanced+VORP board to Flock overall ranks."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ps = json.loads((ROOT / "data" / "players.json").read_text(encoding="utf-8"))

# Balanced weights (js/rankings.js)
WEIGHTS = {
    "flock": 25,
    "lastYear": 14,
    "age": 5,
    "qb": 6,
    "oline": 6,
    "playcaller": 6,
    "adp": 9,
    "vegas": 6,
    "opportunity": 10,
    "efficiency": 6,
    "injury": 5,
    "sos": 2,
}
HIGHER_BETTER = {
    "flock": False,
    "lastYear": True,
    "age": True,  # ageFitness
    "qb": True,
    "oline": True,
    "playcaller": True,
    "adp": False,
    "vegas": True,
    "opportunity": False,  # 1 = best
    "efficiency": True,
    "injury": True,  # games played
    "sos": True,
}
SKILL = {"QB", "RB", "WR", "TE"}


def raw_val(m, key):
    if key == "age":
        return m.get("ageFitness")
    if key == "flock":
        return m.get("flock") if m.get("flock") is not None else 250
    if m.get(key) is None:
        return None
    return m[key]


def percentiles(players, scoring="ppr"):
    n = len(players)
    out = [{} for _ in range(n)]
    for key, higher in HIGHER_BETTER.items():
        # env factors: only eligible
        if key in ("qb", "oline", "playcaller"):
            eligible = []
            for i, p in enumerate(players):
                m = p["metrics"][scoring]
                v = raw_val(m, key)
                if v is not None:
                    eligible.append((i, v))
            if not eligible:
                continue
            vals = [v for _, v in eligible]
            order = sorted(range(len(vals)), key=lambda j: vals[j], reverse=higher)
            rank_of = {order[r]: r for r in range(len(order))}
            for j, (i, _) in enumerate(eligible):
                r = rank_of[j]
                nn = len(vals)
                out[i][key] = 100.0 if nn == 1 else ((nn - 1 - r) / (nn - 1)) * 100
            continue

        # by-pos for lastYear/opportunity/efficiency
        if key in ("lastYear", "opportunity", "efficiency"):
            by_pos = {}
            for i, p in enumerate(players):
                by_pos.setdefault(p["pos"], []).append(i)
            for idxs in by_pos.values():
                vals = []
                for i in idxs:
                    m = players[i]["metrics"][scoring]
                    v = raw_val(m, key)
                    if key in ("adp", "opportunity"):
                        vals.append(999 if v is None else v)
                    else:
                        vals.append(0 if v is None else v)
                order = sorted(range(len(vals)), key=lambda j: vals[j], reverse=higher)
                rank_of = {order[r]: r for r in range(len(order))}
                nn = len(vals)
                for j, i in enumerate(idxs):
                    r = rank_of[j]
                    out[i][key] = 100.0 if nn == 1 else ((nn - 1 - r) / (nn - 1)) * 100
            continue

        vals = []
        for p in players:
            m = p["metrics"][scoring]
            v = raw_val(m, key)
            if key == "adp":
                vals.append(999 if v is None else v)
            elif key == "flock":
                vals.append(250 if v is None else v)
            else:
                vals.append(0 if v is None else v)
        order = sorted(range(len(vals)), key=lambda j: vals[j], reverse=higher)
        rank_of = {order[r]: r for r in range(len(order))}
        nn = len(vals)
        for i in range(n):
            r = rank_of[i]
            out[i][key] = 100.0 if nn == 1 else ((nn - 1 - r) / (nn - 1)) * 100
    return out


def weighted_total(pct, weights, rookie=False):
    wmap = dict(weights)
    if rookie:
        wmap["lastYear"] = 0
        wmap["efficiency"] = min(wmap.get("efficiency", 0), 3)
    num = den = 0.0
    for k, w in wmap.items():
        if w <= 0 or k not in pct or pct[k] is None:
            continue
        num += pct[k] * w
        den += w
    return round(num / den, 1) if den else 0.0


def starter_demand():
    # Match js/rankings.js — FLEX to RB/WR only, TE = 1
    return {"QB": 1, "RB": 3, "WR": 3, "TE": 1, "K": 1, "DST": 1}


POS_PRIORS = {"QB": 1.0, "RB": 1.0, "WR": 1.0, "TE": 1.0, "K": 0.97, "DST": 0.97}
ROOKIE_BOOST = 1.07
SOPHOMORE_BOOST = 1.03


def apply_vorp(rows, teams=12, blend=0.45):
    demand = starter_demand()
    by_pos = {}
    for r in rows:
        by_pos.setdefault(r["pos"], []).append(r)
    replacement = {}
    for pos, d in demand.items():
        pool = sorted(by_pos.get(pos, []), key=lambda x: -x["total"])
        at = max(1, round(teams * d))
        idx = min(len(pool) - 1, at - 1) if pool else 0
        replacement[pos] = pool[idx]["total"] if pool else 0
    out = []
    for r in rows:
        pool = sorted(by_pos.get(r["pos"], []), key=lambda x: -x["total"])
        pos_rank = next(
            (i + 1 for i, x in enumerate(pool) if x.get("id") == r.get("id") or x["name"] == r["name"]),
            99,
        )
        vorp = round(r["total"] - replacement.get(r["pos"], 0), 1)
        vorp_adj = vorp * 0.75 if r["pos"] == "TE" else vorp
        vorp_score = max(0, min(100, 50 + vorp_adj))
        display = r["total"] * (1 - blend) + vorp_score * blend
        display *= POS_PRIORS.get(r["pos"], 1.0)
        if r["pos"] == "TE" and pos_rank > 5:
            display *= 0.88
        if r.get("rookie"):
            adp = float(r.get("adp") or 150)
            rook_boost = 1.1 if adp <= 40 else (ROOKIE_BOOST if adp <= 80 else 1.04)
            display *= rook_boost
        elif r.get("years_exp") == 1:
            display *= SOPHOMORE_BOOST
        display = round(display, 1)
        out.append({**r, "vorp": vorp, "display": display, "pos_rank": pos_rank})
    return out


def main():
    scoring = "ppr"
    # Skill-focused board comparison (exclude K/DST noise)
    skill = [p for p in ps if p["pos"] in SKILL]
    pct = percentiles(skill, scoring)
    rows = []
    for i, p in enumerate(skill):
        total = weighted_total(pct[i], WEIGHTS, rookie=bool(p.get("rookie")))
        flock = p.get("flock_rank") or p["metrics"][scoring].get("flock") or 250
        rows.append(
            {
                "id": p["id"],
                "name": p["name"],
                "pos": p["pos"],
                "team": p["team"],
                "adp": p["adp"]["ppr"],
                "flock": flock if flock < 250 else None,
                "total": total,
                "rookie": p.get("rookie"),
                "years_exp": p.get("years_exp"),
            }
        )
    rows = apply_vorp(rows)
    rows.sort(key=lambda r: (-r["display"], r["adp"]))
    for i, r in enumerate(rows):
        r["our_rank"] = i + 1

    # Only players with a real Flock rank
    both = [r for r in rows if r["flock"] is not None]
    both_by_flock = sorted(both, key=lambda r: r["flock"])

    # Spearman-ish via rank delta stats
    deltas = []
    for r in both:
        deltas.append({**r, "delta": r["flock"] - r["our_rank"]})  # + = we rank higher (more bullish)

    print("=" * 72)
    print("OUR BOARD (Balanced + VORP) vs FLOCK — skill positions only")
    print("=" * 72)
    print(f"Players with both ranks: {len(both)} / {len(skill)} skill in our DB")
    print()

    print("--- TOP 30 SIDE-BY-SIDE ---")
    print(f"{'Our':>4} {'Flock':>5} {'Δ':>5}  {'Pos':3} {'Player':22} {'Team':3}  {'ADP':>5}")
    # Show our top 30 with flock
    for r in rows[:30]:
        fl = r["flock"] if r["flock"] is not None else "—"
        delta = (r["flock"] - r["our_rank"]) if r["flock"] is not None else None
        dstr = f"{delta:+d}" if delta is not None else "  —"
        print(
            f"{r['our_rank']:4d} {str(fl):>5} {dstr:>5}  {r['pos']:3} {r['name'][:22]:22} {r['team']:3}  {r['adp']:5.1f}"
        )

    print()
    print("--- WHERE WE'RE MUCH MORE BULLISH THAN FLOCK (Δ ≥ +12) ---")
    bulls = sorted([d for d in deltas if d["delta"] >= 12], key=lambda x: -x["delta"])[:15]
    for d in bulls:
        print(
            f"  +{d['delta']:2d}  Our #{d['our_rank']:<3} vs Flock #{d['flock']:<3}  "
            f"{d['pos']} {d['name']} ({d['team']}) ADP {d['adp']}"
        )

    print()
    print("--- WHERE WE'RE MUCH MORE BEARISH THAN FLOCK (Δ ≤ -12) ---")
    bears = sorted([d for d in deltas if d["delta"] <= -12], key=lambda x: x["delta"])[:15]
    for d in bears:
        print(
            f"  {d['delta']:3d}  Our #{d['our_rank']:<3} vs Flock #{d['flock']:<3}  "
            f"{d['pos']} {d['name']} ({d['team']}) ADP {d['adp']}"
        )

    # Overlap hit rates
    def hit(top_n):
        our_ids = {r["name"] for r in rows[:top_n]}
        flock_names = {r["name"] for r in both_by_flock[:top_n]}
        # flock top_n among those in our DB
        flock_top = []
        for r in both_by_flock:
            flock_top.append(r["name"])
            if len(flock_top) >= top_n:
                break
        inter = our_ids & set(flock_top)
        return len(inter), top_n

    print()
    print("--- OVERLAP (same names in top N) ---")
    for n in (12, 24, 36, 60):
        h, t = hit(n)
        print(f"  Top {t}: {h}/{t} shared ({100*h/t:.0f}%)")

    # Mean |delta| among top 60 flock
    top60 = [d for d in deltas if d["flock"] <= 60]
    if top60:
        mad = sum(abs(d["delta"]) for d in top60) / len(top60)
        print(f"\nMean |Our−Flock| among Flock top 60 in our DB: {mad:.1f} spots")

    # Save markdown-friendly JSON summary
    out = {
        "our_top_30": [
            {
                "our_rank": r["our_rank"],
                "flock": r["flock"],
                "delta": (r["flock"] - r["our_rank"]) if r["flock"] else None,
                "name": r["name"],
                "pos": r["pos"],
                "team": r["team"],
                "adp": r["adp"],
            }
            for r in rows[:30]
        ],
        "more_bullish": [
            {"delta": d["delta"], "our": d["our_rank"], "flock": d["flock"], "name": d["name"], "pos": d["pos"]}
            for d in bulls
        ],
        "more_bearish": [
            {"delta": d["delta"], "our": d["our_rank"], "flock": d["flock"], "name": d["name"], "pos": d["pos"]}
            for d in bears
        ],
    }
    (ROOT / "data" / "compare_flock.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("\nWrote data/compare_flock.json")


if __name__ == "__main__":
    main()
