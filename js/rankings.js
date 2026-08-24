/**
 * Multi-factor ranking engine.
 *
 * Display metrics use natural units:
 *   lastYear → fantasy points
 *   age → years (fitness curve for model only)
 *   qb → team QB 1–32 for WR/TE only (null elsewhere)
 *   oline → OL 1–32 for RB/QB only (null elsewhere)
 *   playcaller → 1–32 for QB/RB/WR/TE only (null for K/DST)
 *   sos → 1–32 teams
 *   adp → actual ADP pick number
 *   vegas → player season prop primary line
 *   opportunity / efficiency / injury as before
 *
 * Summary total = weighted average of applicable 0–100 percentiles
 * (N/A factors skipped; remaining weights renormalized per player).
 */

export const FACTOR_KEYS = [
  "flock",
  "lastYear",
  "age",
  "qb",
  "oline",
  "playcaller",
  "adp",
  "vegas",
  "opportunity",
  "efficiency",
  "injury",
  "sos",
];

/**
 * Five prevalent ranking styles — replaces fiddly per-factor sliders.
 * Each preset is a full weight map that sums to 100.
 * Balanced keeps ~25% Flock Fantasy draft-sheet consensus (user request).
 */
export const WEIGHT_PRESETS = [
  {
    id: "balanced",
    label: "Balanced",
    desc: "Flock ~25% + even blend of production, role, situation, and market.",
    weights: {
      flock: 25,
      lastYear: 14,
      age: 5,
      qb: 6,
      oline: 6,
      playcaller: 6,
      adp: 9,
      vegas: 6,
      opportunity: 10,
      efficiency: 6,
      injury: 5,
      sos: 2,
    },
  },
  {
    id: "situation",
    label: "Overall Situation",
    desc: "Env (QB/OL/playcaller/SOS) capped at ~30%; surplus into Flock (~32%). Role still matters.",
    weights: {
      flock: 32,
      lastYear: 5,
      age: 3,
      qb: 9,
      oline: 9,
      playcaller: 9,
      adp: 5,
      vegas: 5,
      opportunity: 12,
      efficiency: 5,
      injury: 3,
      sos: 3,
    },
  },
  {
    id: "production",
    label: "Prior Production",
    desc: "Last-year points, efficiency, opportunity, Vegas — Flock ~20%.",
    weights: {
      flock: 20,
      lastYear: 22,
      age: 3,
      qb: 3,
      oline: 3,
      playcaller: 3,
      adp: 6,
      vegas: 12,
      opportunity: 14,
      efficiency: 10,
      injury: 3,
      sos: 1,
    },
  },
  {
    id: "upside",
    label: "Youth & Upside",
    desc: "Age curve + opportunity + health — Flock ~18%.",
    weights: {
      flock: 18,
      lastYear: 6,
      age: 18,
      qb: 5,
      oline: 7,
      playcaller: 7,
      adp: 5,
      vegas: 6,
      opportunity: 15,
      efficiency: 6,
      injury: 5,
      sos: 2,
    },
  },
  {
    id: "market",
    label: "Beat the Market",
    desc: "Flock + ADP + Vegas — lean into consensus boards (~28% Flock).",
    weights: {
      flock: 28,
      lastYear: 8,
      age: 4,
      qb: 4,
      oline: 4,
      playcaller: 4,
      adp: 22,
      vegas: 12,
      opportunity: 8,
      efficiency: 4,
      injury: 2,
      sos: 0,
    },
  },
];

export function presetById(id) {
  return WEIGHT_PRESETS.find((p) => p.id === id) || WEIGHT_PRESETS[0];
}

export const FACTOR_LABELS = {
  flock: "Flock",
  lastYear: "Last Year",
  age: "Age",
  qb: "QB",
  oline: "O-Line",
  playcaller: "Playcaller",
  adp: "ADP",
  vegas: "Vegas",
  opportunity: "Opp",
  efficiency: "Eff",
  injury: "Health",
  sos: "SOS",
};

