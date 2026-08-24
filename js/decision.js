/**
 * Draft decision engine — on-clock picks, value vs ADP, tiers, scarcity, strategy.
 */

import { rankPlayers, countRoster, emptyRosterCounts } from "./rankings.js";

/**
 * Proven fantasy draft archetypes — gently tilt BPA by position.
 * They never vault a WR3 over an elite RB1; needStrength stays soft.
 * suggestedPreset → ranking-style weights from WEIGHT_PRESETS (Situation, Market, etc.).
 */
export const STRATEGIES = {
  balanced: {
    label: "BPA / Balanced",
    desc: "Best player available every pick; soft roster-need tilt. Default for most redraft.",
    needStrength: 0.12,
    posBias: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 },
    suggestedPreset: "balanced",
  },
  hero_rb: {
    label: "Hero RB",
    desc: "One elite RB early (R1–2), then load WR/TE — the most common winning 2025–26 build.",
    needStrength: 0.12,
    posBias: { RB: 1.06, WR: 1.02, TE: 1.01, QB: 0.98, K: 0.92, DST: 0.92 },
    suggestedPreset: "production",
    earlyRbPushUntil: 1,
  },
  zero_rb: {
    label: "Zero RB",
    desc: "Fade early RBs for WR/TE studs; attack RB upside mid/late. Contrarian when room is Hero-heavy.",
    needStrength: 0.1,
    posBias: { WR: 1.06, TE: 1.04, RB: 0.9, QB: 1.0, K: 0.92, DST: 0.92 },
    suggestedPreset: "upside",
  },
  robust_rb: {
    label: "Robust RB",
    desc: "Stack RBs early (often 2–3 in first 4–5 picks); wait on QB/TE. Stronger in standard / low-PPR.",
    needStrength: 0.14,
    posBias: { RB: 1.08, WR: 0.97, TE: 0.96, QB: 0.95, K: 0.9, DST: 0.9 },
    suggestedPreset: "situation",
  },
  late_qb: {
    label: "Late QB",
    desc: "Ignore QB until mid rounds; take skill-position value while others reach for elites.",
    needStrength: 0.11,
    posBias: { QB: 0.88, RB: 1.02, WR: 1.03, TE: 1.02, K: 0.92, DST: 0.92 },
    suggestedPreset: "market",
  },
  best_ball: {
    label: "Best Ball",
    desc: "Ceiling chasing; stack volume; push K/DST to the end (or skip).",
    needStrength: 0.06,
    posBias: { WR: 1.04, TE: 1.03, RB: 1.02, QB: 1.03, K: 0.55, DST: 0.55 },
    suggestedPreset: "upside",
  },
  value: {
    label: "Value / Beat ADP",
    desc: "Lean into Flock + ADP + Vegas consensus; take falls, avoid reaches.",
    needStrength: 0.1,
    posBias: { QB: 1, RB: 1, WR: 1, TE: 1, K: 0.9, DST: 0.9 },
    suggestedPreset: "market",
  },
};

/** Apply Hero-RB style: once you have enough early RBs, stop boosting RB. */
export function strategyPosBias(strat, rosterCounts) {
  const bias = { ...(strat.posBias || {}) };
  if (strat.earlyRbPushUntil != null) {
    const rbs = rosterCounts?.RB || 0;
    if (rbs >= strat.earlyRbPushUntil) {
      bias.RB = Math.min(bias.RB ?? 1, 0.97);
      bias.WR = Math.max(bias.WR ?? 1, 1.03);
    }
  }
  return bias;
}

/**
 * Model rank among available (or all) players after ranking.
 * value = ADP - modelRank: positive = value (falls), negative = reach
 */
