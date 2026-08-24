#!/usr/bin/env python3
"""Generate team + player JSON for the 2026 Fantasy Football Guide dashboard."""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data"

# Vegas win totals (DraftKings via FOX Sports, Jul 2026)
# Playcaller rank 32=best fantasy-friendly OC/scheme, 1=worst
# qb_rank 32=elite team starter (applies to WR/TE only in player metrics)
# ol_rank 32=best OL (applies to RB/QB only)
# sos_rank 32=easiest schedule for fantasy (inverted SOS)
# playcaller applies to QB/RB/WR/TE only — never K/DST

TEAMS = {
    "ARI": {"name": "Arizona Cardinals", "win_total": 3.5, "playcaller": 8, "qb_rank": 6, "ol_rank": 8, "sos_rank": 8, "scheme": "Balanced", "playcaller_name": "OC staff"},
    "ATL": {"name": "Atlanta Falcons", "win_total": 6.5, "playcaller": 14, "qb_rank": 12, "ol_rank": 14, "sos_rank": 16, "scheme": "West Coast", "playcaller_name": "Stefanski / staff"},
    "BAL": {"name": "Baltimore Ravens", "win_total": 11.5, "playcaller": 28, "qb_rank": 30, "ol_rank": 26, "sos_rank": 14, "scheme": "RPO / Option", "playcaller_name": "Jesse Minter staff"},
    "BUF": {"name": "Buffalo Bills", "win_total": 10.5, "playcaller": 30, "qb_rank": 32, "ol_rank": 28, "sos_rank": 12, "scheme": "Spread / Motion", "playcaller_name": "Joe Brady"},
    "CAR": {"name": "Carolina Panthers", "win_total": 7.5, "playcaller": 18, "qb_rank": 16, "ol_rank": 10, "sos_rank": 18, "scheme": "Spread", "playcaller_name": "Canales staff"},
    "CHI": {"name": "Chicago Bears", "win_total": 9.5, "playcaller": 31, "qb_rank": 24, "ol_rank": 20, "sos_rank": 2, "scheme": "Lions-style", "playcaller_name": "Ben Johnson"},
    "CIN": {"name": "Cincinnati Bengals", "win_total": 10.5, "playcaller": 29, "qb_rank": 28, "ol_rank": 18, "sos_rank": 30, "scheme": "Air Coryell-ish", "playcaller_name": "Zac Taylor / OC"},
    "CLE": {"name": "Cleveland Browns", "win_total": 5.5, "playcaller": 22, "qb_rank": 8, "ol_rank": 12, "sos_rank": 32, "scheme": "Monken vertical", "playcaller_name": "Todd Monken"},
    "DAL": {"name": "Dallas Cowboys", "win_total": 9.5, "playcaller": 26, "qb_rank": 25, "ol_rank": 27, "sos_rank": 22, "scheme": "Air raid lite", "playcaller_name": "Schottenheimer / OC"},
    "DEN": {"name": "Denver Broncos", "win_total": 9.5, "playcaller": 25, "qb_rank": 22, "ol_rank": 22, "sos_rank": 15, "scheme": "Spread option", "playcaller_name": "Sean Payton"},
    "DET": {"name": "Detroit Lions", "win_total": 10.5, "playcaller": 27, "qb_rank": 26, "ol_rank": 30, "sos_rank": 27, "scheme": "Aggressive / 13p", "playcaller_name": "John Morton / staff"},
    "GB":  {"name": "Green Bay Packers", "win_total": 9.5, "playcaller": 23, "qb_rank": 20, "ol_rank": 24, "sos_rank": 4, "scheme": "West Coast", "playcaller_name": "MLF / OC"},
    "HOU": {"name": "Houston Texans", "win_total": 9.5, "playcaller": 21, "qb_rank": 18, "ol_rank": 19, "sos_rank": 17, "scheme": "Spread", "playcaller_name": "Bobby Slowik successor"},
    "IND": {"name": "Indianapolis Colts", "win_total": 7.5, "playcaller": 17, "qb_rank": 17, "ol_rank": 21, "sos_rank": 19, "scheme": "Balanced", "playcaller_name": "Shane Steichen"},
    "JAX": {"name": "Jacksonville Jaguars", "win_total": 8.5, "playcaller": 32, "qb_rank": 27, "ol_rank": 17, "sos_rank": 20, "scheme": "McVay/Coen", "playcaller_name": "Liam Coen"},
    "KC":  {"name": "Kansas City Chiefs", "win_total": 10.5, "playcaller": 24, "qb_rank": 31, "ol_rank": 29, "sos_rank": 13, "scheme": "Reid motion", "playcaller_name": "Andy Reid"},
    # Kirk Cousins signed as starter; Mendoza is the developmental backup
    "LV":  {"name": "Las Vegas Raiders", "win_total": 6.5, "playcaller": 14, "qb_rank": 16, "ol_rank": 11, "sos_rank": 21, "scheme": "Pro style", "playcaller_name": "OC staff"},
    "LAC": {"name": "Los Angeles Chargers", "win_total": 9.5, "playcaller": 20, "qb_rank": 23, "ol_rank": 23, "sos_rank": 11, "scheme": "McDaniel / Harbaugh", "playcaller_name": "Mike McDaniel"},
    "LAR": {"name": "Los Angeles Rams", "win_total": 11.5, "playcaller": 30, "qb_rank": 29, "ol_rank": 25, "sos_rank": 10, "scheme": "McVay", "playcaller_name": "Sean McVay"},
    "MIA": {"name": "Miami Dolphins", "win_total": 4.5, "playcaller": 10, "qb_rank": 9, "ol_rank": 9, "sos_rank": 3, "scheme": "Rebuild", "playcaller_name": "Jeff Hafley staff"},
    "MIN": {"name": "Minnesota Vikings", "win_total": 8.5, "playcaller": 19, "qb_rank": 14, "ol_rank": 16, "sos_rank": 14, "scheme": "Outside zone", "playcaller_name": "KOC / OC"},
    "NE":  {"name": "New England Patriots", "win_total": 10.5, "playcaller": 28, "qb_rank": 28, "ol_rank": 15, "sos_rank": 6, "scheme": "Mayo / modern", "playcaller_name": "Josh McDaniels / staff"},
    "NO":  {"name": "New Orleans Saints", "win_total": 7.5, "playcaller": 16, "qb_rank": 13, "ol_rank": 13, "sos_rank": 31, "scheme": "Spread", "playcaller_name": "OC staff"},
    "NYG": {"name": "New York Giants", "win_total": 7.5, "playcaller": 15, "qb_rank": 15, "ol_rank": 12, "sos_rank": 18, "scheme": "Harbaugh power", "playcaller_name": "John Harbaugh staff"},
    "NYJ": {"name": "New York Jets", "win_total": 5.5, "playcaller": 11, "qb_rank": 11, "ol_rank": 7, "sos_rank": 23, "scheme": "Glenn / staff", "playcaller_name": "OC staff"},
    "PHI": {"name": "Philadelphia Eagles", "win_total": 10.5, "playcaller": 22, "qb_rank": 25, "ol_rank": 32, "sos_rank": 12, "scheme": "Tush push / gap", "playcaller_name": "Sean Mannion"},
    "PIT": {"name": "Pittsburgh Steelers", "win_total": 8.5, "playcaller": 13, "qb_rank": 14, "ol_rank": 18, "sos_rank": 16, "scheme": "McCarthy / West Coast", "playcaller_name": "Mike McCarthy"},
    "SF":  {"name": "San Francisco 49ers", "win_total": 9.5, "playcaller": 29, "qb_rank": 19, "ol_rank": 31, "sos_rank": 9, "scheme": "Shanahan", "playcaller_name": "Kyle Shanahan"},
    "SEA": {"name": "Seattle Seahawks", "win_total": 10.5, "playcaller": 24, "qb_rank": 21, "ol_rank": 20, "sos_rank": 11, "scheme": "Macdonald / OC", "playcaller_name": "OC staff"},
    "TB":  {"name": "Tampa Bay Buccaneers", "win_total": 8.5, "playcaller": 18, "qb_rank": 20, "ol_rank": 16, "sos_rank": 15, "scheme": "Spread", "playcaller_name": "Liam Coen successor"},
    "TEN": {"name": "Tennessee Titans", "win_total": 6.5, "playcaller": 20, "qb_rank": 12, "ol_rank": 14, "sos_rank": 25, "scheme": "Daboll", "playcaller_name": "Brian Daboll"},
    "WAS": {"name": "Washington Commanders", "win_total": 7.5, "playcaller": 26, "qb_rank": 27, "ol_rank": 19, "sos_rank": 17, "scheme": "Kingsbury", "playcaller_name": "Kliff Kingsbury"},
}

# Player fields:
# name, pos, team, age, adp_ppr, adp_half, fpts_ppr_2025, fpts_half_2025,
# opportunity (1-32), efficiency (1-32), injury (1-32 healthier=higher),
# bye, notes, sleeper_search (for ID match), espn_id optional

# 2025 PPR-ish fantasy production from public leaderboards + consensus 2026 ADP
# opportunity/efficiency/injury are expert-model 1-32 scores

