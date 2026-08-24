#!/usr/bin/env python3
"""
Full live data scrub:
  1) Sleeper players API → current NFL team (+ sleeper_id)
  2) Rookie flags from Sleeper (THIS YEAR = years_exp==0 or rookie_year==2026)
  3) Injuries from Sleeper injury_status / body part / notes (authoritative)
  4) Consensus 2026 ADP → adp_ppr / adp_half

Patches scripts/generate_data.py PLAYERS list, then runs generate_data,
then stamps sleeper_id / years_exp / rookie / injury fields onto data/players.json.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "scripts" / "generate_data.py"
PLAYERS_JSON = ROOT / "data" / "players.json"
SLEEPER_CACHE = ROOT / "data" / "sleeper_players_raw.json"
ADP_OUT = ROOT / "data" / "adp_2026_live.json"
REPORT = ROOT / "data" / "sync_report.json"

# NFL fantasy season year for "this year's rookies"
SEASON_YEAR = 2026

# Healthy baseline on our 1–32 injury scale (higher = healthier)
HEALTHY_INJURY = 27

# Optional manual severity overrides when Sleeper understates a known long-term case.
# Applied only if worse (lower) than the Sleeper-derived score.
MANUAL_INJURY_OVERRIDES = {
    # Keep empty unless we intentionally override Sleeper.
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


def load_sleeper(force_refresh: bool = False) -> dict:
    if SLEEPER_CACHE.exists() and not force_refresh:
        return json.loads(SLEEPER_CACHE.read_text(encoding="utf-8"))
    print("Fetching fresh Sleeper players API…")
    req = urllib.request.Request(
        "https://api.sleeper.app/v1/players/nfl",
        headers={"User-Agent": "fantasy-guide/1.0"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read().decode())
    SLEEPER_CACHE.write_text(json.dumps(data), encoding="utf-8")
    return data


def severe_injury_text(*parts: object) -> bool:
    blob = " ".join(str(p or "") for p in parts).lower()
    keys = (
        "acl",
        "achilles",
        "mcl",
        "pcl",
        "fracture",
        "surgery",
        "torn",
        "rupture",
        "season-ending",
        "season ending",
    )
    return any(k in blob for k in keys)


def sleeper_to_injury_score(
    injury_status: str | None,
    body_part: str | None = None,
    notes: str | None = None,
) -> tuple[int, int, str]:
    """
    Map Sleeper injury fields → (injury_score 1–32, adp_bump, note).
    Higher injury_score = healthier.
    """
    st = (injury_status or "").strip()
    st_l = st.lower()
    part = (body_part or "").strip()
    note_raw = (notes or "").strip()
    severe = severe_injury_text(part, note_raw, st)
    label_bits = [b for b in (st, part, note_raw) if b]
    label = " — ".join(label_bits) if label_bits else "Healthy"

    if not st:
        return HEALTHY_INJURY, 0, "Healthy"

    if st_l in ("ir", "injured_reserve"):
        return (3 if severe else 4), (60 if severe else 45), label
    if st_l == "pup":
        return (5 if severe else 6), (50 if severe else 35), label
    if st_l in ("dnr", "covid"):
        return 5, 40, label
    if st_l in ("out",):
        return (7 if severe else 9), (30 if severe else 18), label
    if st_l in ("doubtful",):
        return (10 if severe else 12), (22 if severe else 14), label
    if st_l in ("sus", "suspension"):
        return 14, 12, label
    if st_l in ("na", "inactive"):
        return 10, 20, label
    if st_l in ("questionable", "q"):
        if severe:
            return 13, 18, label
        return 18, 5, label
    if st_l in ("probable",):
        return 22, 2, label

    # Unknown status with a tag — treat cautiously
    return (12 if severe else 16), (15 if severe else 6), label


def is_this_year_rookie(pl: dict, season_year: int = SEASON_YEAR) -> bool:
    """True only for players entering their first NFL season this year."""
    if not pl:
        return False
    ye = pl.get("years_exp")
    meta = pl.get("metadata") or {}
    ry = meta.get("rookie_year") if isinstance(meta, dict) else None
    try:
        ry_i = int(ry) if ry is not None and str(ry).isdigit() else None
    except (TypeError, ValueError):
        ry_i = None
    # Explicit prior-year class → never a this-year rookie
    if ry_i is not None and ry_i < season_year:
        return False
    if ye is not None:
        try:
            if int(ye) >= 1:
                return False
            if int(ye) == 0:
                return True
        except (TypeError, ValueError):
            pass
    return ry_i == season_year


def sleeper_name_index(sleeper: dict) -> dict:
    idx = {}
    for pid, pl in sleeper.items():
        if not pl or not isinstance(pl, dict):
            continue
        full = pl.get("full_name") or f"{pl.get('first_name') or ''} {pl.get('last_name') or ''}".strip()
        if not full:
            continue
        key = norm(full)
        meta = pl.get("metadata") or {}
        entry = {
            "sleeper_id": pid,
            "team": pl.get("team"),
            "pos": pl.get("position"),
            "status": pl.get("status"),
            "injury_status": pl.get("injury_status"),
            "injury_body_part": pl.get("injury_body_part"),
            "injury_notes": pl.get("injury_notes"),
            "injury_start_date": pl.get("injury_start_date"),
            "practice_participation": pl.get("practice_participation"),
            "active": pl.get("active"),
            "full_name": full,
            "years_exp": pl.get("years_exp"),
            "rookie_year": meta.get("rookie_year") if isinstance(meta, dict) else None,
            "age": pl.get("age"),
            "is_rookie": is_this_year_rookie(pl),
        }
        idx.setdefault(key, []).append(entry)
    return idx


def pick_sleeper_hit(name: str, pos: str, team: str, idx: dict):
    key = norm(name)
    hits = list(idx.get(key) or [])
    if not hits:
        # last-name fallback (careful — prefer exact-ish)
        last = key.split()[-1] if key else ""
        first = key.split()[0] if key else ""
        if last and first:
            for k, arr in idx.items():
                parts = k.split()
                if len(parts) >= 2 and parts[0] == first and parts[-1] == last:
                    hits.extend(arr)
    if not hits:
        return None

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


def set_rookie_flag(block: str, want: bool) -> str:
    """Set or clear `"rookie": True/False` on a PLAYERS dict literal."""
    if re.search(r'"rookie"\s*:', block):
        return re.sub(r'"rookie"\s*:\s*(True|False)', f'"rookie": {want}', block, count=1)
    if want:
        return re.sub(r"\}\s*$", ', "rookie": True}', block)
    return block


def patch_generate_data(
    team_updates: dict,
    injury_updates: dict,
    adp_updates: dict,
    rookie_updates: dict,
) -> dict:
    text = GEN.read_text(encoding="utf-8")
    report = {
        "team_changes": [],
        "injury_updates": [],
        "adp_updates": [],
        "rookie_updates": [],
        "unmatched_inj": [],
        "unmatched_adp": [],
    }

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

        # Rookie (Sleeper-authoritative when we have a match)
        if name in rookie_updates:
            want = bool(rookie_updates[name]["rookie"])
            old_m = re.search(r'"rookie"\s*:\s*(True|False)', block)
            old = old_m.group(1) == "True" if old_m else False
            block = set_rookie_flag(block, want)
            if old != want:
                report["rookie_updates"].append(
                    {
                        "name": name,
                        "from": old,
                        "to": want,
                        "years_exp": rookie_updates[name].get("years_exp"),
                        "rookie_year": rookie_updates[name].get("rookie_year"),
                    }
                )

        return block

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


def stamp_players_json(sleeper_meta: dict) -> dict:
    """After generate_data, stamp sleeper_id / years_exp / rookie / injury onto players.json."""
    players = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    stamped = 0
    rookies = []
    cleared = []
    for p in players:
        meta = sleeper_meta.get(p["name"])
        if not meta:
            continue
        p["sleeper_id"] = meta.get("sleeper_id")
        p["years_exp"] = meta.get("years_exp")
        p["rookie_year"] = meta.get("rookie_year")
        p["injury_status"] = meta.get("injury_status")
        p["injury_body_part"] = meta.get("injury_body_part")
        p["injury_notes"] = meta.get("injury_notes")
        want = bool(meta.get("rookie"))
        if bool(p.get("rookie")) != want:
            if want:
                rookies.append(p["name"])
            else:
                cleared.append(p["name"])
        p["rookie"] = want
        stamped += 1
    PLAYERS_JSON.write_text(json.dumps(players, indent=2), encoding="utf-8")
    compact = ROOT / "data" / "players_compact.json"
    if compact.exists():
        compact.write_text(json.dumps(players), encoding="utf-8")
    return {"stamped": stamped, "set_rookie": rookies, "cleared_rookie": cleared}


def main():
    force = "--refresh" in sys.argv or not SLEEPER_CACHE.exists()
    print("Loading Sleeper…")
    sleeper = load_sleeper(force_refresh=force)
    idx = sleeper_name_index(sleeper)

    text = GEN.read_text(encoding="utf-8")
    names = re.findall(r'"name":\s*"([^"]+)"\s*,\s*"pos":\s*"([^"]+)"\s*,\s*"team":\s*"([^"]+)"', text)

    team_updates = {}
    sleeper_ids = {}
    rookie_updates = {}
    sleeper_meta = {}
    injury_updates = {}
    unmatched = []

    for name, pos, team in names:
        if pos == "DST":
            continue
        hit = pick_sleeper_hit(name, pos, team, idx)
        if not hit:
            unmatched.append(name)
            continue
        if hit.get("team") and hit["team"] != team:
            team_updates[name] = hit["team"]
        if hit.get("sleeper_id"):
            sleeper_ids[name] = hit["sleeper_id"]
        is_rook = bool(hit.get("is_rookie"))
        rookie_updates[name] = {
            "rookie": is_rook,
            "years_exp": hit.get("years_exp"),
            "rookie_year": hit.get("rookie_year"),
        }

        score, adp_bump, note = sleeper_to_injury_score(
            hit.get("injury_status"),
            hit.get("injury_body_part"),
            hit.get("injury_notes"),
        )
        # Manual override only if stricter
        if name in MANUAL_INJURY_OVERRIDES:
            ov = MANUAL_INJURY_OVERRIDES[name]
            if ov.get("injury", 99) < score:
                score = ov["injury"]
                adp_bump = max(adp_bump, ov.get("adp_bump", 0))
                note = ov.get("note", note)

        # Always write injury for matched players so cleared players recover
        injury_updates[name] = {
            "injury": score,
            "note": note,
            "adp_bump": adp_bump,
            "injury_status": hit.get("injury_status"),
            "injury_body_part": hit.get("injury_body_part"),
            "injury_notes": hit.get("injury_notes"),
            "source": "sleeper",
        }

        sleeper_meta[name] = {
            "sleeper_id": hit.get("sleeper_id"),
            "years_exp": hit.get("years_exp"),
            "rookie_year": hit.get("rookie_year"),
            "rookie": is_rook,
            "team": hit.get("team"),
            "injury_status": hit.get("injury_status"),
            "injury_body_part": hit.get("injury_body_part"),
            "injury_notes": hit.get("injury_notes"),
        }

    # Apply injury ADP bumps onto base ADP map
    adp_final = dict(ADP_2026)
    for name, meta in injury_updates.items():
        bump = meta.get("adp_bump") or 0
        if bump <= 0:
            continue
        base = adp_final.get(name)
        if base is not None:
            adp_final[name] = round(min(200, base + bump), 1)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ADP_OUT.write_text(
        json.dumps(
            {
                "updated": today,
                "adp": adp_final,
                "injuries": {
                    n: {
                        "injury": m["injury"],
                        "note": m["note"],
                        "adp_bump": m["adp_bump"],
                        "injury_status": m.get("injury_status"),
                        "injury_body_part": m.get("injury_body_part"),
                        "injury_notes": m.get("injury_notes"),
                    }
                    for n, m in injury_updates.items()
                    if m.get("injury_status") or m["injury"] < HEALTHY_INJURY
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    this_year = sorted(
        [n for n, m in rookie_updates.items() if m["rookie"]],
        key=lambda x: x,
    )
    not_rookies_notable = [
        n
        for n in (
            "Omarion Hampton",
            "Emeka Egbuka",
            "Colston Loveland",
            "Ashton Jeanty",
            "Cam Skattebo",
            "Tetairoa McMillan",
            "Shedeur Sanders",
            "Quinshon Judkins",
            "Tyler Warren",
        )
        if n in rookie_updates and not rookie_updates[n]["rookie"]
    ]

    print(f"Team changes to apply: {len(team_updates)}")
    for n, t in sorted(team_updates.items(), key=lambda x: x[0])[:40]:
        print(f"  {n}: -> {t}")
    if len(team_updates) > 40:
        print(f"  … +{len(team_updates) - 40} more")

    flagged = sorted(
        [
            (n, m)
            for n, m in injury_updates.items()
            if m.get("injury_status") or m["injury"] < HEALTHY_INJURY
        ],
        key=lambda x: (x[1].get("injury_status") or "ZZZ", x[0]),
    )
    print(f"\nSleeper injuries on our board: {len(flagged)}")
    for n, m in flagged:
        st = m.get("injury_status") or "Healthy"
        print(f"  {st:14} score={m['injury']:2d}  {n:28} {m['note'][:70]}")

    print(f"\nTHIS YEAR rookies (Sleeper years_exp==0 / ry=={SEASON_YEAR}): {len(this_year)}")
    for n in this_year:
        m = rookie_updates[n]
        print(f"  R  {n}  years={m['years_exp']} ry={m['rookie_year']}")
    print(f"\nConfirmed NOT this-year rookies (2025 class etc.): {len(not_rookies_notable)}")
    for n in not_rookies_notable:
        m = rookie_updates[n]
        print(f"  —  {n}  years={m['years_exp']} ry={m['rookie_year']}")

    report = patch_generate_data(team_updates, injury_updates, adp_final, rookie_updates)
    report["sleeper_ids_found"] = len(sleeper_ids)
    report["team_change_count"] = len(report["team_changes"])
    report["this_year_rookies"] = this_year
    report["rookie_flag_flips"] = report["rookie_updates"]
    report["unmatched_sleeper"] = unmatched
    report["sleeper_injuries"] = [
        {
            "name": n,
            "injury": m["injury"],
            "status": m.get("injury_status"),
            "note": m["note"],
        }
        for n, m in flagged
    ]

    print("Regenerating players.json…")
    subprocess.check_call([sys.executable, str(GEN)], cwd=str(ROOT))

    stamp = stamp_players_json(sleeper_meta)
    report["stamp"] = stamp
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Done.")
    print(f"Team changes: {report['team_change_count']}")
    print(f"Rookie flag flips: {len(report['rookie_updates'])}")
    for x in report["rookie_updates"]:
        print(f"  {x['name']}: {x['from']} → {x['to']} (years={x.get('years_exp')} ry={x.get('rookie_year')})")
    print(f"Stamped sleeper fields on {stamp['stamped']} players")
    print(f"Injury scores written: {len(report['injury_updates'])} (flagged {len(flagged)})")
    print(f"ADP updates: {len(report['adp_updates'])}")
    if unmatched:
        print(f"Unmatched to Sleeper ({len(unmatched)}):", unmatched[:15])
    if report["unmatched_inj"]:
        print("Unmatched injuries:", report["unmatched_inj"])
    if report["unmatched_adp"]:
        print("Unmatched ADP (ok if not in PLAYERS):", report["unmatched_adp"][:20])


if __name__ == "__main__":
    main()