export function attachValueAndTiers(rankedList, scoring = "ppr") {
  // rankedList already sorted by displayTotal desc for summary
  const withRank = rankedList.map((p, i) => {
    const modelRank = i + 1;
    const adp = Number(p.adp?.[scoring] ?? p.adp?.ppr ?? 999);
    const value = Math.round((adp - modelRank) * 10) / 10;
    let valueTag = "fair";
    if (value >= 12) valueTag = "steal";
    else if (value >= 5) valueTag = "value";
    else if (value <= -12) valueTag = "reach";
    else if (value <= -5) valueTag = "slight-reach";
    return { ...p, modelRank, value, valueTag, adpRaw: adp };
  });

  // Tiers: break when score gap large within same position pool (overall tiers by total)
  const tiers = assignTiers(withRank, "displayTotal", 2.8);
  return withRank.map((p, i) => ({ ...p, tier: tiers[i] }));
}

function assignTiers(list, scoreKey, gapThreshold) {
  if (!list.length) return [];
  const tiers = [];
  let tier = 1;
  tiers[0] = 1;
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1][scoreKey] ?? list[i - 1].total ?? 0;
    const cur = list[i][scoreKey] ?? list[i].total ?? 0;
    if (prev - cur >= gapThreshold) tier += 1;
    // also force tier every ~12 overall for readability
    if (i > 0 && i % 14 === 0) tier = Math.max(tier, tiers[i - 1] + 1);
    tiers[i] = tier;
  }
  return tiers;
}

export function positionScarcity(players, rosterCounts, targets) {
  const available = players.filter((p) => !p.drafted);
  const byPos = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const p of available) {
    if (byPos[p.pos] !== undefined) byPos[p.pos] += 1;
  }
  const teams = targets.teams || 12;
  const depth = {
    QB: (targets.QB || 1) * teams + Math.ceil(teams * 0.5),
    RB: (targets.RB || 2) * teams + teams * 2,
    WR: (targets.WR || 2) * teams + teams * 2 + Math.ceil(teams * 0.5),
    TE: (targets.TE || 1) * teams + Math.ceil(teams * 0.8),
    K: teams,
    DST: teams,
  };
  const out = {};
  for (const pos of Object.keys(byPos)) {
    const left = byPos[pos];
    const expected = depth[pos] || 20;
    // scarcity 0–100: higher = scarcer
    const ratio = left / expected;
    const need = Math.max(0, (targets[pos] || 0) + (pos === "RB" || pos === "WR" ? 1 : 0) - (rosterCounts[pos] || 0));
    let score = Math.round((1 - Math.min(1.2, ratio)) * 70 + need * 15);
    score = Math.max(0, Math.min(100, score));
    out[pos] = { left, scarcity: score, need };
  }
  return out;
}

function needScore(pos, rosterCounts, targets) {
  const depth = {
    QB: (targets.QB || 1) + 1,
    RB: (targets.RB || 2) + 2 + Math.ceil((targets.FLEX || 1) * 0.4),
    WR: (targets.WR || 2) + 2 + Math.ceil((targets.FLEX || 1) * 0.5),
    TE: (targets.TE || 1) + 1,
    K: targets.K || 1,
    DST: targets.DST || 1,
  };
  const have = rosterCounts[pos] || 0;
  const want = depth[pos] || 1;
  if (have === 0) return 1.0;
  if (have >= want) return 0.15;
  return Math.max(0.2, 1 - have / want);
}

/**
 * Floor / ceiling from model total ± health/age/volatility.
 */
export function floorCeiling(p) {
  const base = p.displayTotal ?? p.total ?? 50;
  const health = p.activeMetrics?.injury ?? p.metrics?.ppr?.injury ?? 12;
  const ageFit = p.activeMetrics?.ageFitness ?? p.metrics?.ppr?.ageFitness ?? 70;
  const vol = Math.max(4, 18 - health * 0.4 + (100 - ageFit) * 0.08);
  const floor = Math.max(0, Math.round((base - vol) * 10) / 10);
  const ceiling = Math.min(100, Math.round((base + vol * 1.15) * 10) / 10);
  return { floor, ceiling, vol: Math.round(vol * 10) / 10 };
}

/**
 * Build reasons for recommending a player (BPA-first narrative).
 */
