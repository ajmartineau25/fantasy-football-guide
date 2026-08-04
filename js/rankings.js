/**
 * Multi-factor ranking engine.
 *
 * Display metrics use natural units:
 *   lastYear → fantasy points
 *   age → years (fitness curve for model only)
 *   qb / playcaller / sos → 1–32 among 32 NFL teams
 *   adp → actual ADP pick number
 *   vegas → team win total
 *   opportunity → rank within position (1 = best)
 *   efficiency → 0–100 rating
 *   injury → games played (0–17)
 *
 * Summary total = weighted average of 0–100 percentiles so mixed units combine cleanly.
 */

export const FACTOR_KEYS = [
  "lastYear",
  "age",
  "qb",
  "playcaller",
  "adp",
  "vegas",
  "opportunity",
  "efficiency",
  "injury",
  "sos",
];

export const FACTOR_LABELS = {
  lastYear: "Last Year",
  age: "Age",
  qb: "QB",
  playcaller: "Playcaller",
  adp: "ADP",
  vegas: "Vegas",
  opportunity: "Opp",
  efficiency: "Eff",
  injury: "Health",
  sos: "SOS",
};

export const FACTOR_TAB_LABELS = {
  lastYear: "Last Year Stats",
  age: "Age",
  qb: "Quarterback",
  playcaller: "Playcaller",
  adp: "ADP",
  vegas: "Vegas Lines",
  opportunity: "Opportunity",
  efficiency: "Efficiency",
  injury: "Health",
  sos: "Strength of Schedule",
};

/** Factors that map to all 32 NFL teams (1–32 scale is legitimate). */
export const TEAM_LEVEL_FACTORS = new Set(["playcaller", "vegas", "qb", "sos"]);

/** Meta for each factor's display + sort direction. */
export const FACTOR_META = {
  lastYear: {
    unit: "FPts",
    higherBetter: true,
    scaleNote: "actual fantasy points",
    desc: "Actual 2025 fantasy points in the selected scoring format.",
  },
  age: {
    unit: "years",
    higherBetter: true, // we sort by ageFitness for model; display uses years
    scaleNote: "age in years",
    desc: "Player age in years. Summary model uses a position-specific peak-age fitness curve.",
  },
  qb: {
    unit: "of 32",
    higherBetter: true,
    scaleNote: "32 NFL starters (32=best)",
    desc: "Team QB quality among 32 starters (32 = best, 1 = worst). QBs use a self quality score.",
  },
  playcaller: {
    unit: "of 32",
    higherBetter: true,
    scaleNote: "32 NFL playcallers (32=best)",
    desc: "Fantasy-friendly OC/scheme among all 32 playcallers (32 = best, 1 = worst).",
  },
  adp: {
    unit: "pick",
    higherBetter: false,
    scaleNote: "average draft position",
    desc: "2026 ADP (1.0 = first overall). Lower = higher draft capital.",
  },
  vegas: {
    unit: "wins",
    higherBetter: true,
    scaleNote: "team win total",
    desc: "Sportsbook regular-season win total (e.g. 11.5).",
  },
  opportunity: {
    unit: "pos rank",
    higherBetter: false,
    scaleNote: "1 = best at position",
    desc: "Projected volume/role ranked within position (1 = best).",
  },
  efficiency: {
    unit: "0–100",
    higherBetter: true,
    scaleNote: "efficiency rating",
    desc: "Efficiency rating 0–100 (YPT / TD quality / explosives).",
  },
  injury: {
    unit: "GP",
    higherBetter: true,
    scaleNote: "games played 0–17",
    desc: "Estimated games-played durability (0–17). Higher = healthier.",
  },
  sos: {
    unit: "of 32",
    higherBetter: true,
    scaleNote: "32 teams (32=easiest)",
    desc: "Schedule ease among 32 teams (32 = easiest fantasy schedule).",
  },
};

export const FACTOR_DESCRIPTIONS = Object.fromEntries(
  Object.entries(FACTOR_META).map(([k, v]) => [k, v.desc])
);

/**
 * Value used for sorting / display of a factor.
 * Age displays as years but model sorts fitness via getModelValue.
 */
export function getDisplayValue(metrics, key) {
  if (!metrics) return 0;
  return metrics[key] ?? 0;
}

/**
 * Value directionally "higher = better" for percentile / total.
 */
export function getModelValue(metrics, key) {
  if (!metrics) return 0;
  if (key === "age") return metrics.ageFitness ?? 50;
  if (key === "adp") {
    // Invert ADP so early picks score higher: use negative ADP for ranking direction
    return metrics.adp ?? 999;
  }
  if (key === "opportunity") return metrics.opportunity ?? 999;
  return metrics[key] ?? 0;
}

