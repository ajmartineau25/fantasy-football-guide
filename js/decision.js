/**
 * Draft decision engine — on-clock picks, value vs ADP, tiers, scarcity, strategy.
 */

import { rankPlayers, countRoster, emptyRosterCounts } from "./rankings.js";

export const STRATEGIES = {
  balanced: {
    label: "Balanced",
    desc: "Best blend of value + roster need",
    needWeight: 0.35,
    valueWeight: 0.35,
    modelWeight: 0.3,
  },
  zero_rb: {
    label: "Zero RB",
    desc: "Load WR/TE early; RB later",
    needWeight: 0.25,
    valueWeight: 0.3,
    modelWeight: 0.25,
    posBias: { WR: 1.12, TE: 1.06, RB: 0.82, QB: 1.0, K: 0.9, DST: 0.9 },
  },
  hero_rb: {
    label: "Hero RB",
    desc: "Secure elite RB early, then WR",
    needWeight: 0.3,
    valueWeight: 0.3,
    modelWeight: 0.25,
    posBias: { RB: 1.14, WR: 1.0, TE: 1.0, QB: 0.98, K: 0.9, DST: 0.9 },
  },
  robust_rb: {
    label: "Robust RB",
    desc: "Prioritize RB depth through mid rounds",
    needWeight: 0.35,
    valueWeight: 0.25,
    modelWeight: 0.25,
    posBias: { RB: 1.18, WR: 0.95, TE: 0.98, QB: 0.95, K: 0.9, DST: 0.9 },
  },
  best_ball: {
    label: "Best Ball",
    desc: "Upside + stacks; de-emphasize K/DST early",
    needWeight: 0.2,
    valueWeight: 0.35,
    modelWeight: 0.3,
    posBias: { WR: 1.08, TE: 1.05, RB: 1.02, QB: 1.06, K: 0.5, DST: 0.5 },
  },
};

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
  const depth = {
    QB: (targets.QB || 1) * 12 + 6,
    RB: (targets.RB || 2) * 12 + 24,
    WR: (targets.WR || 2) * 12 + 30,
    TE: (targets.TE || 1) * 12 + 10,
    K: 12,
    DST: 12,
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
 * Build reasons for recommending a player.
 */
export function buildReasons(p, ctx) {
  const reasons = [];
  const { scarcity, rosterCounts, strategy } = ctx;
  if (p.valueTag === "steal" || p.valueTag === "value") {
    reasons.push(`Value: ADP ${p.adpRaw} vs model #${p.modelRank} (+${p.value} slots)`);
  } else if (p.valueTag === "reach" || p.valueTag === "slight-reach") {
    reasons.push(`Slight reach vs ADP ${p.adpRaw} (model #${p.modelRank}) — justified by need/upside`);
  }
  const ns = needScore(p.pos, rosterCounts, ctx.targets);
  if (ns >= 0.7) reasons.push(`Fills ${p.pos} need (you have ${rosterCounts[p.pos] || 0})`);
  if (scarcity[p.pos]?.scarcity >= 55) {
    reasons.push(`${p.pos} scarcity high (${scarcity[p.pos].left} quality options left)`);
  }
  const m = p.activeMetrics || {};
  if (m.opportunity && m.opportunity <= 5) reasons.push(`Elite opportunity (#${m.opportunity} at ${p.pos})`);
  if (m.vegasYards && m.vegasYardsLabel) {
    reasons.push(`Vegas: ${Math.round(m.vegasYards)} ${m.vegasYardsLabel} O/U`);
  }
  if ((m.injury ?? 17) <= 10) reasons.push("Durability risk — bank on upside if healthy");
  if (p.tier && p.tier <= 3) reasons.push(`Tier ${p.tier} talent — last of a clear tier soon`);
  if (strategy === "zero_rb" && p.pos === "WR") reasons.push("Fits Zero-RB: prioritize pass catchers");
  if (strategy === "hero_rb" && p.pos === "RB" && (rosterCounts.RB || 0) === 0) {
    reasons.push("Hero RB: lock your workhorse");
  }
  // stacks
  if (ctx.myQbTeam && p.team === ctx.myQbTeam && (p.pos === "WR" || p.pos === "TE")) {
    reasons.push(`Stack with your QB (${p.team})`);
  }
  if (!reasons.length) reasons.push(`Strong model total (${(p.displayTotal ?? p.total).toFixed(1)}) at ${p.pos}`);
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
 * On-clock recommendation list.
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

  let ranked = rankPlayers(available, {
    scoring,
    weights,
    hideDrafted: true,
    enableNeed: false,
    rosterCounts,
    targets,
  });
  ranked = attachValueAndTiers(ranked, scoring);
  const scarcity = positionScarcity(players, rosterCounts, targets);

  const myQb = myRoster.find((p) => p.pos === "QB");
  const ctx = { scarcity, rosterCounts, targets, strategy, myQbTeam: myQb?.team };

  // Early-round K/DST penalty
  const early = pickNumber <= (targets.teams || 12) * 9;

  const scored = ranked.map((p) => {
    const fc = floorCeiling(p);
    const n = needScore(p.pos, rosterCounts, targets);
    const valNorm = Math.max(-20, Math.min(25, p.value)) / 25; // -1..1
    const valScore = (valNorm + 1) / 2; // 0..1
    const modelNorm = (p.displayTotal ?? p.total ?? 0) / 100;
    const bias = strat.posBias?.[p.pos] ?? 1;
    let pickScore =
      strat.modelWeight * modelNorm +
      strat.valueWeight * valScore +
      strat.needWeight * n;
    pickScore *= bias;
    if (hideKdstEarly && early && (p.pos === "K" || p.pos === "DST")) pickScore *= 0.35;
    // slight scarcity bump
    pickScore *= 1 + (scarcity[p.pos]?.scarcity || 0) / 400;
    return {
      ...p,
      ...fc,
      pickScore: Math.round(pickScore * 1000) / 1000,
      reasons: buildReasons(p, ctx),
      risks: buildRisks(p),
      needFit: Math.round(n * 100),
    };
  });

  scored.sort((a, b) => b.pickScore - a.pickScore || b.displayTotal - a.displayTotal);
  return {
    picks: scored.slice(0, limit),
    scarcity,
    rosterCounts,
    strategy: strat,
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