export function buildReasons(p, ctx) {
  const reasons = [];
  const { scarcity, rosterCounts, strategy } = ctx;
  const total = p.displayTotal ?? p.total ?? 0;
  reasons.push(`Best available: model ${total.toFixed(1)}/100 (board rank #${p.modelRank} among remaining)`);

  const ns = needScore(p.pos, rosterCounts, ctx.targets);
  if (ns >= 0.75 && (rosterCounts[p.pos] || 0) === 0) {
    reasons.push(`Also fills open ${p.pos} slot on your roster`);
  } else if (ns >= 0.7) {
    reasons.push(`Helps ${p.pos} depth (you have ${rosterCounts[p.pos] || 0})`);
  }
  if (scarcity[p.pos]?.scarcity >= 60) {
    reasons.push(`${p.pos} getting thin (${scarcity[p.pos].left} left on board)`);
  }
  const m = p.activeMetrics || {};
  if (m.opportunity && m.opportunity <= 5) {
    reasons.push(`Elite opportunity (#${m.opportunity} at ${p.pos})`);
  }
  // Value is informational only — not why we ranked him #1
  if (p.valueTag === "steal" || p.valueTag === "value") {
    reasons.push(`Bonus: still on board vs ADP ${p.adpRaw} (market later than model)`);
  }
  if (strategy === "hero_rb" && p.pos === "RB" && (rosterCounts.RB || 0) === 0) {
    reasons.push("Matches Hero-RB lean until you roster an RB");
  }
  if (ctx.myQbTeam && p.team === ctx.myQbTeam && (p.pos === "WR" || p.pos === "TE")) {
    reasons.push(`Stack with your QB (${p.team})`);
  }
  return reasons.slice(0, 4);
}

export function buildRisks(p) {
  const risks = [];
  const m = p.activeMetrics || p.metrics?.ppr || {};
  if ((m.injury ?? 17) <= 11) risks.push("Injury / games-played profile is shaky");
  if ((m.ageFitness ?? 80) < 45) risks.push("Age curve: decline risk elevated");
  if (p.rookie) risks.push("Rookie variance — role may lag Week 1–4");
  if ((m.opportunity ?? 20) >= 18) risks.push("Role not locked — committee / unproven path");
  if (p.valueTag === "reach") risks.push("Market disagrees (ADP much later) — be sure you want him");
  return risks.slice(0, 3);
}

/**
 * On-clock picks = Best Player Available on the remaining board.
 *
 * Primary sort: model total among undrafted players.
 * Soft adjustments only:
 *  - mild roster-need multiplier (cannot vault a WR3 over an elite RB1)
 *  - strategy position bias (~±6%)
 *  - K/DST suppressed until late
 *
 * ADP value is NEVER used to rank who to pick (shown as a label only).
 * Empty roster / pick 1 → essentially pure model BPA.
 */