export function isHigherBetter(key) {
  if (key === "adp" || key === "opportunity") return false;
  if (key === "age") return true; // ageFitness is higherBetter
  return FACTOR_META[key]?.higherBetter !== false;
}

export function formatMetric(key, metrics, scoring) {
  if (!metrics) return "—";
  const v = metrics[key];
  if (v == null) return "—";
  switch (key) {
    case "lastYear":
      return Number(v).toFixed(1);
    case "age":
      return metrics.age ? String(metrics.age) : "—";
    case "qb":
    case "playcaller":
    case "sos":
      return `${v}/32`;
    case "adp":
      return Number(v).toFixed(1);
    case "vegas":
      return Number(v).toFixed(1);
    case "opportunity": {
      const of = metrics.opportunityOf || "?";
      return `#${v} / ${of}`;
    }
    case "efficiency":
      return `${v}`;
    case "injury":
      return `${v} GP`;
    default:
      return String(v);
  }
}

export function metricUnit(key) {
  return FACTOR_META[key]?.unit || "";
}

/**
 * Percentile 0–100 within a list of numeric values.
 * higherBetter=true → max gets 100.
 */
function percentileMap(values, higherBetter = true) {
  const n = values.length;
  if (n === 0) return new Map();
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => (higherBetter ? b.v - a.v : a.v - b.v));
  const map = new Map();
  indexed.forEach((item, rank) => {
    const pct = n === 1 ? 100 : ((n - 1 - rank) / (n - 1)) * 100;
    map.set(item.i, pct);
  });
  return map;
}

/**
 * Build 0–100 percentile for each factor across the player pool (for model total).
 * Opportunity/lastYear can be within-position for fairness.
 */
export function buildPercentiles(players, scoring = "ppr") {
  const result = players.map(() => ({}));

  for (const key of FACTOR_KEYS) {
    if (key === "lastYear" || key === "opportunity" || key === "efficiency") {
      // Within-position percentiles
      const byPos = {};
      players.forEach((p, i) => {
        byPos[p.pos] = byPos[p.pos] || [];
        byPos[p.pos].push(i);
      });
      for (const idxs of Object.values(byPos)) {
        const vals = idxs.map((i) => {
          const m = players[i].metrics?.[scoring] || players[i].scores?.[scoring] || {};
          if (key === "age") return m.ageFitness ?? 50;
          if (key === "adp" || key === "opportunity") return m[key] ?? 999;
          return m[key] ?? 0;
        });
        const hb = isHigherBetter(key);
        // For ADP/opportunity, lower raw is better → higherBetter false
        const pct = percentileMap(vals, hb);
        idxs.forEach((playerIdx, j) => {
          result[playerIdx][key] = pct.get(j) ?? 0;
        });
      }
    } else {
      const vals = players.map((p) => {
        const m = p.metrics?.[scoring] || p.scores?.[scoring] || {};
        if (key === "age") return m.ageFitness ?? 50;
        if (key === "adp") return m.adp ?? 999;
        return m[key] ?? 0;
      });
      const pct = percentileMap(vals, isHigherBetter(key));
      players.forEach((_, i) => {
        result[i][key] = pct.get(i) ?? 0;
      });
    }
  }
  return result;
}

/**
 * Weighted model total 0–100 from percentile object + weights.
 */
export function computeWeightedTotal(percentiles, weights) {
  let num = 0;
  let den = 0;
  for (const key of FACTOR_KEYS) {
    const w = Number(weights[key] ?? 0);
    if (w <= 0) continue;
    num += (percentiles[key] ?? 0) * w;
    den += w;
  }
  if (den === 0) return 0;
  return Math.round((num / den) * 10) / 10;
}

export function needMultiplier(pos, rosterCounts, targets) {
  const starters = {
    QB: targets.QB || 1,
    RB: (targets.RB || 2) + Math.ceil((targets.FLEX || 1) * 0.4),
    WR: (targets.WR || 2) + Math.ceil((targets.FLEX || 1) * 0.5),
    TE: (targets.TE || 1) + Math.ceil((targets.FLEX || 1) * 0.1),
    K: targets.K || 1,
    DST: targets.DST || 1,
  };
  const depth = {
    QB: starters.QB + 1,
    RB: starters.RB + 2,
    WR: starters.WR + 2,
    TE: starters.TE + 1,
    K: 1,
    DST: 1,
  };
  const have = rosterCounts[pos] || 0;
  const want = depth[pos] || 1;
  if (have >= want) return 0.85;
  if (have === 0) return 1.25;
  const ratio = 1 - have / want;
  return 1 + ratio * 0.2;
}

