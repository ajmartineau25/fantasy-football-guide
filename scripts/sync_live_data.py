#!/usr/bin/env python3
"""
Full live data scrub:
  1) Sleeper players API → current NFL team (+ sleeper_id)
  2) Injury news map → lower injury scores
  3) Consensus 2026 ADP → adp_ppr / adp_half

Patches scripts/generate_data.py PLAYERS list, then runs generate_data.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "scripts" / "generate_data.py"
SLEEPER_CACHE = ROOT / "data" / "sleeper_players_raw.json"
ADP_OUT = ROOT / "data" / "adp_2026_live.json"
REPORT = ROOT / "data" / "sync_report.json"

# ---- injury news (Aug 24, 2026 sweep) ----
# injury score 1–32 (higher = healthier). Mapped to games-played estimate in generate_data.
INJURIES = {
    # season / long-term
    "Jayden Higgins": {"injury": 4, "note": "ACL — season", "adp_bump": 80},
    "Zach Charbonnet": {"injury": 5, "note": "ACL — TBD", "adp_bump": 40},
    "Tank Dell": {"injury": 6, "note": "ACL+MCL", "adp_bump": 50},
    "Jordyn Tyson": {"injury": 8, "note": "Hamstring ~2 months / possible IR", "adp_bump": 60},
    "Alvin Kamara": {"injury": 10, "note": "MCL sprain 4–6 weeks", "adp_bump": 25},
    "Isiah Pacheco": {"injury": 12, "note": "MCL 3+ weeks", "adp_bump": 20},
    "James Conner": {"injury": 14, "note": "Foot/ankle 2–3 weeks", "adp_bump": 15},
    "Alec Pierce": {"injury": 12, "note": "Ankle / PUP concern", "adp_bump": 25},
    # Week 1 cloudy
    "Jeremiyah Love": {"injury": 16, "note": "High ankle sprain — Week 1 uncertain", "adp_bump": 8},
    "Ashton Jeanty": {"injury": 17, "note": "Ankle sprain (Schefter) — timeline TBD", "adp_bump": 12},
    "Malik Nabers": {"injury": 18, "note": "ACL recovery — possibly Week 1", "adp_bump": 5},
    "Patrick Mahomes": {"injury": 18, "note": "ACL/LCL recovery — Week 1 watch", "adp_bump": 8},
    "Tucker Kraft": {"injury": 18, "note": "ACL/meniscus recovery", "adp_bump": 10},
    "Michael Pittman Jr.": {"injury": 18, "note": "Hamstring 1–2 weeks", "adp_bump": 8},
    "Puka Nacua": {"injury": 20, "note": "Groin — limited", "adp_bump": 2},
    "Sam LaPorta": {"injury": 20, "note": "Hip — limited", "adp_bump": 3},
    "Chuba Hubbard": {"injury": 20, "note": "Hamstring", "adp_bump": 4},
    "Breece Hall": {"injury": 20, "note": "Groin", "adp_bump": 3},
    "Makai Lemon": {"injury": 19, "note": "Hamstring", "adp_bump": 10},
    "Christian McCaffrey": {"injury": 19, "note": "Tightness / workload watch", "adp_bump": 1},
    "Khalil Shakir": {"injury": 20, "note": "Undisclosed", "adp_bump": 3},
    "George Kittle": {"injury": 19, "note": "Achilles recovery watch", "adp_bump": 4},
    "Xavier Worthy": {"injury": 21, "note": "Shoulder", "adp_bump": 2},
    "Mike Evans": {"injury": 21, "note": "Quad", "adp_bump": 2},
    "Emeka Egbuka": {"injury": 21, "note": "Toe", "adp_bump": 2},
    "Saquon Barkley": {"injury": 20, "note": "Foot/ankle checked — monitor", "adp_bump": 2},
    "Tyler Warren": {"injury": 18, "note": "Injury concern (camp)", "adp_bump": 6},
}

# Consensus PPR ADP ~Aug 24 2026 (BeatADP / DIRECTV / Yates blend)
ADP_2026 = {
    "Jahmyr Gibbs": 1.5,
    "Bijan Robinson": 2.5,
    "Ja'Marr Chase": 3.5,
    "Puka Nacua": 4.5,
    "Jaxon Smith-Njigba": 5.5,
    "Christian McCaffrey": 7.0,
    "Amon-Ra St. Brown": 7.5,
    "Jonathan Taylor": 8.5,
    "CeeDee Lamb": 10.0,
    "Ashton Jeanty": 18.0,  # injury fall from ~11–15
    "Justin Jefferson": 11.5,
    "James Cook": 12.5,
    "De'Von Achane": 13.5,
    "Chase Brown": 15.5,
    "Saquon Barkley": 18.5,
    "A.J. Brown": 19.5,
    "Trey McBride": 21.0,
    "Omarion Hampton": 21.5,
    "Brock Bowers": 22.0,
    "Rashee Rice": 23.0,
    "Nico Collins": 23.5,
    "Kenneth Walker III": 22.5,
    "Chris Olave": 26.0,
    "Drake London": 16.5,
    "Derrick Henry": 19.0,
    "George Pickens": 24.5,
    "Jeremiyah Love": 28.0,  # ankle
    "Josh Jacobs": 30.0,
    "DeVonta Smith": 29.0,
    "Zay Flowers": 28.5,
    "Malik Nabers": 30.5,  # ACL watch
    "Breece Hall": 32.0,
    "Kyren Williams": 31.5,
    "Josh Allen": 31.0,
    "Tee Higgins": 36.0,
    "Garrett Wilson": 37.0,
    "Tetairoa McMillan": 35.0,
    "Emeka Egbuka": 38.0,
    "Javonte Williams": 36.5,
    "Travis Etienne Jr.": 38.5,
    "Ladd McConkey": 34.0,
    "Jaylen Waddle": 33.0,
    "Brian Thomas Jr.": 27.0,
    "Bucky Irving": 29.5,
    "Lamar Jackson": 40.0,
    "Patrick Mahomes": 48.0,  # injury
    "Jayden Daniels": 42.0,
    "Joe Burrow": 45.0,
    "Jalen Hurts": 46.0,
    "Sam LaPorta": 50.0,
    "George Kittle": 55.0,
    "Tucker Kraft": 62.0,
    "Colston Loveland": 48.0,
    "Mike Evans": 52.0,
    "DK Metcalf": 54.0,
    "Marvin Harrison Jr.": 44.0,
    "Terry McLaurin": 46.5,
    "DJ Moore": 48.5,
    "Courtland Sutton": 56.0,
    "Jameson Williams": 58.0,
    "Xavier Worthy": 60.0,
    "Khalil Shakir": 55.5,
    "Rome Odunze": 57.0,
    "Jordan Addison": 65.0,
    "Calvin Ridley": 70.0,
    "Stefon Diggs": 72.0,
    "Alvin Kamara": 75.0,  # MCL
    "Chuba Hubbard": 58.5,
    "D'Andre Swift": 60.5,
    "Isiah Pacheco": 68.0,
    "James Conner": 72.0,
    "Tony Pollard": 78.0,
    "Rhamondre Stevenson": 70.5,
    "David Montgomery": 64.0,
    "Quinshon Judkins": 52.0,
    "Cam Skattebo": 58.0,
    "Jadarian Price": 55.0,
    "Carnell Tate": 72.0,
    "Jordyn Tyson": 130.0,  # 2 months
    "Makai Lemon": 95.0,
    "Kenyon Sadiq": 105.0,
    "KC Concepcion": 100.0,
    "Bo Nix": 75.0,
    "Baker Mayfield": 82.0,
    "Justin Herbert": 78.0,
    "Drake Maye": 70.0,
    "Caleb Williams": 80.0,
    "Tyler Warren": 85.0,
    "Mike Washington Jr.": 140.0,
    "Fernando Mendoza": 165.0,
    "Ty Simpson": 185.0,
}


def norm(s: str) -> str:
    s = (s or "").lower().replace("'", "").replace(".", "").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(iii|ii|jr|sr)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def load_sleeper() -> dict:
    if SLEEPER_CACHE.exists():
        return json.loads(SLEEPER_CACHE.read_text(encoding="utf-8"))
    req = urllib.request.Request(
        "https://api.sleeper.app/v1/players/nfl",
        headers={"User-Agent": "fantasy-guide/1.0"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode())
    SLEEPER_CACHE.write_text(json.dumps(data), encoding="utf-8")
    return data


def sleeper_name_index(sleeper: dict) -> dict:
    idx = {}
    for pid, pl in sleeper.items():
        if not pl:
            continue
        full = pl.get("full_name") or f"{pl.get('first_name') or ''} {pl.get('last_name') or ''}".strip()
        if not full:
            continue
        key = norm(full)
        entry = {
            "sleeper_id": pid,
            "team": pl.get("team"),
            "pos": pl.get("position"),
            "status": pl.get("status"),
            "injury_status": pl.get("injury_status"),
            "active": pl.get("active"),
            "full_name": full,
        }
        idx.setdefault(key, []).append(entry)
        # also index without suffix already handled in norm
    return idx


def pick_sleeper_hit(name: str, pos: str, team: str, idx: dict):
    key = norm(name)
    hits = idx.get(key) or []
    if not hits:
        # last-name fallback
        last = key.split()[-1] if key else ""
        if last:
            for k, arr in idx.items():
                if k.endswith(" " + last) or k == last:
                    hits.extend(arr)
    if not hits:
        return None
    # prefer active + matching pos/team
    def score(h):
        s = 0
        if h.get("active"):
            s += 5
        if h.get("team"):
            s += 2
        if pos and h.get("pos") == pos:
            s += 3
        if pos == "DST" and h.get("pos") in ("DEF", "DST"):
            s += 3
        if team and h.get("team") == team:
            s += 2
        return s

    hits = sorted(hits, key=score, reverse=True)
    return hits[0]


def patch_generate_data(team_updates: dict, injury_updates: dict, adp_updates: dict) -> dict:
    text = GEN.read_text(encoding="utf-8")
    report = {"team_changes": [], "injury_updates": [], "adp_updates": [], "unmatched_inj": [], "unmatched_adp": []}

    # Find each player dict by name and patch fields with regex on the dict literal line(s)
    # PLAYERS entries are single-line dicts mostly.
    def repl_player(match: re.Match) -> str:
        block = match.group(0)
        name_m = re.search(r'"name":\s*"([^"]+)"', block)
        if not name_m:
            return block
        name = name_m.group(1)

        # team
        if name in team_updates and team_updates[name]:
            new_team = team_updates[name]
            old_m = re.search(r'"team":\s*"([A-Z]{2,3})"', block)
            if old_m and old_m.group(1) != new_team:
                report["team_changes"].append({"name": name, "from": old_m.group(1), "to": new_team})
                block = re.sub(r'"team":\s*"[A-Z]{2,3}"', f'"team": "{new_team}"', block, count=1)

        # injury
        if name in injury_updates:
            inj = injury_updates[name]["injury"]
            if re.search(r'"injury":\s*\d+', block):
                block = re.sub(r'"injury":\s*\d+', f'"injury": {inj}', block, count=1)
            else:
                block = block.rstrip("}") + f', "injury": {inj}}}' if False else block
                # insert before closing
                block = re.sub(r"\}\s*$", f', "injury": {inj}}}', block)
            report["injury_updates"].append({"name": name, **injury_updates[name]})

        # ADP
        if name in adp_updates:
            adp = float(adp_updates[name])
            half = round(adp - 0.5, 1) if adp > 3 else adp
            if re.search(r'"adp_ppr":\s*[\d.]+', block):
                block = re.sub(r'"adp_ppr":\s*[\d.]+', f'"adp_ppr": {adp}', block, count=1)
            if re.search(r'"adp_half":\s*[\d.]+', block):
                block = re.sub(r'"adp_half":\s*[\d.]+', f'"adp_half": {half}', block, count=1)
            report["adp_updates"].append({"name": name, "adp": adp})

        return block

    # Match player dicts inside PLAYERS = [ ... ]
    pattern = re.compile(
        r'\{\s*"name":\s*"[^"]+"\s*,\s*"pos":\s*"[^"]+"\s*,\s*"team":\s*"[^"]+"[^}]*\}',
        re.MULTILINE,
    )
    new_text, n = pattern.subn(repl_player, text)
    if n < 50:
        print(f"WARNING: only patched {n} player dicts — pattern may be wrong")
    GEN.write_text(new_text, encoding="utf-8")

    for name in injury_updates:
        if not any(x["name"] == name for x in report["injury_updates"]):
            report["unmatched_inj"].append(name)
    for name in adp_updates:
        if not any(x["name"] == name for x in report["adp_updates"]):
            report["unmatched_adp"].append(name)

    report["players_patched"] = n
    return report


def main():
    print("Loading Sleeper…")
    sleeper = load_sleeper()
    idx = sleeper_name_index(sleeper)

    # Read current player names/teams from generate_data via exec of PLAYERS only — parse names
    text = GEN.read_text(encoding="utf-8")
    names = re.findall(r'"name":\s*"([^"]+)"\s*,\s*"pos":\s*"([^"]+)"\s*,\s*"team":\s*"([^"]+)"', text)

    team_updates = {}
    sleeper_ids = {}
    for name, pos, team in names:
        if pos == "DST":
            # DST names are team names — keep team abbrev from entry
            continue
        hit = pick_sleeper_hit(name, pos, team, idx)
        if hit and hit.get("team") and hit["team"] != team:
            team_updates[name] = hit["team"]
        if hit and hit.get("sleeper_id"):
            sleeper_ids[name] = hit["sleeper_id"]

    # Apply injury ADP bumps onto base ADP map
    adp_final = dict(ADP_2026)
    for name, meta in INJURIES.items():
        base = adp_final.get(name)
        if base is not None:
            adp_final[name] = round(min(200, base + meta.get("adp_bump", 0)), 1)
        # if not in ADP map, leave injury-only update

    ADP_OUT.write_text(
        json.dumps({"updated": "2026-08-24", "adp": adp_final, "injuries": INJURIES}, indent=2),
        encoding="utf-8",
    )

    print(f"Team changes to apply: {len(team_updates)}")
    for n, t in sorted(team_updates.items(), key=lambda x: x[0])[:40]:
        print(f"  {n}: -> {t}")
    if len(team_updates) > 40:
        print(f"  … +{len(team_updates) - 40} more")

    report = patch_generate_data(team_updates, INJURIES, adp_final)
    report["sleeper_ids_found"] = len(sleeper_ids)
    report["team_change_count"] = len(report["team_changes"])
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Regenerating players.json…")
    subprocess.check_call([sys.executable, str(GEN)], cwd=str(ROOT))
    print("Done.")
    print(f"Team changes: {report['team_change_count']}")
    print(f"Injuries applied: {len(report['injury_updates'])}")
    print(f"ADP updates: {len(report['adp_updates'])}")
    if report["unmatched_inj"]:
        print("Unmatched injuries:", report["unmatched_inj"])
    if report["unmatched_adp"]:
        print("Unmatched ADP (ok if not in PLAYERS):", report["unmatched_adp"][:20])


if __name__ == "__main__":
    main()