export const FACTOR_TAB_LABELS = {
  flock: "Flock Consensus",
  lastYear: "Last Year Stats",
  age: "Age",
  qb: "Quarterback",
  oline: "Offensive Line",
  playcaller: "Playcaller",
  adp: "ADP",
  vegas: "Vegas Lines",
  opportunity: "Opportunity",
  efficiency: "Efficiency",
  injury: "Health",
  sos: "Strength of Schedule",
};

/** Which positions use which env factors (null = N/A). */
export const FACTOR_APPLIES = {
  qb: new Set(["WR", "TE"]),
  oline: new Set(["RB", "QB"]),
  playcaller: new Set(["QB", "RB", "WR", "TE"]),
};

/** Team-level leaderboard tabs (32 clubs). */
export const TEAM_LEVEL_FACTORS = new Set(["playcaller", "qb", "oline", "sos"]);

/** Meta for each factor's display + sort direction. */
export const FACTOR_META = {
  flock: {
    unit: "rank",
    higherBetter: false,
    scaleNote: "Flock overall rank",
    desc: "Flock Fantasy overall draft-sheet rank (1 = best). Medium prior in Balanced (~25%).",
  },
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
    scaleNote: "WR/TE only (32=best)",
    desc: "Team QB quality. Applies to WR & TE only — not QB, RB, K, or DST.",
  },
  oline: {
    unit: "of 32",
    higherBetter: true,
    scaleNote: "RB/QB only (32=best)",
    desc: "Offensive line quality. Applies to RB & QB only — not WR, TE, K, or DST.",
  },
  playcaller: {
    unit: "of 32",
    higherBetter: true,
    scaleNote: "offense only (32=best)",
    desc: "OC/scheme fantasy friendliness. Applies to QB/RB/WR/TE — never K or DST.",
  },
  adp: {
    unit: "pick",
    higherBetter: false,
    scaleNote: "average draft position",
    desc: "2026 ADP (1.0 = first overall). Lower = higher draft capital.",
  },
  vegas: {
    unit: "player props",
    higherBetter: true,
    scaleNote: "season yards / TD lines",
    desc: "Per-player season props (pass/rush/rec yards + TDs). Not team win totals. Higher primary line = stronger market projection.",
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
    return metrics.adp ?? 999;
  }
  if (key === "flock") return metrics.flock ?? 250;
  if (key === "opportunity") return metrics.opportunity ?? 999;
  return metrics[key] ?? 0;
}

export function isHigherBetter(key) {
  if (key === "adp" || key === "opportunity" || key === "flock") return false;
  if (key === "age") return true; // ageFitness is higherBetter
  return FACTOR_META[key]?.higherBetter !== false;
}