PLAYERS = [
    # ===== RB =====
    {"name": "Jahmyr Gibbs", "pos": "RB", "team": "DET", "age": 24, "adp_ppr": 1.5, "adp_half": 1.5, "fpts_ppr": 366.9, "fpts_half": 328.4, "opportunity": 30, "efficiency": 32, "injury": 28, "bye": 8},
    {"name": "Bijan Robinson", "pos": "RB", "team": "ATL", "age": 24, "adp_ppr": 2.0, "adp_half": 2.0, "fpts_ppr": 370.8, "fpts_half": 331.3, "opportunity": 32, "efficiency": 30, "injury": 29, "bye": 12},
    {"name": "Christian McCaffrey", "pos": "RB", "team": "SF", "age": 30, "adp_ppr": 7.0, "adp_half": 7.5, "fpts_ppr": 416.6, "fpts_half": 365.6, "opportunity": 31, "efficiency": 31, "injury": 12, "bye": 14},
    {"name": "Jonathan Taylor", "pos": "RB", "team": "IND", "age": 27, "adp_ppr": 7.5, "adp_half": 6.5, "fpts_ppr": 320.0, "fpts_half": 300.0, "opportunity": 30, "efficiency": 28, "injury": 22, "bye": 14},
    {"name": "Saquon Barkley", "pos": "RB", "team": "PHI", "age": 29, "adp_ppr": 20.0, "adp_half": 18.0, "fpts_ppr": 290.0, "fpts_half": 270.0, "opportunity": 28, "efficiency": 27, "injury": 18, "bye": 9},
    {"name": "De'Von Achane", "pos": "RB", "team": "MIA", "age": 24, "adp_ppr": 10.5, "adp_half": 11.0, "fpts_ppr": 240.0, "fpts_half": 215.0, "opportunity": 26, "efficiency": 30, "injury": 20, "bye": 6},
    # 2025 1st-round pick — Year 2, NOT a 2026 rookie (975 rush / 55-346-5 rec ≈ 245 PPR)
    {"name": "Ashton Jeanty", "pos": "RB", "team": "LV", "age": 22, "adp_ppr": 15.0, "adp_half": 14.0, "fpts_ppr": 245.1, "fpts_half": 217.6, "opportunity": 31, "efficiency": 26, "injury": 19, "bye": 8},
    {"name": "Bucky Irving", "pos": "RB", "team": "TB", "age": 23, "adp_ppr": 32.0, "adp_half": 30.0, "fpts_ppr": 265.0, "fpts_half": 245.0, "opportunity": 27, "efficiency": 28, "injury": 26, "bye": 9},
    {"name": "Josh Jacobs", "pos": "RB", "team": "GB", "age": 28, "adp_ppr": 34.0, "adp_half": 30.0, "fpts_ppr": 255.0, "fpts_half": 245.0, "opportunity": 28, "efficiency": 24, "injury": 24, "bye": 5},
    {"name": "Chase Brown", "pos": "RB", "team": "CIN", "age": 25, "adp_ppr": 13.5, "adp_half": 12.5, "fpts_ppr": 250.0, "fpts_half": 230.0, "opportunity": 27, "efficiency": 25, "injury": 27, "bye": 10},
    {"name": "James Cook", "pos": "RB", "team": "BUF", "age": 26, "adp_ppr": 13.0, "adp_half": 12.0, "fpts_ppr": 280.0, "fpts_half": 265.0, "opportunity": 27, "efficiency": 29, "injury": 25, "bye": 7},
    # 2025 Chargers pick — Year 2 lead back
    {"name": "Omarion Hampton", "pos": "RB", "team": "LAC", "age": 21, "adp_ppr": 23.0, "adp_half": 21.0, "fpts_ppr": 180.0, "fpts_half": 168.0, "opportunity": 28, "efficiency": 25, "injury": 26, "bye": 12},
    {"name": "Kenneth Walker III", "pos": "RB", "team": "KC", "age": 25, "adp_ppr": 22.0, "adp_half": 20.0, "fpts_ppr": 195.0, "fpts_half": 185.0, "opportunity": 27, "efficiency": 25, "injury": 18, "bye": 10},
    {"name": "Kyren Williams", "pos": "RB", "team": "LAR", "age": 26, "adp_ppr": 36.0, "adp_half": 33.0, "fpts_ppr": 245.0, "fpts_half": 230.0, "opportunity": 26, "efficiency": 23, "injury": 16, "bye": 6},
    {"name": "Alvin Kamara", "pos": "RB", "team": "NO", "age": 31, "adp_ppr": 48.0, "adp_half": 50.0, "fpts_ppr": 220.0, "fpts_half": 195.0, "opportunity": 22, "efficiency": 24, "injury": 14, "bye": 11},
    {"name": "Derrick Henry", "pos": "RB", "team": "BAL", "age": 32, "adp_ppr": 18.0, "adp_half": 15.0, "fpts_ppr": 260.0, "fpts_half": 255.0, "opportunity": 26, "efficiency": 27, "injury": 17, "bye": 7},
    {"name": "Breece Hall", "pos": "RB", "team": "NYJ", "age": 25, "adp_ppr": 38.0, "adp_half": 35.0, "fpts_ppr": 200.0, "fpts_half": 185.0, "opportunity": 25, "efficiency": 22, "injury": 15, "bye": 9},
    # 2025 Browns pick — Year 2
    {"name": "Quinshon Judkins", "pos": "RB", "team": "CLE", "age": 22, "adp_ppr": 50.0, "adp_half": 46.0, "fpts_ppr": 165.0, "fpts_half": 155.0, "opportunity": 25, "efficiency": 22, "injury": 24, "bye": 9},
    {"name": "TreVeyon Henderson", "pos": "RB", "team": "NE", "age": 23, "adp_ppr": 55.0, "adp_half": 52.0, "fpts_ppr": 155.0, "fpts_half": 145.0, "opportunity": 24, "efficiency": 23, "injury": 25, "bye": 14},
    {"name": "James Conner", "pos": "RB", "team": "ARI", "age": 31, "adp_ppr": 75.0, "adp_half": 72.0, "fpts_ppr": 210.0, "fpts_half": 200.0, "opportunity": 16, "efficiency": 22, "injury": 10, "bye": 8},
    {"name": "David Montgomery", "pos": "RB", "team": "DET", "age": 29, "adp_ppr": 58.0, "adp_half": 54.0, "fpts_ppr": 200.0, "fpts_half": 190.0, "opportunity": 18, "efficiency": 24, "injury": 20, "bye": 8},
    {"name": "Tony Pollard", "pos": "RB", "team": "TEN", "age": 29, "adp_ppr": 65.0, "adp_half": 60.0, "fpts_ppr": 175.0, "fpts_half": 165.0, "opportunity": 22, "efficiency": 18, "injury": 22, "bye": 10},
    {"name": "Isiah Pacheco", "pos": "RB", "team": "DET", "age": 26, "adp_ppr": 62.0, "adp_half": 58.0, "fpts_ppr": 180.0, "fpts_half": 170.0, "opportunity": 17, "efficiency": 20, "injury": 14, "bye": 8},
    {"name": "Rhamondre Stevenson", "pos": "RB", "team": "NE", "age": 27, "adp_ppr": 72.0, "adp_half": 68.0, "fpts_ppr": 185.0, "fpts_half": 170.0, "opportunity": 20, "efficiency": 19, "injury": 19, "bye": 14},
    {"name": "Joe Mixon", "pos": "RB", "team": "HOU", "age": 30, "adp_ppr": 56.0, "adp_half": 52.0, "fpts_ppr": 230.0, "fpts_half": 220.0, "opportunity": 24, "efficiency": 21, "injury": 16, "bye": 14},
    {"name": "Travis Etienne Jr.", "pos": "RB", "team": "NO", "age": 27, "adp_ppr": 68.0, "adp_half": 65.0, "fpts_ppr": 160.0, "fpts_half": 150.0, "opportunity": 20, "efficiency": 17, "injury": 20, "bye": 11},
    {"name": "RJ Harvey", "pos": "RB", "team": "DEN", "age": 24, "adp_ppr": 75.0, "adp_half": 72.0, "fpts_ppr": 140.0, "fpts_half": 130.0, "opportunity": 21, "efficiency": 22, "injury": 25, "bye": 12},
    {"name": "Rachaad White", "pos": "RB", "team": "TB", "age": 27, "adp_ppr": 85.0, "adp_half": 88.0, "fpts_ppr": 170.0, "fpts_half": 150.0, "opportunity": 17, "efficiency": 16, "injury": 24, "bye": 9},
    {"name": "Javonte Williams", "pos": "RB", "team": "DAL", "age": 26, "adp_ppr": 70.0, "adp_half": 66.0, "fpts_ppr": 155.0, "fpts_half": 145.0, "opportunity": 21, "efficiency": 15, "injury": 13, "bye": 10},
    {"name": "Tyjae Spears", "pos": "RB", "team": "TEN", "age": 25, "adp_ppr": 95.0, "adp_half": 97.0, "fpts_ppr": 140.0, "fpts_half": 125.0, "opportunity": 16, "efficiency": 20, "injury": 18, "bye": 10},
    {"name": "Jaylen Warren", "pos": "RB", "team": "PIT", "age": 27, "adp_ppr": 82.0, "adp_half": 84.0, "fpts_ppr": 165.0, "fpts_half": 145.0, "opportunity": 19, "efficiency": 22, "injury": 23, "bye": 5},
    {"name": "Chuba Hubbard", "pos": "RB", "team": "CAR", "age": 27, "adp_ppr": 64.0, "adp_half": 60.0, "fpts_ppr": 210.0, "fpts_half": 195.0, "opportunity": 24, "efficiency": 20, "injury": 25, "bye": 14},
    {"name": "D'Andre Swift", "pos": "RB", "team": "CHI", "age": 27, "adp_ppr": 66.0, "adp_half": 62.0, "fpts_ppr": 190.0, "fpts_half": 175.0, "opportunity": 22, "efficiency": 19, "injury": 17, "bye": 7},
    {"name": "Brian Robinson Jr.", "pos": "RB", "team": "WAS", "age": 27, "adp_ppr": 88.0, "adp_half": 84.0, "fpts_ppr": 150.0, "fpts_half": 145.0, "opportunity": 18, "efficiency": 18, "injury": 21, "bye": 12},
    {"name": "Najee Harris", "pos": "RB", "team": "LAC", "age": 28, "adp_ppr": 95.0, "adp_half": 90.0, "fpts_ppr": 175.0, "fpts_half": 165.0, "opportunity": 15, "efficiency": 16, "injury": 24, "bye": 12},
    {"name": "Aaron Jones", "pos": "RB", "team": "MIN", "age": 31, "adp_ppr": 80.0, "adp_half": 78.0, "fpts_ppr": 195.0, "fpts_half": 175.0, "opportunity": 20, "efficiency": 23, "injury": 15, "bye": 6},
    {"name": "J.K. Dobbins", "pos": "RB", "team": "DEN", "age": 27, "adp_ppr": 78.0, "adp_half": 74.0, "fpts_ppr": 180.0, "fpts_half": 170.0, "opportunity": 19, "efficiency": 21, "injury": 11, "bye": 12},
    {"name": "Cam Skattebo", "pos": "RB", "team": "NYG", "age": 23, "adp_ppr": 98.0, "adp_half": 94.0, "fpts_ppr": 120.0, "fpts_half": 110.0, "opportunity": 21, "efficiency": 19, "injury": 26, "bye": 14},
    # 2026 draft class RBs
    {"name": "Jeremiyah Love", "pos": "RB", "team": "ARI", "age": 21, "adp_ppr": 28.0, "adp_half": 26.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 29, "efficiency": 25, "injury": 19, "bye": 8, "rookie": True},
    {"name": "Jadarian Price", "pos": "RB", "team": "SEA", "age": 22, "adp_ppr": 60.0, "adp_half": 56.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 26, "efficiency": 22, "injury": 28, "bye": 8, "rookie": True},
    {"name": "Mike Washington Jr.", "pos": "RB", "team": "LV", "age": 22, "adp_ppr": 150.0, "adp_half": 148.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 12, "efficiency": 16, "injury": 27, "bye": 8, "rookie": True},
    {"name": "Jonah Coleman", "pos": "RB", "team": "DEN", "age": 22, "adp_ppr": 140.0, "adp_half": 138.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 13, "efficiency": 18, "injury": 27, "bye": 12, "rookie": True},
    {"name": "Nicholas Singleton", "pos": "RB", "team": "TEN", "age": 22, "adp_ppr": 145.0, "adp_half": 142.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 12, "efficiency": 17, "injury": 27, "bye": 10, "rookie": True},
    {"name": "Rico Dowdle", "pos": "RB", "team": "CAR", "age": 28, "adp_ppr": 105.0, "adp_half": 102.0, "fpts_ppr": 145.0, "fpts_half": 135.0, "opportunity": 15, "efficiency": 18, "injury": 22, "bye": 14},
    {"name": "Zach Charbonnet", "pos": "RB", "team": "SEA", "age": 25, "adp_ppr": 110.0, "adp_half": 105.0, "fpts_ppr": 140.0, "fpts_half": 130.0, "opportunity": 14, "efficiency": 17, "injury": 25, "bye": 8},
    {"name": "Trey Benson", "pos": "RB", "team": "ARI", "age": 23, "adp_ppr": 118.0, "adp_half": 112.0, "fpts_ppr": 100.0, "fpts_half": 95.0, "opportunity": 12, "efficiency": 16, "injury": 20, "bye": 8},
    {"name": "Tank Bigsby", "pos": "RB", "team": "JAX", "age": 24, "adp_ppr": 92.0, "adp_half": 88.0, "fpts_ppr": 130.0, "fpts_half": 125.0, "opportunity": 22, "efficiency": 18, "injury": 24, "bye": 12},
    {"name": "Blake Corum", "pos": "RB", "team": "LAR", "age": 24, "adp_ppr": 120.0, "adp_half": 115.0, "fpts_ppr": 90.0, "fpts_half": 85.0, "opportunity": 14, "efficiency": 17, "injury": 27, "bye": 6},

    # ===== WR =====
    {"name": "Puka Nacua", "pos": "WR", "team": "LAR", "age": 25, "adp_ppr": 3.0, "adp_half": 5.0, "fpts_ppr": 375.0, "fpts_half": 310.5, "opportunity": 32, "efficiency": 31, "injury": 24, "bye": 6},
    {"name": "Ja'Marr Chase", "pos": "WR", "team": "CIN", "age": 26, "adp_ppr": 4.0, "adp_half": 6.0, "fpts_ppr": 310.0, "fpts_half": 265.0, "opportunity": 30, "efficiency": 29, "injury": 26, "bye": 10},
    {"name": "Jaxon Smith-Njigba", "pos": "WR", "team": "SEA", "age": 24, "adp_ppr": 5.5, "adp_half": 7.0, "fpts_ppr": 340.0, "fpts_half": 290.0, "opportunity": 31, "efficiency": 30, "injury": 28, "bye": 8},
    {"name": "Amon-Ra St. Brown", "pos": "WR", "team": "DET", "age": 26, "adp_ppr": 6.5, "adp_half": 8.0, "fpts_ppr": 305.0, "fpts_half": 255.0, "opportunity": 29, "efficiency": 29, "injury": 29, "bye": 8},
    {"name": "Drake London", "pos": "WR", "team": "ATL", "age": 25, "adp_ppr": 10.0, "adp_half": 12.0, "fpts_ppr": 255.0, "fpts_half": 220.0, "opportunity": 28, "efficiency": 25, "injury": 26, "bye": 12},
    {"name": "CeeDee Lamb", "pos": "WR", "team": "DAL", "age": 27, "adp_ppr": 11.0, "adp_half": 12.0, "fpts_ppr": 300.0, "fpts_half": 255.0, "opportunity": 30, "efficiency": 28, "injury": 27, "bye": 10},
    {"name": "Justin Jefferson", "pos": "WR", "team": "MIN", "age": 27, "adp_ppr": 12.0, "adp_half": 13.0, "fpts_ppr": 280.0, "fpts_half": 240.0, "opportunity": 28, "efficiency": 30, "injury": 25, "bye": 6},
    {"name": "Rashee Rice", "pos": "WR", "team": "KC", "age": 25, "adp_ppr": 15.0, "adp_half": 17.0, "fpts_ppr": 210.0, "fpts_half": 180.0, "opportunity": 29, "efficiency": 27, "injury": 22, "bye": 10},
    {"name": "A.J. Brown", "pos": "WR", "team": "NE", "age": 29, "adp_ppr": 18.0, "adp_half": 18.0, "fpts_ppr": 250.0, "fpts_half": 220.0, "opportunity": 27, "efficiency": 28, "injury": 19, "bye": 14},
    {"name": "Chris Olave", "pos": "WR", "team": "NO", "age": 26, "adp_ppr": 20.0, "adp_half": 22.0, "fpts_ppr": 180.0, "fpts_half": 155.0, "opportunity": 27, "efficiency": 21, "injury": 14, "bye": 11},
    {"name": "George Pickens", "pos": "WR", "team": "DAL", "age": 25, "adp_ppr": 20.0, "adp_half": 22.0, "fpts_ppr": 215.0, "fpts_half": 190.0, "opportunity": 26, "efficiency": 25, "injury": 23, "bye": 10},
    {"name": "Nico Collins", "pos": "WR", "team": "HOU", "age": 27, "adp_ppr": 21.0, "adp_half": 23.0, "fpts_ppr": 275.0, "fpts_half": 235.0, "opportunity": 27, "efficiency": 28, "injury": 20, "bye": 14},
    {"name": "Zay Flowers", "pos": "WR", "team": "BAL", "age": 25, "adp_ppr": 26.0, "adp_half": 28.0, "fpts_ppr": 215.0, "fpts_half": 185.0, "opportunity": 25, "efficiency": 24, "injury": 27, "bye": 7},
    {"name": "Malik Nabers", "pos": "WR", "team": "NYG", "age": 22, "adp_ppr": 27.0, "adp_half": 29.0, "fpts_ppr": 260.0, "fpts_half": 220.0, "opportunity": 29, "efficiency": 26, "injury": 18, "bye": 14},
    {"name": "Brian Thomas Jr.", "pos": "WR", "team": "JAX", "age": 23, "adp_ppr": 30.0, "adp_half": 31.0, "fpts_ppr": 290.0, "fpts_half": 250.0, "opportunity": 28, "efficiency": 30, "injury": 27, "bye": 12},
    {"name": "Tyreek Hill", "pos": "WR", "team": "MIA", "age": 32, "adp_ppr": 55.0, "adp_half": 58.0, "fpts_ppr": 200.0, "fpts_half": 175.0, "opportunity": 18, "efficiency": 24, "injury": 16, "bye": 6},
    {"name": "Tee Higgins", "pos": "WR", "team": "CIN", "age": 27, "adp_ppr": 33.0, "adp_half": 35.0, "fpts_ppr": 230.0, "fpts_half": 200.0, "opportunity": 24, "efficiency": 27, "injury": 17, "bye": 10},
    {"name": "Ladd McConkey", "pos": "WR", "team": "LAC", "age": 24, "adp_ppr": 31.0, "adp_half": 33.0, "fpts_ppr": 245.0, "fpts_half": 210.0, "opportunity": 26, "efficiency": 27, "injury": 26, "bye": 12},
    {"name": "Garrett Wilson", "pos": "WR", "team": "NYJ", "age": 26, "adp_ppr": 37.0, "adp_half": 39.0, "fpts_ppr": 220.0, "fpts_half": 185.0, "opportunity": 26, "efficiency": 22, "injury": 25, "bye": 9},
    {"name": "DJ Moore", "pos": "WR", "team": "BUF", "age": 29, "adp_ppr": 40.0, "adp_half": 41.0, "fpts_ppr": 210.0, "fpts_half": 185.0, "opportunity": 24, "efficiency": 23, "injury": 27, "bye": 7},
    {"name": "Marvin Harrison Jr.", "pos": "WR", "team": "ARI", "age": 23, "adp_ppr": 42.0, "adp_half": 44.0, "fpts_ppr": 195.0, "fpts_half": 170.0, "opportunity": 25, "efficiency": 20, "injury": 24, "bye": 8},
    {"name": "Terry McLaurin", "pos": "WR", "team": "WAS", "age": 30, "adp_ppr": 39.0, "adp_half": 40.0, "fpts_ppr": 240.0, "fpts_half": 210.0, "opportunity": 25, "efficiency": 26, "injury": 22, "bye": 12},
    {"name": "Davante Adams", "pos": "WR", "team": "LAR", "age": 33, "adp_ppr": 44.0, "adp_half": 46.0, "fpts_ppr": 235.0, "fpts_half": 205.0, "opportunity": 24, "efficiency": 25, "injury": 18, "bye": 6},
    {"name": "Mike Evans", "pos": "WR", "team": "TB", "age": 33, "adp_ppr": 46.0, "adp_half": 48.0, "fpts_ppr": 230.0, "fpts_half": 205.0, "opportunity": 23, "efficiency": 26, "injury": 17, "bye": 9},
    {"name": "DK Metcalf", "pos": "WR", "team": "PIT", "age": 28, "adp_ppr": 48.0, "adp_half": 50.0, "fpts_ppr": 200.0, "fpts_half": 180.0, "opportunity": 22, "efficiency": 24, "injury": 23, "bye": 5},
    {"name": "Jaylen Waddle", "pos": "WR", "team": "DEN", "age": 27, "adp_ppr": 43.0, "adp_half": 45.0, "fpts_ppr": 205.0, "fpts_half": 180.0, "opportunity": 24, "efficiency": 23, "injury": 21, "bye": 12},
    {"name": "Devonta Smith", "pos": "WR", "team": "PHI", "age": 27, "adp_ppr": 49.0, "adp_half": 51.0, "fpts_ppr": 210.0, "fpts_half": 185.0, "opportunity": 22, "efficiency": 25, "injury": 26, "bye": 9},
    {"name": "Courtland Sutton", "pos": "WR", "team": "DEN", "age": 30, "adp_ppr": 54.0, "adp_half": 56.0, "fpts_ppr": 220.0, "fpts_half": 195.0, "opportunity": 22, "efficiency": 23, "injury": 24, "bye": 12},
    {"name": "Jameson Williams", "pos": "WR", "team": "DET", "age": 25, "adp_ppr": 56.0, "adp_half": 54.0, "fpts_ppr": 200.0, "fpts_half": 180.0, "opportunity": 20, "efficiency": 28, "injury": 22, "bye": 8},
    {"name": "Rome Odunze", "pos": "WR", "team": "CHI", "age": 23, "adp_ppr": 58.0, "adp_half": 60.0, "fpts_ppr": 190.0, "fpts_half": 165.0, "opportunity": 23, "efficiency": 22, "injury": 25, "bye": 7},
    {"name": "Jauan Jennings", "pos": "WR", "team": "SF", "age": 28, "adp_ppr": 64.0, "adp_half": 66.0, "fpts_ppr": 200.0, "fpts_half": 175.0, "opportunity": 21, "efficiency": 22, "injury": 24, "bye": 14},
    {"name": "Ricky Pearsall", "pos": "WR", "team": "SF", "age": 25, "adp_ppr": 70.0, "adp_half": 72.0, "fpts_ppr": 175.0, "fpts_half": 155.0, "opportunity": 20, "efficiency": 23, "injury": 20, "bye": 14},
    {"name": "Jerry Jeudy", "pos": "WR", "team": "CLE", "age": 27, "adp_ppr": 75.0, "adp_half": 78.0, "fpts_ppr": 185.0, "fpts_half": 160.0, "opportunity": 22, "efficiency": 18, "injury": 25, "bye": 9},
    {"name": "Jordan Addison", "pos": "WR", "team": "MIN", "age": 24, "adp_ppr": 72.0, "adp_half": 74.0, "fpts_ppr": 185.0, "fpts_half": 165.0, "opportunity": 20, "efficiency": 24, "injury": 22, "bye": 6},
    {"name": "Calvin Ridley", "pos": "WR", "team": "TEN", "age": 31, "adp_ppr": 80.0, "adp_half": 82.0, "fpts_ppr": 170.0, "fpts_half": 150.0, "opportunity": 21, "efficiency": 19, "injury": 20, "bye": 10},
    {"name": "Chris Godwin", "pos": "WR", "team": "TB", "age": 30, "adp_ppr": 85.0, "adp_half": 88.0, "fpts_ppr": 160.0, "fpts_half": 140.0, "opportunity": 19, "efficiency": 22, "injury": 10, "bye": 9},
    {"name": "Stefon Diggs", "pos": "WR", "team": "NE", "age": 32, "adp_ppr": 90.0, "adp_half": 92.0, "fpts_ppr": 150.0, "fpts_half": 130.0, "opportunity": 18, "efficiency": 20, "injury": 14, "bye": 14},
    {"name": "Khalil Shakir", "pos": "WR", "team": "BUF", "age": 26, "adp_ppr": 68.0, "adp_half": 70.0, "fpts_ppr": 195.0, "fpts_half": 165.0, "opportunity": 20, "efficiency": 25, "injury": 26, "bye": 7},
    {"name": "Josh Downs", "pos": "WR", "team": "IND", "age": 25, "adp_ppr": 95.0, "adp_half": 98.0, "fpts_ppr": 175.0, "fpts_half": 150.0, "opportunity": 19, "efficiency": 23, "injury": 25, "bye": 14},
    {"name": "Rashid Shaheed", "pos": "WR", "team": "NO", "age": 27, "adp_ppr": 100.0, "adp_half": 95.0, "fpts_ppr": 160.0, "fpts_half": 145.0, "opportunity": 17, "efficiency": 26, "injury": 18, "bye": 11},
    {"name": "Xavier Worthy", "pos": "WR", "team": "KC", "age": 23, "adp_ppr": 66.0, "adp_half": 64.0, "fpts_ppr": 185.0, "fpts_half": 165.0, "opportunity": 21, "efficiency": 24, "injury": 23, "bye": 10},
    {"name": "Jayden Reed", "pos": "WR", "team": "GB", "age": 26, "adp_ppr": 78.0, "adp_half": 80.0, "fpts_ppr": 180.0, "fpts_half": 160.0, "opportunity": 19, "efficiency": 23, "injury": 20, "bye": 5},
    {"name": "Dontayvion Wicks", "pos": "WR", "team": "PHI", "age": 25, "adp_ppr": 110.0, "adp_half": 112.0, "fpts_ppr": 140.0, "fpts_half": 125.0, "opportunity": 18, "efficiency": 20, "injury": 24, "bye": 9},
    # 2026 draft class WRs (NFL Draft Apr 2026)
    {"name": "Carnell Tate", "pos": "WR", "team": "TEN", "age": 21, "adp_ppr": 82.0, "adp_half": 86.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 24, "efficiency": 22, "injury": 28, "bye": 10, "rookie": True},
    {"name": "Jordyn Tyson", "pos": "WR", "team": "NO", "age": 22, "adp_ppr": 130.0, "adp_half": 132.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 14, "efficiency": 23, "injury": 11, "bye": 11, "rookie": True},
    {"name": "Makai Lemon", "pos": "WR", "team": "PHI", "age": 21, "adp_ppr": 94.0, "adp_half": 98.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 20, "efficiency": 22, "injury": 28, "bye": 9, "rookie": True},
    {"name": "KC Concepcion", "pos": "WR", "team": "CLE", "age": 22, "adp_ppr": 108.0, "adp_half": 112.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 21, "efficiency": 21, "injury": 27, "bye": 9, "rookie": True},
    {"name": "Omar Cooper Jr.", "pos": "WR", "team": "NYJ", "age": 22, "adp_ppr": 118.0, "adp_half": 122.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 18, "efficiency": 20, "injury": 28, "bye": 9, "rookie": True},
    {"name": "Germie Bernard", "pos": "WR", "team": "PIT", "age": 22, "adp_ppr": 128.0, "adp_half": 132.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 16, "efficiency": 19, "injury": 27, "bye": 5, "rookie": True},
    {"name": "Denzel Boston", "pos": "WR", "team": "CLE", "age": 22, "adp_ppr": 132.0, "adp_half": 136.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 17, "efficiency": 19, "injury": 27, "bye": 9, "rookie": True},
    {"name": "De'Zhaun Stribling", "pos": "WR", "team": "SF", "age": 22, "adp_ppr": 138.0, "adp_half": 142.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 15, "efficiency": 20, "injury": 26, "bye": 14, "rookie": True},
    {"name": "Antonio Williams", "pos": "WR", "team": "WAS", "age": 22, "adp_ppr": 142.0, "adp_half": 146.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 15, "efficiency": 18, "injury": 27, "bye": 12, "rookie": True},
    {"name": "Zachariah Branch", "pos": "WR", "team": "ATL", "age": 21, "adp_ppr": 148.0, "adp_half": 150.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 14, "efficiency": 18, "injury": 27, "bye": 12, "rookie": True},
    {"name": "Elijah Sarratt", "pos": "WR", "team": "BAL", "age": 22, "adp_ppr": 155.0, "adp_half": 158.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 13, "efficiency": 17, "injury": 27, "bye": 7, "rookie": True},
    {"name": "Malachi Fields", "pos": "WR", "team": "NYG", "age": 22, "adp_ppr": 160.0, "adp_half": 162.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 13, "efficiency": 17, "injury": 26, "bye": 14, "rookie": True},
    {"name": "Ted Hurst", "pos": "WR", "team": "TB", "age": 22, "adp_ppr": 165.0, "adp_half": 168.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 12, "efficiency": 16, "injury": 27, "bye": 9, "rookie": True},
    {"name": "Cooper Kupp", "pos": "WR", "team": "SEA", "age": 33, "adp_ppr": 115.0, "adp_half": 118.0, "fpts_ppr": 150.0, "fpts_half": 130.0, "opportunity": 16, "efficiency": 21, "injury": 8, "bye": 8},
    {"name": "Deebo Samuel", "pos": "WR", "team": "WAS", "age": 30, "adp_ppr": 88.0, "adp_half": 85.0, "fpts_ppr": 170.0, "fpts_half": 155.0, "opportunity": 18, "efficiency": 22, "injury": 15, "bye": 12},
    {"name": "Michael Pittman Jr.", "pos": "WR", "team": "IND", "age": 28, "adp_ppr": 92.0, "adp_half": 94.0, "fpts_ppr": 175.0, "fpts_half": 155.0, "opportunity": 20, "efficiency": 18, "injury": 22, "bye": 14},
    {"name": "Keenan Allen", "pos": "WR", "team": "LAC", "age": 34, "adp_ppr": 120.0, "adp_half": 125.0, "fpts_ppr": 165.0, "fpts_half": 140.0, "opportunity": 17, "efficiency": 20, "injury": 12, "bye": 12},
    {"name": "Diontae Johnson", "pos": "WR", "team": "CLE", "age": 30, "adp_ppr": 130.0, "adp_half": 132.0, "fpts_ppr": 140.0, "fpts_half": 120.0, "opportunity": 18, "efficiency": 16, "injury": 19, "bye": 9},
    {"name": "Wan'Dale Robinson", "pos": "WR", "team": "NYG", "age": 25, "adp_ppr": 135.0, "adp_half": 140.0, "fpts_ppr": 155.0, "fpts_half": 125.0, "opportunity": 17, "efficiency": 18, "injury": 26, "bye": 14},
    {"name": "Adam Thielen", "pos": "WR", "team": "CAR", "age": 36, "adp_ppr": 140.0, "adp_half": 145.0, "fpts_ppr": 160.0, "fpts_half": 140.0, "opportunity": 15, "efficiency": 19, "injury": 20, "bye": 14},
    {"name": "Jalen Coker", "pos": "WR", "team": "CAR", "age": 24, "adp_ppr": 145.0, "adp_half": 148.0, "fpts_ppr": 130.0, "fpts_half": 115.0, "opportunity": 16, "efficiency": 20, "injury": 25, "bye": 14},
    {"name": "Tetairoa McMillan", "pos": "WR", "team": "CAR", "age": 23, "adp_ppr": 33.0, "adp_half": 34.0, "fpts_ppr": 220.0, "fpts_half": 190.0, "opportunity": 26, "efficiency": 24, "injury": 27, "bye": 14},
    {"name": "Emeka Egbuka", "pos": "WR", "team": "TB", "age": 23, "adp_ppr": 82.0, "adp_half": 84.0, "fpts_ppr": 150.0, "fpts_half": 130.0, "opportunity": 19, "efficiency": 21, "injury": 26, "bye": 9},

    # ===== QB =====
    {"name": "Josh Allen", "pos": "QB", "team": "BUF", "age": 30, "adp_ppr": 27.0, "adp_half": 26.0, "fpts_ppr": 388.6, "fpts_half": 388.6, "opportunity": 32, "efficiency": 31, "injury": 28, "bye": 7},
    {"name": "Lamar Jackson", "pos": "QB", "team": "BAL", "age": 29, "adp_ppr": 31.0, "adp_half": 29.0, "fpts_ppr": 232.9, "fpts_half": 232.9, "opportunity": 30, "efficiency": 32, "injury": 14, "bye": 7},
    {"name": "Drake Maye", "pos": "QB", "team": "NE", "age": 23, "adp_ppr": 29.0, "adp_half": 28.0, "fpts_ppr": 368.8, "fpts_half": 368.8, "opportunity": 30, "efficiency": 29, "injury": 27, "bye": 14},
    {"name": "Joe Burrow", "pos": "QB", "team": "CIN", "age": 29, "adp_ppr": 37.0, "adp_half": 36.0, "fpts_ppr": 144.5, "fpts_half": 144.5, "opportunity": 29, "efficiency": 30, "injury": 12, "bye": 10},
    {"name": "Jalen Hurts", "pos": "QB", "team": "PHI", "age": 28, "adp_ppr": 39.0, "adp_half": 37.0, "fpts_ppr": 319.1, "fpts_half": 319.1, "opportunity": 28, "efficiency": 28, "injury": 22, "bye": 9},
    {"name": "Patrick Mahomes", "pos": "QB", "team": "KC", "age": 30, "adp_ppr": 43.0, "adp_half": 41.0, "fpts_ppr": 303.7, "fpts_half": 303.7, "opportunity": 29, "efficiency": 29, "injury": 15, "bye": 10},
    {"name": "Jayden Daniels", "pos": "QB", "team": "WAS", "age": 25, "adp_ppr": 41.0, "adp_half": 39.0, "fpts_ppr": 122.3, "fpts_half": 122.3, "opportunity": 28, "efficiency": 30, "injury": 13, "bye": 12},
    {"name": "Baker Mayfield", "pos": "QB", "team": "TB", "age": 31, "adp_ppr": 72.0, "adp_half": 70.0, "fpts_ppr": 295.9, "fpts_half": 295.9, "opportunity": 25, "efficiency": 24, "injury": 26, "bye": 9},
    {"name": "Bo Nix", "pos": "QB", "team": "DEN", "age": 26, "adp_ppr": 65.0, "adp_half": 63.0, "fpts_ppr": 322.8, "fpts_half": 322.8, "opportunity": 26, "efficiency": 24, "injury": 27, "bye": 12},
    {"name": "Justin Herbert", "pos": "QB", "team": "LAC", "age": 28, "adp_ppr": 68.0, "adp_half": 66.0, "fpts_ppr": 314.9, "fpts_half": 314.9, "opportunity": 26, "efficiency": 25, "injury": 20, "bye": 12},
    {"name": "Dak Prescott", "pos": "QB", "team": "DAL", "age": 33, "adp_ppr": 70.0, "adp_half": 68.0, "fpts_ppr": 331.8, "fpts_half": 331.8, "opportunity": 27, "efficiency": 25, "injury": 16, "bye": 10},
    {"name": "Jared Goff", "pos": "QB", "team": "DET", "age": 31, "adp_ppr": 85.0, "adp_half": 83.0, "fpts_ppr": 323.1, "fpts_half": 323.1, "opportunity": 25, "efficiency": 26, "injury": 28, "bye": 8},
    {"name": "Caleb Williams", "pos": "QB", "team": "CHI", "age": 24, "adp_ppr": 75.0, "adp_half": 74.0, "fpts_ppr": 322.0, "fpts_half": 322.0, "opportunity": 27, "efficiency": 23, "injury": 26, "bye": 7},
    {"name": "Trevor Lawrence", "pos": "QB", "team": "JAX", "age": 26, "adp_ppr": 78.0, "adp_half": 76.0, "fpts_ppr": 366.2, "fpts_half": 366.2, "opportunity": 27, "efficiency": 24, "injury": 24, "bye": 12},
    {"name": "Matthew Stafford", "pos": "QB", "team": "LAR", "age": 38, "adp_ppr": 90.0, "adp_half": 88.0, "fpts_ppr": 372.4, "fpts_half": 372.4, "opportunity": 28, "efficiency": 27, "injury": 18, "bye": 6},
    {"name": "Jordan Love", "pos": "QB", "team": "GB", "age": 27, "adp_ppr": 95.0, "adp_half": 93.0, "fpts_ppr": 247.1, "fpts_half": 247.1, "opportunity": 24, "efficiency": 23, "injury": 20, "bye": 5},
    {"name": "C.J. Stroud", "pos": "QB", "team": "HOU", "age": 24, "adp_ppr": 100.0, "adp_half": 98.0, "fpts_ppr": 224.5, "fpts_half": 224.5, "opportunity": 23, "efficiency": 22, "injury": 22, "bye": 14},
    {"name": "Brock Purdy", "pos": "QB", "team": "SF", "age": 26, "adp_ppr": 105.0, "adp_half": 103.0, "fpts_ppr": 199.4, "fpts_half": 199.4, "opportunity": 24, "efficiency": 26, "injury": 15, "bye": 14},
    {"name": "Kyler Murray", "pos": "QB", "team": "MIN", "age": 29, "adp_ppr": 110.0, "adp_half": 108.0, "fpts_ppr": 85.8, "fpts_half": 85.8, "opportunity": 22, "efficiency": 24, "injury": 14, "bye": 6},
    {"name": "Sam Darnold", "pos": "QB", "team": "SEA", "age": 29, "adp_ppr": 115.0, "adp_half": 112.0, "fpts_ppr": 271.4, "fpts_half": 271.4, "opportunity": 22, "efficiency": 21, "injury": 25, "bye": 8},
    {"name": "Jaxson Dart", "pos": "QB", "team": "NYG", "age": 23, "adp_ppr": 120.0, "adp_half": 118.0, "fpts_ppr": 253.6, "fpts_half": 253.6, "opportunity": 23, "efficiency": 20, "injury": 24, "bye": 14},
    {"name": "Tua Tagovailoa", "pos": "QB", "team": "ATL", "age": 28, "adp_ppr": 130.0, "adp_half": 128.0, "fpts_ppr": 190.7, "fpts_half": 190.7, "opportunity": 20, "efficiency": 22, "injury": 10, "bye": 12},
    {"name": "Daniel Jones", "pos": "QB", "team": "IND", "age": 29, "adp_ppr": 135.0, "adp_half": 132.0, "fpts_ppr": 246.4, "fpts_half": 246.4, "opportunity": 21, "efficiency": 19, "injury": 16, "bye": 14},
    {"name": "Cam Ward", "pos": "QB", "team": "TEN", "age": 23, "adp_ppr": 140.0, "adp_half": 138.0, "fpts_ppr": 214.7, "fpts_half": 214.7, "opportunity": 22, "efficiency": 16, "injury": 26, "bye": 10},
    {"name": "Bryce Young", "pos": "QB", "team": "CAR", "age": 25, "adp_ppr": 145.0, "adp_half": 142.0, "fpts_ppr": 246.0, "fpts_half": 246.0, "opportunity": 21, "efficiency": 18, "injury": 25, "bye": 14},
    {"name": "Aaron Rodgers", "pos": "QB", "team": "PIT", "age": 42, "adp_ppr": 150.0, "adp_half": 148.0, "fpts_ppr": 241.0, "fpts_half": 241.0, "opportunity": 20, "efficiency": 22, "injury": 12, "bye": 5},
    {"name": "Geno Smith", "pos": "QB", "team": "NYJ", "age": 35, "adp_ppr": 160.0, "adp_half": 158.0, "fpts_ppr": 207.9, "fpts_half": 207.9, "opportunity": 18, "efficiency": 17, "injury": 22, "bye": 9},
    {"name": "Malik Willis", "pos": "QB", "team": "MIA", "age": 27, "adp_ppr": 170.0, "adp_half": 168.0, "fpts_ppr": 53.2, "fpts_half": 53.2, "opportunity": 16, "efficiency": 18, "injury": 24, "bye": 6},
    {"name": "Michael Penix Jr.", "pos": "QB", "team": "ATL", "age": 25, "adp_ppr": 155.0, "adp_half": 152.0, "fpts_ppr": 128.3, "fpts_half": 128.3, "opportunity": 17, "efficiency": 19, "injury": 18, "bye": 12},
    {"name": "J.J. McCarthy", "pos": "QB", "team": "MIN", "age": 23, "adp_ppr": 148.0, "adp_half": 145.0, "fpts_ppr": 151.4, "fpts_half": 151.4, "opportunity": 19, "efficiency": 18, "injury": 15, "bye": 6},
    {"name": "Tyler Shough", "pos": "QB", "team": "NO", "age": 26, "adp_ppr": 165.0, "adp_half": 162.0, "fpts_ppr": 172.0, "fpts_half": 172.0, "opportunity": 18, "efficiency": 17, "injury": 23, "bye": 11},
    {"name": "Shedeur Sanders", "pos": "QB", "team": "CLE", "age": 24, "adp_ppr": 175.0, "adp_half": 172.0, "fpts_ppr": 106.9, "fpts_half": 106.9, "opportunity": 15, "efficiency": 14, "injury": 25, "bye": 9},
    {"name": "Kirk Cousins", "pos": "QB", "team": "LV", "age": 37, "adp_ppr": 155.0, "adp_half": 152.0, "fpts_ppr": 268.0, "fpts_half": 268.0, "opportunity": 22, "efficiency": 20, "injury": 20, "bye": 8},
    # 2026 draft class QBs — Mendoza is backup behind Cousins
    {"name": "Fernando Mendoza", "pos": "QB", "team": "LV", "age": 22, "adp_ppr": 172.0, "adp_half": 170.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 12, "efficiency": 22, "injury": 28, "bye": 8, "rookie": True},
    {"name": "Ty Simpson", "pos": "QB", "team": "LAR", "age": 22, "adp_ppr": 185.0, "adp_half": 182.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 10, "efficiency": 18, "injury": 28, "bye": 6, "rookie": True},

    # ===== TE =====
    {"name": "Trey McBride", "pos": "TE", "team": "ARI", "age": 26, "adp_ppr": 29.0, "adp_half": 31.0, "fpts_ppr": 250.0, "fpts_half": 210.0, "opportunity": 31, "efficiency": 27, "injury": 28, "bye": 8},
    {"name": "Brock Bowers", "pos": "TE", "team": "LV", "age": 23, "adp_ppr": 35.0, "adp_half": 37.0, "fpts_ppr": 260.0, "fpts_half": 220.0, "opportunity": 32, "efficiency": 28, "injury": 24, "bye": 8},
    {"name": "George Kittle", "pos": "TE", "team": "SF", "age": 32, "adp_ppr": 45.0, "adp_half": 47.0, "fpts_ppr": 180.0, "fpts_half": 160.0, "opportunity": 24, "efficiency": 30, "injury": 14, "bye": 14},
    {"name": "Travis Kelce", "pos": "TE", "team": "KC", "age": 36, "adp_ppr": 55.0, "adp_half": 58.0, "fpts_ppr": 200.0, "fpts_half": 175.0, "opportunity": 25, "efficiency": 24, "injury": 18, "bye": 10},
    {"name": "Sam LaPorta", "pos": "TE", "team": "DET", "age": 25, "adp_ppr": 50.0, "adp_half": 52.0, "fpts_ppr": 195.0, "fpts_half": 170.0, "opportunity": 26, "efficiency": 26, "injury": 22, "bye": 8},
    {"name": "Mark Andrews", "pos": "TE", "team": "BAL", "age": 30, "adp_ppr": 62.0, "adp_half": 60.0, "fpts_ppr": 185.0, "fpts_half": 165.0, "opportunity": 23, "efficiency": 25, "injury": 16, "bye": 7},
    {"name": "David Njoku", "pos": "TE", "team": "CLE", "age": 30, "adp_ppr": 85.0, "adp_half": 88.0, "fpts_ppr": 160.0, "fpts_half": 140.0, "opportunity": 22, "efficiency": 20, "injury": 15, "bye": 9},
    {"name": "T.J. Hockenson", "pos": "TE", "team": "MIN", "age": 29, "adp_ppr": 80.0, "adp_half": 82.0, "fpts_ppr": 155.0, "fpts_half": 135.0, "opportunity": 22, "efficiency": 21, "injury": 12, "bye": 6},
    {"name": "Evan Engram", "pos": "TE", "team": "JAX", "age": 31, "adp_ppr": 90.0, "adp_half": 95.0, "fpts_ppr": 170.0, "fpts_half": 140.0, "opportunity": 21, "efficiency": 20, "injury": 14, "bye": 12},
    {"name": "Kyle Pitts", "pos": "TE", "team": "ATL", "age": 25, "adp_ppr": 95.0, "adp_half": 98.0, "fpts_ppr": 145.0, "fpts_half": 125.0, "opportunity": 20, "efficiency": 19, "injury": 20, "bye": 12},
    {"name": "Dallas Goedert", "pos": "TE", "team": "PHI", "age": 31, "adp_ppr": 100.0, "adp_half": 102.0, "fpts_ppr": 150.0, "fpts_half": 130.0, "opportunity": 19, "efficiency": 22, "injury": 17, "bye": 9},
    {"name": "Jake Ferguson", "pos": "TE", "team": "DAL", "age": 27, "adp_ppr": 88.0, "adp_half": 90.0, "fpts_ppr": 175.0, "fpts_half": 150.0, "opportunity": 23, "efficiency": 21, "injury": 24, "bye": 10},
    {"name": "Tucker Kraft", "pos": "TE", "team": "GB", "age": 25, "adp_ppr": 75.0, "adp_half": 77.0, "fpts_ppr": 180.0, "fpts_half": 160.0, "opportunity": 24, "efficiency": 25, "injury": 25, "bye": 5},
    {"name": "Hunter Henry", "pos": "TE", "team": "NE", "age": 31, "adp_ppr": 110.0, "adp_half": 112.0, "fpts_ppr": 155.0, "fpts_half": 140.0, "opportunity": 18, "efficiency": 22, "injury": 22, "bye": 14},
    {"name": "Pat Freiermuth", "pos": "TE", "team": "PIT", "age": 27, "adp_ppr": 120.0, "adp_half": 122.0, "fpts_ppr": 140.0, "fpts_half": 125.0, "opportunity": 17, "efficiency": 18, "injury": 24, "bye": 5},
    {"name": "Jonnu Smith", "pos": "TE", "team": "MIA", "age": 31, "adp_ppr": 105.0, "adp_half": 110.0, "fpts_ppr": 165.0, "fpts_half": 140.0, "opportunity": 18, "efficiency": 20, "injury": 23, "bye": 6},
    {"name": "Isaiah Likely", "pos": "TE", "team": "BAL", "age": 26, "adp_ppr": 125.0, "adp_half": 128.0, "fpts_ppr": 130.0, "fpts_half": 115.0, "opportunity": 16, "efficiency": 23, "injury": 26, "bye": 7},
    {"name": "Cole Kmet", "pos": "TE", "team": "CHI", "age": 27, "adp_ppr": 130.0, "adp_half": 132.0, "fpts_ppr": 135.0, "fpts_half": 120.0, "opportunity": 17, "efficiency": 18, "injury": 25, "bye": 7},
    {"name": "Dalton Kincaid", "pos": "TE", "team": "BUF", "age": 26, "adp_ppr": 98.0, "adp_half": 100.0, "fpts_ppr": 145.0, "fpts_half": 125.0, "opportunity": 20, "efficiency": 21, "injury": 19, "bye": 7},
    {"name": "Cade Otton", "pos": "TE", "team": "TB", "age": 27, "adp_ppr": 140.0, "adp_half": 142.0, "fpts_ppr": 125.0, "fpts_half": 110.0, "opportunity": 16, "efficiency": 17, "injury": 24, "bye": 9},
    {"name": "Chig Okonkwo", "pos": "TE", "team": "TEN", "age": 26, "adp_ppr": 145.0, "adp_half": 148.0, "fpts_ppr": 120.0, "fpts_half": 105.0, "opportunity": 16, "efficiency": 18, "injury": 26, "bye": 10},
    {"name": "Tyler Warren", "pos": "TE", "team": "IND", "age": 23, "adp_ppr": 70.0, "adp_half": 72.0, "fpts_ppr": 160.0, "fpts_half": 140.0, "opportunity": 24, "efficiency": 22, "injury": 27, "bye": 14},
    {"name": "Colston Loveland", "pos": "TE", "team": "CHI", "age": 22, "adp_ppr": 115.0, "adp_half": 118.0, "fpts_ppr": 100.0, "fpts_half": 90.0, "opportunity": 19, "efficiency": 20, "injury": 28, "bye": 7},
    # 2026 draft class TEs
    {"name": "Kenyon Sadiq", "pos": "TE", "team": "NYJ", "age": 21, "adp_ppr": 110.0, "adp_half": 113.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 22, "efficiency": 21, "injury": 28, "bye": 9, "rookie": True},
    {"name": "Eli Stowers", "pos": "TE", "team": "PHI", "age": 22, "adp_ppr": 148.0, "adp_half": 150.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 15, "efficiency": 17, "injury": 28, "bye": 9, "rookie": True},
    {"name": "Eli Raridon", "pos": "TE", "team": "NE", "age": 22, "adp_ppr": 168.0, "adp_half": 170.0, "fpts_ppr": 0.0, "fpts_half": 0.0, "opportunity": 12, "efficiency": 15, "injury": 27, "bye": 14, "rookie": True},

    # ===== K =====
    {"name": "Brandon Aubrey", "pos": "K", "team": "DAL", "age": 31, "adp_ppr": 120.0, "adp_half": 118.0, "fpts_ppr": 175.0, "fpts_half": 175.0, "opportunity": 30, "efficiency": 32, "injury": 28, "bye": 10},
    {"name": "Justin Tucker", "pos": "K", "team": "BAL", "age": 36, "adp_ppr": 140.0, "adp_half": 138.0, "fpts_ppr": 140.0, "fpts_half": 140.0, "opportunity": 28, "efficiency": 28, "injury": 24, "bye": 7},
    {"name": "Harrison Butker", "pos": "K", "team": "KC", "age": 30, "adp_ppr": 145.0, "adp_half": 143.0, "fpts_ppr": 145.0, "fpts_half": 145.0, "opportunity": 28, "efficiency": 29, "injury": 26, "bye": 10},
    {"name": "Jake Elliott", "pos": "K", "team": "PHI", "age": 31, "adp_ppr": 150.0, "adp_half": 148.0, "fpts_ppr": 142.0, "fpts_half": 142.0, "opportunity": 27, "efficiency": 27, "injury": 28, "bye": 9},
    {"name": "Cameron Dicker", "pos": "K", "team": "LAC", "age": 26, "adp_ppr": 148.0, "adp_half": 146.0, "fpts_ppr": 150.0, "fpts_half": 150.0, "opportunity": 26, "efficiency": 30, "injury": 29, "bye": 12},
    {"name": "Younghoe Koo", "pos": "K", "team": "ATL", "age": 32, "adp_ppr": 155.0, "adp_half": 153.0, "fpts_ppr": 135.0, "fpts_half": 135.0, "opportunity": 22, "efficiency": 26, "injury": 25, "bye": 12},
    {"name": "Tyler Bass", "pos": "K", "team": "BUF", "age": 29, "adp_ppr": 152.0, "adp_half": 150.0, "fpts_ppr": 138.0, "fpts_half": 138.0, "opportunity": 27, "efficiency": 24, "injury": 27, "bye": 7},
    {"name": "Jason Myers", "pos": "K", "team": "SEA", "age": 35, "adp_ppr": 158.0, "adp_half": 156.0, "fpts_ppr": 148.0, "fpts_half": 148.0, "opportunity": 27, "efficiency": 28, "injury": 26, "bye": 8},
    {"name": "Chase McLaughlin", "pos": "K", "team": "TB", "age": 30, "adp_ppr": 160.0, "adp_half": 158.0, "fpts_ppr": 140.0, "fpts_half": 140.0, "opportunity": 24, "efficiency": 27, "injury": 28, "bye": 9},
    {"name": "Wil Lutz", "pos": "K", "team": "DEN", "age": 32, "adp_ppr": 162.0, "adp_half": 160.0, "fpts_ppr": 142.0, "fpts_half": 142.0, "opportunity": 25, "efficiency": 25, "injury": 27, "bye": 12},
    {"name": "Jake Bates", "pos": "K", "team": "DET", "age": 27, "adp_ppr": 154.0, "adp_half": 152.0, "fpts_ppr": 155.0, "fpts_half": 155.0, "opportunity": 28, "efficiency": 28, "injury": 29, "bye": 8},
    {"name": "Ka'imi Fairbairn", "pos": "K", "team": "HOU", "age": 32, "adp_ppr": 165.0, "adp_half": 163.0, "fpts_ppr": 138.0, "fpts_half": 138.0, "opportunity": 24, "efficiency": 26, "injury": 26, "bye": 14},
    {"name": "Chris Boswell", "pos": "K", "team": "PIT", "age": 35, "adp_ppr": 168.0, "adp_half": 166.0, "fpts_ppr": 145.0, "fpts_half": 145.0, "opportunity": 23, "efficiency": 29, "injury": 25, "bye": 5},
    {"name": "Evan McPherson", "pos": "K", "team": "CIN", "age": 27, "adp_ppr": 156.0, "adp_half": 154.0, "fpts_ppr": 130.0, "fpts_half": 130.0, "opportunity": 26, "efficiency": 25, "injury": 27, "bye": 10},
    {"name": "Matt Gay", "pos": "K", "team": "WAS", "age": 32, "adp_ppr": 170.0, "adp_half": 168.0, "fpts_ppr": 125.0, "fpts_half": 125.0, "opportunity": 22, "efficiency": 24, "injury": 26, "bye": 12},
    {"name": "Daniel Carlson", "pos": "K", "team": "LV", "age": 31, "adp_ppr": 175.0, "adp_half": 173.0, "fpts_ppr": 120.0, "fpts_half": 120.0, "opportunity": 18, "efficiency": 25, "injury": 28, "bye": 8},

    # ===== DST =====
    {"name": "Denver Broncos", "pos": "DST", "team": "DEN", "age": 0, "adp_ppr": 100.0, "adp_half": 98.0, "fpts_ppr": 145.0, "fpts_half": 145.0, "opportunity": 28, "efficiency": 30, "injury": 32, "bye": 12},
    {"name": "Philadelphia Eagles", "pos": "DST", "team": "PHI", "age": 0, "adp_ppr": 110.0, "adp_half": 108.0, "fpts_ppr": 130.0, "fpts_half": 130.0, "opportunity": 27, "efficiency": 28, "injury": 32, "bye": 9},
    {"name": "Baltimore Ravens", "pos": "DST", "team": "BAL", "age": 0, "adp_ppr": 115.0, "adp_half": 112.0, "fpts_ppr": 135.0, "fpts_half": 135.0, "opportunity": 28, "efficiency": 27, "injury": 32, "bye": 7},
    {"name": "Pittsburgh Steelers", "pos": "DST", "team": "PIT", "age": 0, "adp_ppr": 125.0, "adp_half": 122.0, "fpts_ppr": 125.0, "fpts_half": 125.0, "opportunity": 25, "efficiency": 26, "injury": 32, "bye": 5},
    {"name": "Buffalo Bills", "pos": "DST", "team": "BUF", "age": 0, "adp_ppr": 120.0, "adp_half": 118.0, "fpts_ppr": 128.0, "fpts_half": 128.0, "opportunity": 26, "efficiency": 25, "injury": 32, "bye": 7},
    {"name": "Minnesota Vikings", "pos": "DST", "team": "MIN", "age": 0, "adp_ppr": 130.0, "adp_half": 128.0, "fpts_ppr": 132.0, "fpts_half": 132.0, "opportunity": 25, "efficiency": 27, "injury": 32, "bye": 6},
    {"name": "Houston Texans", "pos": "DST", "team": "HOU", "age": 0, "adp_ppr": 118.0, "adp_half": 115.0, "fpts_ppr": 140.0, "fpts_half": 140.0, "opportunity": 27, "efficiency": 28, "injury": 32, "bye": 14},
    {"name": "Los Angeles Rams", "pos": "DST", "team": "LAR", "age": 0, "adp_ppr": 105.0, "adp_half": 102.0, "fpts_ppr": 120.0, "fpts_half": 120.0, "opportunity": 30, "efficiency": 29, "injury": 32, "bye": 6},
    {"name": "San Francisco 49ers", "pos": "DST", "team": "SF", "age": 0, "adp_ppr": 135.0, "adp_half": 132.0, "fpts_ppr": 118.0, "fpts_half": 118.0, "opportunity": 24, "efficiency": 26, "injury": 32, "bye": 14},
    {"name": "Detroit Lions", "pos": "DST", "team": "DET", "age": 0, "adp_ppr": 140.0, "adp_half": 138.0, "fpts_ppr": 115.0, "fpts_half": 115.0, "opportunity": 23, "efficiency": 24, "injury": 32, "bye": 8},
    {"name": "Green Bay Packers", "pos": "DST", "team": "GB", "age": 0, "adp_ppr": 145.0, "adp_half": 142.0, "fpts_ppr": 112.0, "fpts_half": 112.0, "opportunity": 22, "efficiency": 23, "injury": 32, "bye": 5},
    {"name": "Kansas City Chiefs", "pos": "DST", "team": "KC", "age": 0, "adp_ppr": 148.0, "adp_half": 145.0, "fpts_ppr": 110.0, "fpts_half": 110.0, "opportunity": 24, "efficiency": 22, "injury": 32, "bye": 10},
    {"name": "Cleveland Browns", "pos": "DST", "team": "CLE", "age": 0, "adp_ppr": 150.0, "adp_half": 148.0, "fpts_ppr": 108.0, "fpts_half": 108.0, "opportunity": 21, "efficiency": 25, "injury": 32, "bye": 9},
    {"name": "Seattle Seahawks", "pos": "DST", "team": "SEA", "age": 0, "adp_ppr": 142.0, "adp_half": 140.0, "fpts_ppr": 122.0, "fpts_half": 122.0, "opportunity": 23, "efficiency": 24, "injury": 32, "bye": 8},
    {"name": "New York Jets", "pos": "DST", "team": "NYJ", "age": 0, "adp_ppr": 155.0, "adp_half": 152.0, "fpts_ppr": 100.0, "fpts_half": 100.0, "opportunity": 20, "efficiency": 22, "injury": 32, "bye": 9},
    {"name": "Los Angeles Chargers", "pos": "DST", "team": "LAC", "age": 0, "adp_ppr": 152.0, "adp_half": 150.0, "fpts_ppr": 105.0, "fpts_half": 105.0, "opportunity": 22, "efficiency": 23, "injury": 32, "bye": 12},
]