export function recommendPicks(players, {
  scoring = "ppr",
  weights,
  targets,
  myRoster = [],
  strategy = "balanced",
  pickNumber = 1,
  limit = 5,
  hideKdstEarly = true,
} = {}) {
  const strat = STRATEGIES[strategy] || STRATEGIES.balanced;
  const rosterCounts = countRoster(myRoster);
  const available = players.filter((p) => !p.drafted);
  const rosterEmpty = myRoster.length === 0;

  // Pure model ranking of remaining players (no need boost in rankPlayers)
  let ranked = rankPlayers(available, {
    scoring,
    weights,
    hideDrafted: true,
    enableNeed: false,
    enableVorp: true,
    vorpBlend: 0.5,
    rosterCounts,
    targets,
  });
  ranked = attachValueAndTiers(ranked, scoring);
  const scarcity = positionScarcity(players, rosterCounts, targets);

  const myQb = myRoster.find((p) => p.pos === "QB");
  const ctx = { scarcity, rosterCounts, targets, strategy, myQbTeam: myQb?.team };

  const teams = targets.teams || 12;
  const early = pickNumber <= teams * 9; // before ~round 10
  // Need tilt only matters after you have a roster; stay tiny early
  const needStrength = rosterEmpty ? 0 : (strat.needStrength ?? 0.12) * (pickNumber <= teams ? 0.35 : 1);

  // League roster shape: extra WR/FLEX starters soft-tilt pass-catchers
  const rosterBias = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DST: 1 };
  if ((targets.WR || 2) >= 3 || (targets.FLEX || 1) >= 2) {
    rosterBias.WR = 1.04;
    rosterBias.TE = 1.02;
    rosterBias.RB = 0.98;
  }
  if ((targets.RB || 2) >= 3) {
    rosterBias.RB = Math.max(rosterBias.RB, 1.04);
    rosterBias.WR = Math.min(rosterBias.WR, 0.99);
  }

  const stratBias = strategyPosBias(strat, rosterCounts);

  const scored = ranked.map((p) => {
    const fc = floorCeiling(p);
    const n = needScore(p.pos, rosterCounts, targets);
    const model = p.displayTotal ?? p.total ?? 0;
    const bias = (stratBias[p.pos] ?? 1) * (rosterBias[p.pos] ?? 1);

    // BPA core: model score. Need multiplies in a narrow band, e.g. 0.94–1.12
    const needMult = 1 + needStrength * (n - 0.5) * 2; // n=1 → +needStrength, n=0.15 → slight down
    let pickScore = model * needMult * bias;

    // Scarcity: tiny bump only (max ~3%)
    pickScore *= 1 + Math.min(0.03, (scarcity[p.pos]?.scarcity || 0) / 2500);

    // Do not draft K/DST while studs remain
    if (hideKdstEarly && early && (p.pos === "K" || p.pos === "DST")) {
      pickScore *= 0.25;
    }
    // Soft-cap: never let need/bias alone jump more than ~8 model points over pure BPA
    // (guards against mid-round "values" outranking elite remaining talent)
    const pure = model;
    if (pickScore > pure + 8) pickScore = pure + 8;
    if (pickScore < pure - 6) pickScore = pure - 6;

    return {
      ...p,
      ...fc,
      pickScore: Math.round(pickScore * 100) / 100,
      bpaScore: model,
      reasons: null, // filled after sort so modelRank is correct
      risks: buildRisks(p),
      needFit: Math.round(n * 100),
    };
  });

  // Sort by adjusted BPA score, tie-break pure model then ADP (earlier ADP wins ties)
  scored.sort(
    (a, b) =>
      b.pickScore - a.pickScore ||
      b.bpaScore - a.bpaScore ||
      (a.adpRaw ?? 999) - (b.adpRaw ?? 999)
  );

  // Re-stamp modelRank among remaining for display (1 = best remaining by pure model)
  const byModel = [...scored].sort((a, b) => b.bpaScore - a.bpaScore);
  const modelRankMap = new Map(byModel.map((p, i) => [p.id, i + 1]));
  for (const p of scored) {
    p.modelRank = modelRankMap.get(p.id) ?? p.modelRank;
    p.reasons = buildReasons(p, ctx);
  }

  return {
    picks: scored.slice(0, limit),
    scarcity,
    rosterCounts,
    strategy: strat,
    mode: rosterEmpty ? "bpa" : "bpa_need",
  };
}

/**
 * Simple handcuff map by team for RBs.
 */
export function findHandcuff(player, allPlayers) {
  if (player.pos !== "RB") return null;
  const same = allPlayers
    .filter((p) => p.team === player.team && p.pos === "RB" && p.id !== player.id && !p.drafted)
    .sort((a, b) => (a.adp?.ppr ?? 200) - (b.adp?.ppr ?? 200));
  return same[0] || null;
}

/**
 * Stack mates on same team (WR/TE for a QB, etc.).
 */
export function stackMates(player, allPlayers, limit = 3) {
  if (player.pos === "QB") {
    return allPlayers
      .filter((p) => !p.drafted && p.team === player.team && (p.pos === "WR" || p.pos === "TE"))
      .sort((a, b) => (a.adp?.ppr ?? 200) - (b.adp?.ppr ?? 200))
      .slice(0, limit);
  }
  if (player.pos === "WR" || player.pos === "TE") {
    return allPlayers
      .filter((p) => !p.drafted && p.team === player.team && p.pos === "QB")
      .slice(0, 1);
  }
  return [];
}