export function computeNeedScore(playerTotal, pos, rosterCounts, targets, enableNeed) {
  if (!enableNeed) return playerTotal;
  return Math.round(playerTotal * needMultiplier(pos, rosterCounts, targets) * 10) / 10;
}

/**
 * Team-level leaderboard rows for playcaller / vegas / qb / sos.
 */
export function rankTeamsByFactor(teams, factorKey) {
  if (!teams) return [];
  const rows = Object.entries(teams).map(([abbr, t]) => {
    let value = 0;
    let detail = "";
    let unit = "";
    if (factorKey === "playcaller") {
      value = t.playcaller;
      detail = t.playcaller_name || "OC staff";
      unit = "of 32";
    } else if (factorKey === "vegas") {
      value = t.win_total;
      detail = `Win total ${t.win_total}`;
      unit = "wins";
    } else if (factorKey === "qb") {
      value = t.qb_rank;
      detail = "Team QB quality";
      unit = "of 32";
    } else if (factorKey === "sos") {
      value = t.sos_rank;
      detail = "Schedule ease";
      unit = "of 32";
    }
    return {
      team: abbr,
      name: t.name,
      value,
      score: value, // alias for UI
      detail,
      unit,
      playcaller_name: t.playcaller_name,
      scheme: t.scheme,
      win_total: t.win_total,
      qb_rank: t.qb_rank,
      sos_rank: t.sos_rank,
      playcaller: t.playcaller,
    };
  });

  // Sort: higher better for all team factors (vegas wins, ranks where 32=best)
  rows.sort((a, b) => b.value - a.value || a.team.localeCompare(b.team));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Rank and enrich players for display.
 */
export function rankPlayers(players, {
  scoring = "ppr",
  weights,
  position = "ALL",
  hideDrafted = false,
  search = "",
  sortKey = "total",
  sortDir = "desc",
  rosterCounts = {},
  targets = {},
  enableNeed = false,
} = {}) {
  const percentiles = buildPercentiles(players, scoring);
  const q = search.trim().toLowerCase();

  let list = players.map((p, i) => {
    const metrics = p.metrics?.[scoring] || p.scores?.[scoring] || {};
    const total = computeWeightedTotal(percentiles[i], weights);
    const needTotal = computeNeedScore(total, p.pos, rosterCounts, targets, enableNeed);
    return {
      ...p,
      activeMetrics: metrics,
      activeScores: metrics, // alias for older UI
      percentiles: percentiles[i],
      total,
      needTotal,
      displayTotal: enableNeed ? needTotal : total,
    };
  });

  if (position !== "ALL") list = list.filter((p) => p.pos === position);
  if (hideDrafted) list = list.filter((p) => !p.drafted);
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        (p.team_name || "").toLowerCase().includes(q)
    );
  }

  const dir = sortDir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let av;
    let bv;
    if (sortKey === "total") {
      av = a.displayTotal;
      bv = b.displayTotal;
    } else if (sortKey === "name") {
      return a.name < b.name ? -dir : a.name > b.name ? dir : 0;
    } else if (sortKey === "adpRaw") {
      av = a.adp[scoring] ?? a.adp.ppr;
      bv = b.adp[scoring] ?? b.adp.ppr;
    } else if (sortKey === "fpts") {
      av = a.fpts_2025[scoring] ?? a.fpts_2025.ppr;
      bv = b.fpts_2025[scoring] ?? b.fpts_2025.ppr;
    } else if (FACTOR_KEYS.includes(sortKey)) {
      // Natural sort by display metric
      if (sortKey === "age") {
        // Prefer better age fitness when sorting Age column on summary; on age tab show years
        av = a.activeMetrics.age ?? 0;
        bv = b.activeMetrics.age ?? 0;
      } else {
        av = a.activeMetrics[sortKey] ?? 0;
        bv = b.activeMetrics[sortKey] ?? 0;
      }
      // Default dir for lower-is-better factors when user first opens tab: handled by caller
    } else {
      av = a[sortKey];
      bv = b[sortKey];
    }
    if (av === bv) return a.name.localeCompare(b.name);
    return av < bv ? -dir : dir;
  });

  return list.map((p, i) => ({ ...p, rank: i + 1 }));
}

/** Default sort direction when opening a factor tab. */
export function defaultSortDirForFactor(key) {
  // ADP & opportunity: lower rank/pick first
  if (key === "adp" || key === "opportunity") return "asc";
  // Age: younger first is common for RB; show ascending age as default
  if (key === "age") return "asc";
  return "desc";
}

export function emptyRosterCounts() {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
}

export function countRoster(playersOnTeam) {
  const c = emptyRosterCounts();
  for (const p of playersOnTeam) {
    if (c[p.pos] !== undefined) c[p.pos] += 1;
  }
  return c;
}