def age_fitness(pos: str, age: int) -> float:
    """0–100 fitness for fantasy age curve (used only to weight model total). Display still shows raw age."""
    if pos == "DST":
        return 50.0
    if pos == "K":
        if 27 <= age <= 34:
            return 92.0
        if 24 <= age <= 36:
            return 75.0
        return 45.0
    peaks = {
        "RB": (23, 26),
        "WR": (24, 28),
        "TE": (25, 29),
        "QB": (26, 32),
    }
    lo, hi = peaks.get(pos, (24, 28))
    if lo <= age <= hi:
        return 95.0
    if age < lo:
        gap = lo - age
        return max(55.0, 90.0 - gap * 8)
    gap = age - hi
    if pos == "RB":
        return max(15.0, 90.0 - gap * 18)
    if pos == "QB":
        return max(30.0, 90.0 - gap * 6)
    return max(20.0, 90.0 - gap * 12)


def pos_rank_map(players: list, key_fn, reverse=True) -> dict:
    """1 = best within position. key_fn(player) -> sortable value."""
    by_pos = {}
    for p in players:
        by_pos.setdefault(p["pos"], []).append(p)
    out = {}
    for pos, group in by_pos.items():
        ranked = sorted(group, key=key_fn, reverse=reverse)
        for i, p in enumerate(ranked):
            out[(p["name"], pos)] = i + 1
    return out