/**
 * Weekly lineup helper (season mode): score starters by model + SOS + health.
 */
export function weeklyLineupScore(player, weekContext = {}) {
  const base = player.displayTotal ?? player.total ?? 50;
  const sos = player.activeMetrics?.sos ?? player.metrics?.ppr?.sos ?? 16;
  const health = player.activeMetrics?.injury ?? 14;
  // higher SOS score = easier schedule in our system
  const matchup = sos / 32;
  const healthF = health / 17;
  let s = base * 0.7 + matchup * 20 + healthF * 10;
  if (weekContext.boostPos && weekContext.boostPos === player.pos) s += 3;
  return Math.round(s * 10) / 10;
}

export function optimizeLineup(roster, {
  slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
  scoring = "ppr",
  weights,
} = {}) {
  const ranked = rankPlayers(roster, { scoring, weights, enableNeed: false });
  const used = new Set();
  const lineup = {};
  const flexEligible = ["RB", "WR", "TE"];

  function take(pos, n) {
    const picks = [];
    const pool = ranked
      .filter((p) => p.pos === pos && !used.has(p.id))
      .map((p) => ({ ...p, weekScore: weeklyLineupScore(p) }))
      .sort((a, b) => b.weekScore - a.weekScore);
    for (const p of pool) {
      if (picks.length >= n) break;
      picks.push(p);
      used.add(p.id);
    }
    return picks;
  }

  lineup.QB = take("QB", slots.QB || 1);
  lineup.RB = take("RB", slots.RB || 2);
  lineup.WR = take("WR", slots.WR || 2);
  lineup.TE = take("TE", slots.TE || 1);
  lineup.K = take("K", slots.K || 1);
  lineup.DST = take("DST", slots.DST || 1);

  const flexN = slots.FLEX || 1;
  const flexPool = ranked
    .filter((p) => flexEligible.includes(p.pos) && !used.has(p.id))
    .map((p) => ({ ...p, weekScore: weeklyLineupScore(p) }))
    .sort((a, b) => b.weekScore - a.weekScore);
  lineup.FLEX = flexPool.slice(0, flexN);
  flexPool.slice(0, flexN).forEach((p) => used.add(p.id));

  const bench = ranked.filter((p) => !used.has(p.id));
  return { lineup, bench, ranked };
}

/**
 * Waiver wire targets: available players ranked by model + need for your roster.
 */
export function waiverTargets(allPlayers, myRoster, {
  scoring,
  weights,
  targets,
  limit = 15,
} = {}) {
  const mine = new Set(myRoster.map((p) => p.id));
  const free = allPlayers.filter((p) => !p.drafted && !mine.has(p.id));
  // treat undrafted as FA pool in season mode; if draft complete all non-roster are FA
  const rosterCounts = countRoster(myRoster);
  let ranked = rankPlayers(free, {
    scoring,
    weights,
    enableNeed: true,
    rosterCounts,
    targets,
  });
  ranked = attachValueAndTiers(ranked, scoring);
  return ranked.slice(0, limit).map((p, i) => ({
    ...p,
    waiverRank: i + 1,
    addScore: p.displayTotal,
    reasons: buildReasons(p, {
      scarcity: positionScarcity(allPlayers, rosterCounts, targets),
      rosterCounts,
      targets,
      strategy: "balanced",
    }),
  }));
}

export function defaultLeagueSettings() {
  return {
    teams: 12,
    scoring: "ppr",
    strategy: "balanced",
    draftSlot: 1,
    passTd: 4,
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  };
}

export function estimatePickNumber(draftSlot, teams, picksMadeByMe, totalPicks) {
  // rough: snake draft current overall if we only know my pick count
  const round = picksMadeByMe + 1;
  if (round % 2 === 1) return (round - 1) * teams + draftSlot;
  return round * teams - draftSlot + 1;
}