export function formatMetric(key, metrics, scoring) {
  if (!metrics) return "—";
  const v = metrics[key];
  if (v == null || v === undefined) return "—";
  switch (key) {
    case "lastYear":
      return Number(v).toFixed(1);
    case "age":
      return metrics.age ? String(metrics.age) : "—";
    case "qb":
    case "oline":
    case "playcaller":
    case "sos":
      if (v == null) return "—";
      return `${v}/32`;
    case "adp":
      return Number(v).toFixed(1);
    case "flock":
      return v >= 250 ? "—" : `#${v}`;
    case "vegas": {
      const yds = metrics.vegasYards ?? v;
      const tds = metrics.vegasTds;
      const yl = metrics.vegasYardsLabel || "Yds";
      const tl = metrics.vegasTdLabel || "TDs";
      const unit = metrics.vegasPrimaryUnit || "yds";
      if (unit === "pts") return `${Number(yds).toFixed(1)} pts / ${Number(tds).toFixed(1)} FG`;
      if (unit === "sacks") return `${Number(yds).toFixed(1)} sacks / ${Number(tds).toFixed(1)} TO`;
      return `${Number(yds).toFixed(0)} ${yl} · ${Number(tds).toFixed(1)} ${tl}`;
    }
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

function rawMetricValue(m, key) {
  if (!m) return null;
  if (key === "age") return m.ageFitness ?? 50;
  if (m[key] == null) return null;
  return m[key];
}

/**
 * Build 0–100 percentile for each factor across the player pool (for model total).
 * Null metrics (N/A for position) get no percentile — skipped in weighted total.
 */
export function buildPercentiles(players, scoring = "ppr") {
  const result = players.map(() => ({}));

  for (const key of FACTOR_KEYS) {
    if (key === "lastYear" || key === "opportunity" || key === "efficiency") {
      const byPos = {};
      players.forEach((p, i) => {
        byPos[p.pos] = byPos[p.pos] || [];
        byPos[p.pos].push(i);
      });
      for (const idxs of Object.values(byPos)) {
        const vals = idxs.map((i) => {
          const m = players[i].metrics?.[scoring] || players[i].scores?.[scoring] || {};
          if (key === "adp" || key === "opportunity") return m[key] ?? 999;
          return m[key] ?? 0;
        });
        const pct = percentileMap(vals, isHigherBetter(key));
        idxs.forEach((playerIdx, j) => {
          result[playerIdx][key] = pct.get(j) ?? 0;
        });
      }
    } else if (key === "qb" || key === "oline" || key === "playcaller") {
      // Only players with a non-null value for this env factor
      const eligible = [];
      players.forEach((p, i) => {
        const m = p.metrics?.[scoring] || p.scores?.[scoring] || {};
        const v = rawMetricValue(m, key);
        if (v != null) eligible.push({ i, v });
      });
      if (!eligible.length) continue;
      const vals = eligible.map((e) => e.v);
      const pct = percentileMap(vals, isHigherBetter(key));
      eligible.forEach((e, j) => {
        result[e.i][key] = pct.get(j) ?? 0;
      });
      // leave result[i][key] undefined for N/A players
    } else {
      const vals = players.map((p) => {
        const m = p.metrics?.[scoring] || p.scores?.[scoring] || {};
        if (key === "age") return m.ageFitness ?? 50;
        if (key === "adp") return m.adp ?? 999;
        if (key === "flock") return m.flock ?? 250;
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
 * Weighted model total 0–100. Skips factors with no percentile (N/A for position)
 * and renormalizes remaining weights.
 */
export function computeWeightedTotal(percentiles, weights) {
  let num = 0;
  let den = 0;
  for (const key of FACTOR_KEYS) {
    const w = Number(weights[key] ?? 0);
    if (w <= 0) continue;
    if (percentiles[key] == null || Number.isNaN(percentiles[key])) continue;
    num += percentiles[key] * w;
    den += w;
  }
  if (den === 0) return 0;
  return Math.round((num / den) * 10) / 10;
}

/** Starters demanded per team (FLEX split across RB/WR/TE). */
export function starterDemand(targets = {}) {
  return {
    QB: targets.QB || 1,
    RB: (targets.RB || 2) + Math.ceil((targets.FLEX || 1) * 0.4),
    WR: (targets.WR || 2) + Math.ceil((targets.FLEX || 1) * 0.5),
    TE: (targets.TE || 1) + Math.ceil((targets.FLEX || 1) * 0.1),
    K: targets.K || 1,
    DST: targets.DST || 1,
  };
}

/**
 * League-size VORP: value over the replacement starter at each position.
 * Replacement = player at rank (teams × starters_at_pos) by model total.
 * Returns Map id → { vorp, replacement, posRank, replaceAt }.
 */
export function computeVorpMap(playersWithTotal, targets = {}) {
  const teams = Number(targets.teams) || 12;
  const demand = starterDemand(targets);
  const byPos = {};
  for (const p of playersWithTotal) {
    byPos[p.pos] = byPos[p.pos] || [];
    byPos[p.pos].push(p);
  }
  const replacementScore = {};
  const replaceAt = {};
  for (const [pos, demandN] of Object.entries(demand)) {
    const pool = (byPos[pos] || []).slice().sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const at = Math.max(1, Math.round(teams * demandN));
    replaceAt[pos] = at;
    // 0-based index of replacement player
    const idx = Math.min(pool.length - 1, at - 1);
    replacementScore[pos] = pool.length ? pool[idx].total ?? 0 : 0;
  }
  const out = new Map();
  for (const [pos, pool] of Object.entries(byPos)) {
    const sorted = pool.slice().sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    sorted.forEach((p, i) => {
      const rep = replacementScore[pos] ?? 0;
      const vorp = Math.round(((p.total ?? 0) - rep) * 10) / 10;
      out.set(p.id, {
        vorp,
        replacement: rep,
        posRank: i + 1,
        replaceAt: replaceAt[pos] || teams,
      });
    });
  }
  return out;
}

export function needMultiplier(pos, rosterCounts, targets) {
  const starters = starterDemand(targets);
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
    } else if (factorKey === "qb") {
      value = t.qb_rank;
      detail = "Team QB (WR/TE only)";
      unit = "of 32";
    } else if (factorKey === "oline") {
      value = t.ol_rank ?? 16;
      detail = "Offensive line (RB/QB only)";
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
      ol_rank: t.ol_rank,
      sos_rank: t.sos_rank,
      playcaller: t.playcaller,
    };
  });

  // Sort: higher better (ranks where 32=best)
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
  /** Blend league-size VORP into ranking (0–1). Default 0.45 when enabled. */
  enableVorp = true,
  vorpBlend = 0.45,
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

  // VORP uses pre-need model totals so replacement is stable
  if (enableVorp) {
    const vorpMap = computeVorpMap(list, targets);
    const blend = Math.max(0, Math.min(1, Number(vorpBlend) || 0));
    list = list.map((p) => {
      const v = vorpMap.get(p.id) || { vorp: 0, replacement: 0, posRank: null, replaceAt: null };
      // Scale: display = (1-blend)*base + blend*(50 + vorp)
      // vorp is typically about -30..+40 on 0–100 totals
      const base = p.displayTotal;
      const vorpScore = Math.max(0, Math.min(100, 50 + v.vorp));
      const blended = Math.round((base * (1 - blend) + vorpScore * blend) * 10) / 10;
      return {
        ...p,
        vorp: v.vorp,
        vorpReplacement: v.replacement,
        vorpPosRank: v.posRank,
        vorpReplaceAt: v.replaceAt,
        displayTotal: blended,
        modelOnly: base,
      };
    });
  }

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
    } else if (sortKey === "vorp") {
      av = a.vorp ?? -999;
      bv = b.vorp ?? -999;
    } else if (sortKey === "name") {
      return a.name < b.name ? -dir : a.name > b.name ? dir : 0;
    } else if (sortKey === "adpRaw") {
      av = a.adp[scoring] ?? a.adp.ppr;
      bv = b.adp[scoring] ?? b.adp.ppr;
    } else if (sortKey === "fpts") {
      av = a.fpts_2025[scoring] ?? a.fpts_2025.ppr;
      bv = b.fpts_2025[scoring] ?? b.fpts_2025.ppr;
    } else if (FACTOR_KEYS.includes(sortKey)) {
      // Natural sort by display metric; null (N/A) sorts last
      if (sortKey === "age") {
        av = a.activeMetrics.age ?? 0;
        bv = b.activeMetrics.age ?? 0;
      } else {
        av = a.activeMetrics[sortKey];
        bv = b.activeMetrics[sortKey];
        if (av == null && bv == null) return a.name.localeCompare(b.name);
        if (av == null) return 1;
        if (bv == null) return -1;
      }
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