def games_played_estimate(injury_legacy: int) -> int:
    """Map old 1–32 health score to estimated 2025 games played (0–17)."""
    return int(max(0, min(17, round((injury_legacy / 32) * 17))))


def efficiency_rating(eff_legacy: int) -> int:
    """Map old 1–32 efficiency to 0–100 rating."""
    return int(max(0, min(100, round((eff_legacy / 32) * 100))))


def _round_half(x: float) -> float:
    return round(x * 2) / 2


def _round_to(x: float, step: int) -> float:
    return round(x / step) * step


def estimate_player_props(p: dict) -> dict:
    """
    Per-player season prop lines (yards + TDs) — NOT team win totals.

    Real sportsbook season props are preferred when available. Until then we
    model market-style O/U lines from ADP, opportunity, and prior production so
    the factor is player-level and comparable within position.
    """
    pos = p["pos"]
    fpts = float(p.get("fpts_ppr") or 0)
    opp = float(p.get("opportunity") or 16)
    adp = float(p.get("adp_ppr") or 120)
    rookie = bool(p.get("rookie", False))
    # Earlier ADP → slightly higher implied line
    adp_factor = max(0.75, min(1.2, 1.12 - (adp / 220) * 0.45))

    if pos == "QB":
        # Season pass yards (~2,800–4,800) + pass TDs
        base_yds = 2800 + opp * 28 + min(fpts, 380) * 1.15
        if rookie or fpts < 80:
            base_yds = 2600 + opp * 25
        yards = max(2200.0, min(4800.0, _round_to(base_yds * adp_factor, 25)))
        tds = max(10.0, min(42.0, _round_half(16 + opp * 0.35 + min(fpts, 380) / 90)))
        return {
            "yards": yards,
            "tds": tds,
            "yards_label": "Pass Yds",
            "td_label": "Pass TDs",
            "primary": yards,
            "primary_unit": "yds",
            "source": "modeled",
        }

    if pos == "RB":
        # Rush + receiving yards (~400–2,200) + total TDs
        base_yds = 350 + opp * 28 + min(fpts, 400) * 1.35
        if rookie or fpts < 50:
            base_yds = 500 + opp * 24
        yards = max(250.0, min(2200.0, _round_to(base_yds * adp_factor, 25)))
        tds = max(2.0, min(22.0, _round_half(3.5 + opp * 0.28 + min(fpts, 400) / 100)))
        return {
            "yards": yards,
            "tds": tds,
            "yards_label": "Rush+Rec Yds",
            "td_label": "Total TDs",
            "primary": yards,
            "primary_unit": "yds",
            "source": "modeled",
        }

    if pos in ("WR", "TE"):
        # Receiving yards (~300–1,800)
        if pos == "WR":
            base_yds = 300 + opp * 26 + min(fpts, 380) * 1.4
            if rookie or fpts < 40:
                base_yds = 400 + opp * 22
        else:
            base_yds = 250 + opp * 22 + min(fpts, 280) * 1.15
            if rookie or fpts < 40:
                base_yds = 300 + opp * 18
        yards = max(200.0, min(1800.0, _round_to(base_yds * adp_factor, 25)))
        tds = max(1.5, min(16.0, _round_half(2.5 + opp * 0.22 + min(fpts, 380) / 110)))
        return {
            "yards": yards,
            "tds": tds,
            "yards_label": "Rec Yds",
            "td_label": "Rec TDs",
            "primary": yards,
            "primary_unit": "yds",
            "source": "modeled",
        }

    if pos == "K":
        # Season kicking points + FG made
        points = max(90.0, min(180.0, _round_half(100 + opp * 1.4 + min(fpts, 180) * 0.25)))
        fgs = max(20.0, min(40.0, _round_half(points / 4.5)))
        return {
            "yards": points,  # primary ranking key
            "tds": fgs,
            "yards_label": "K Points",
            "td_label": "FG Made",
            "primary": points,
            "primary_unit": "pts",
            "source": "modeled",
        }

    if pos == "DST":
        # Season sacks O/U as primary defensive prop
        sacks = max(20.0, _round_half(28 + opp * 0.55 + min(fpts, 160) / 20))
        takeaways = max(12.0, _round_half(18 + opp * 0.25))
        return {
            "yards": sacks,
            "tds": takeaways,
            "yards_label": "Sacks",
            "td_label": "Takeaways",
            "primary": sacks,
            "primary_unit": "sacks",
            "source": "modeled",
        }

    return {
        "yards": 0.0,
        "tds": 0.0,
        "yards_label": "Yds",
        "td_label": "TDs",
        "primary": 0.0,
        "primary_unit": "yds",
        "source": "modeled",
    }


def position_env_metrics(pos: str, team_meta: dict) -> dict:
    """
    Environment factors apply only to certain positions:
      - qb (team QB quality): WR & TE only
      - oline (OL quality): RB & QB only
      - playcaller: QB, RB, WR, TE only (never K / DST)
    N/A factors are null and excluded from model weight renormalization.
    """
    # Team QB → only pass catchers
    if pos in ("WR", "TE"):
        qb = team_meta["qb_rank"]
    else:
        qb = None

    # Offensive line → run game + QB protection
    if pos in ("RB", "QB"):
        oline = team_meta.get("ol_rank", 16)
    else:
        oline = None

    # Playcaller / scheme → skill offense only
    if pos in ("QB", "RB", "WR", "TE"):
        playcaller = team_meta["playcaller"]
    else:
        playcaller = None

    return {"qb": qb, "oline": oline, "playcaller": playcaller}


def build_players():
    # Opportunity: rank within position by legacy volume score (1 = best role)
    opp_rank = pos_rank_map(PLAYERS, lambda x: x["opportunity"], reverse=True)

    enriched = []
    for i, p in enumerate(PLAYERS):
        t = TEAMS[p["team"]]
        env = position_env_metrics(p["pos"], t)

        gp = games_played_estimate(p["injury"])
        eff = efficiency_rating(p["efficiency"])
        fitness = age_fitness(p["pos"], p["age"]) if p["pos"] != "DST" else 50.0
        n_at_pos = sum(1 for x in PLAYERS if x["pos"] == p["pos"])
        props = estimate_player_props(p)

        # metrics: applicable display values (same for ppr/half except lastYear + adp)
        def metrics_for(scoring: str) -> dict:
            fpts = p["fpts_ppr"] if scoring == "ppr" else p["fpts_half"]
            adp = p["adp_ppr"] if scoring == "ppr" else p["adp_half"]
            return {
                # Actual 2025 fantasy points
                "lastYear": fpts,
                # Age in years (fitness used only in model via ageFitness)
                "age": p["age"] if p["pos"] != "DST" else 0,
                "ageFitness": fitness,
                # WR/TE only (null otherwise)
                "qb": env["qb"],
                # RB/QB only (null otherwise)
                "oline": env["oline"],
                # Offense only — not K/DST
                "playcaller": env["playcaller"],
                # Real ADP (lower = drafted earlier)
                "adp": adp,
                # PLAYER prop primary line (yards/sacks/points) — NOT team wins
                "vegas": props["primary"],
                "vegasYards": props["yards"],
                "vegasTds": props["tds"],
                "vegasYardsLabel": props["yards_label"],
                "vegasTdLabel": props["td_label"],
                "vegasPrimaryUnit": props["primary_unit"],
                # Rank within position: 1 = best opportunity, N = worst
                "opportunity": opp_rank[(p["name"], p["pos"])],
                "opportunityOf": n_at_pos,
                # Efficiency 0–100
                "efficiency": eff,
                # Games played estimate 0–17
                "injury": gp,
                # Among 32 teams, 32 = easiest SOS
                "sos": t["sos_rank"],
            }

        base = {
            "id": f"{p['pos']}-{i}",
            "name": p["name"],
            "pos": p["pos"],
            "team": p["team"],
            "team_name": t["name"],
            "age": p["age"],
            "bye": p.get("bye", 0),
            "rookie": bool(p.get("rookie", False)),
            "adp": {"ppr": p["adp_ppr"], "half": p["adp_half"]},
            "fpts_2025": {"ppr": p["fpts_ppr"], "half": p["fpts_half"]},
            "raw": {
                "playcaller": t["playcaller"],
                "playcaller_name": t["playcaller_name"],
                "scheme": t["scheme"],
                "qb_rank": t["qb_rank"],
                "ol_rank": t.get("ol_rank", 16),
                "sos_rank": t["sos_rank"],
                "games_played": gp,
                "efficiency_rating": eff,
                "opp_rank": opp_rank[(p["name"], p["pos"])],
                "opp_of": n_at_pos,
                "age_fitness": fitness,
                "vegas_props": props,
                "env_applies": {
                    "qb": env["qb"] is not None,
                    "oline": env["oline"] is not None,
                    "playcaller": env["playcaller"] is not None,
                },
            },
            # Applicable metric values used for display + ranking
            "metrics": {
                "ppr": metrics_for("ppr"),
                "half": metrics_for("half"),
            },
            "drafted": False,
            "sleeper_id": None,
            "espn_id": None,
        }
        # Back-compat alias so older UI code can still find numbers
        base["scores"] = base["metrics"]
        enriched.append(base)
    return enriched


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    players = build_players()
    meta = {
        "season": 2026,
        "updated": "2026-08-04",
        "scoring_modes": ["half", "ppr"],
        "factors": [
            {
                "key": "lastYear",
                "label": "Last Year Stats",
                "unit": "FPts",
                "higherBetter": True,
                "desc": "Actual 2025 fantasy points in the selected scoring format",
            },
            {
                "key": "age",
                "label": "Age",
                "unit": "years",
                "higherBetter": None,
                "desc": "Player age in years. Model uses a position-specific peak-age fitness curve under the hood.",
            },
            {
                "key": "qb",
                "label": "Quarterback",
                "unit": "of 32",
                "higherBetter": True,
                "desc": "Team QB quality (32 = best). Applies to WR & TE only. N/A for QB, RB, K, DST.",
            },
            {
                "key": "oline",
                "label": "Offensive Line",
                "unit": "of 32",
                "higherBetter": True,
                "desc": "OL quality (32 = best run/pass blocking). Applies to RB & QB only. N/A for WR, TE, K, DST.",
            },
            {
                "key": "playcaller",
                "label": "Playcaller",
                "unit": "of 32",
                "higherBetter": True,
                "desc": "OC/scheme (32 = best). Applies to QB/RB/WR/TE only — never K or DST.",
            },
            {
                "key": "adp",
                "label": "ADP",
                "unit": "pick",
                "higherBetter": False,
                "desc": "2026 average draft position (1.0 = first pick). Lower ADP = higher draft capital.",
            },
            {
                "key": "vegas",
                "label": "Vegas Lines",
                "unit": "player props",
                "higherBetter": True,
                "desc": "Per-player season props: QB pass yds/TDs, RB rush+rec yds/TDs, WR/TE rec yds/TDs (NOT team wins). Higher primary line = higher market expectation.",
            },
            {
                "key": "opportunity",
                "label": "Opportunity",
                "unit": "pos rank",
                "higherBetter": False,
                "desc": "Projected volume/role ranked within position (1 = best opportunity at the position)",
            },
            {
                "key": "efficiency",
                "label": "Efficiency",
                "unit": "0–100",
                "higherBetter": True,
                "desc": "Efficiency rating 0–100 (YPT / TD rate / explosive-play quality)",
            },
            {
                "key": "injury",
                "label": "Health",
                "unit": "GP",
                "higherBetter": True,
                "desc": "Estimated games played durability (0–17). Higher = healthier profile.",
            },
            {
                "key": "sos",
                "label": "Strength of Schedule",
                "unit": "of 32",
                "higherBetter": True,
                "desc": "Schedule ease among 32 teams (32 = easiest fantasy schedule, 1 = hardest)",
            },
        ],
        "default_weights": {
            "lastYear": 18,
            "age": 7,
            "qb": 8,
            "oline": 8,
            "playcaller": 8,
            "adp": 12,
            "vegas": 8,
            "opportunity": 14,
            "efficiency": 8,
            "injury": 6,
            "sos": 3,
        },
        "weight_presets": [
            {"id": "balanced", "label": "Balanced", "desc": "Even blend of production, role, situation, and market."},
            {"id": "situation", "label": "Overall Situation", "desc": "QB, O-Line, playcaller, SOS & role."},
            {"id": "production", "label": "Prior Production", "desc": "Last-year points, efficiency, opportunity, Vegas."},
            {"id": "upside", "label": "Youth & Upside", "desc": "Age curve, opportunity, health — chase breakouts."},
            {"id": "market", "label": "Beat the Market", "desc": "ADP + Vegas props — hunt value vs consensus."},
        ],
        "league_defaults": {
            "teams": 12,
            "roster": {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 1, "K": 1, "DST": 1, "BN": 6},
            "scoring": "ppr",
        },
        "model_notes": (
            "Natural units; weighted 0–100 percentiles. N/A env factors (QB only WR/TE; "
            "OL only RB/QB; playcaller never K/DST) are dropped and remaining weights renormalized."
        ),
        "factor_applicability": {
            "qb": ["WR", "TE"],
            "oline": ["RB", "QB"],
            "playcaller": ["QB", "RB", "WR", "TE"],
        },
        "sources": [
            "2025 fantasy scoring leaders (public leaderboards)",
            "2026 consensus ADP (Sleeper/RTSports/FantasyPros-style)",
            "Per-player Vegas props (modeled season lines)",
            "Playcaller / QB / OL ranks: model composite for 2026 (1–32 among 32 teams)",
        ],
    }
    with open(OUT / "teams.json", "w", encoding="utf-8") as f:
        json.dump(TEAMS, f, indent=2)
    with open(OUT / "players.json", "w", encoding="utf-8") as f:
        json.dump(players, f, indent=2)
    with open(OUT / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote {len(players)} players, {len(TEAMS)} teams → {OUT}")


if __name__ == "__main__":
    main()
