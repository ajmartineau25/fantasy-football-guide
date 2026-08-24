/**
 * 2025 retrospective scorecard — ADP hit rates vs actual finishes.
 * Honest framing: uses archived 2025 preseason ADP vs 2025 PPR points in our data.
 */
import { starterDemand } from "./rankings.js";

const $ = (sel, el = document) => el.querySelector(sel);

const DATA_FALLBACK =
  "https://raw.githubusercontent.com/ajmartineau25/fantasy-football-guide/main/data";

async function fetchJson(path) {
  try {
    const res = await fetch(`./data/${path}`);
    if (res.ok) return res.json();
  } catch (_) {}
  const res = await fetch(`${DATA_FALLBACK}/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function toast(msg, type = "ok") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

function spearman(pairs) {
  // pairs: [{x, y}]
  const n = pairs.length;
  if (n < 3) return null;
  const rank = (key) => {
    const sorted = [...pairs].sort((a, b) => a[key] - b[key]);
    const map = new Map();
    sorted.forEach((row, i) => map.set(row, i + 1));
    return map;
  };
  const rx = rank("x");
  const ry = rank("y");
  let sumD2 = 0;
  for (const row of pairs) {
    const d = rx.get(row) - ry.get(row);
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function hitRate(finishRankById, draftRankById, topN) {
  const finishTop = new Set(
    [...finishRankById.entries()].filter(([, r]) => r <= topN).map(([id]) => id)
  );
  const draftTop = new Set(
    [...draftRankById.entries()].filter(([, r]) => r <= topN).map(([id]) => id)
  );
  let hits = 0;
  for (const id of draftTop) if (finishTop.has(id)) hits += 1;
  return { hits, of: topN, pct: Math.round((hits / topN) * 1000) / 10 };
}

function buildScorecard(players, adpMap, scoring = "ppr") {
  const skill = players.filter(
    (p) => ["QB", "RB", "WR", "TE"].includes(p.pos) && (p.fpts_2025?.[scoring] || 0) > 0
  );

  // Finish ranks by 2025 fantasy points
  const byFinish = [...skill].sort(
    (a, b) => (b.fpts_2025[scoring] || 0) - (a.fpts_2025[scoring] || 0)
  );
  const finishRank = new Map(byFinish.map((p, i) => [p.id, i + 1]));

  // ADP ranks from 2025 archive (only players we have ADP for)
  const withAdp = skill
    .map((p) => ({ p, adp: adpMap[p.name] }))
    .filter((x) => x.adp != null)
    .sort((a, b) => a.adp - b.adp);
  const adpRank = new Map(withAdp.map((x, i) => [x.p.id, i + 1]));

  const paired = withAdp.map(({ p, adp }) => ({
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team,
    fpts: p.fpts_2025[scoring],
    adp,
    finish: finishRank.get(p.id),
    adpR: adpRank.get(p.id),
    delta: adpRank.get(p.id) - finishRank.get(p.id), // + = outperformed ADP
  }));

  const corr = spearman(paired.map((r) => ({ x: r.adpR, y: r.finish })));

  const hits = {
    top12: hitRate(finishRank, adpRank, 12),
    top24: hitRate(finishRank, adpRank, 24),
    top36: hitRate(finishRank, adpRank, 36),
    top60: hitRate(finishRank, adpRank, Math.min(60, paired.length)),
  };

  // Biggest ADP misses / steals among paired
  const steals = [...paired].sort((a, b) => b.delta - a.delta).slice(0, 10);
  const busts = [...paired].sort((a, b) => a.delta - b.delta).slice(0, 10);

  // Positional replacement demo for VORP education (12-team standard)
  const demand = starterDemand({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, teams: 12 });
  const vorpNotes = {};
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const pool = byFinish.filter((p) => p.pos === pos);
    const at = Math.round(12 * demand[pos]);
    const rep = pool[at - 1];
    vorpNotes[pos] = {
      replaceAt: at,
      name: rep?.name || "—",
      fpts: rep ? Math.round(rep.fpts_2025[scoring]) : null,
    };
  }

  return {
    nPaired: paired.length,
    nFinish: skill.length,
    corr,
    hits,
    steals,
    busts,
    topFinish: byFinish.slice(0, 24).map((p, i) => ({
      rank: i + 1,
      name: p.name,
      pos: p.pos,
      team: p.team,
      fpts: Math.round(p.fpts_2025[scoring] * 10) / 10,
      adp: adpMap[p.name] ?? null,
      adpR: adpRank.get(p.id) ?? null,
    })),
    vorpNotes,
  };
}

function render(sc, meta) {
  $("#scMeta").textContent = meta?.note || "2025 retrospective";
  $("#scN").textContent = String(sc.nPaired);
  $("#scCorr").textContent = sc.corr == null ? "—" : sc.corr.toFixed(3);

  const hitHtml = ["top12", "top24", "top36", "top60"]
    .map((k) => {
      const h = sc.hits[k];
      return `<div class="stat-pill">${k.replace("top", "Top ")}\n<strong>${h.hits}/${h.of}</strong> (${h.pct}%)</div>`;
    })
    .join("");
  $("#scHits").innerHTML = hitHtml;

  $("#scSteals").innerHTML = sc.steals
    .map(
      (r) =>
        `<tr><td>${r.name}</td><td><span class="pos-badge ${r.pos}">${r.pos}</span></td><td>${r.adpR}</td><td>${r.finish}</td><td class="vs-adp up">+${r.delta}</td><td>${Math.round(r.fpts)}</td></tr>`
    )
    .join("");

  $("#scBusts").innerHTML = sc.busts
    .map(
      (r) =>
        `<tr><td>${r.name}</td><td><span class="pos-badge ${r.pos}">${r.pos}</span></td><td>${r.adpR}</td><td>${r.finish}</td><td class="vs-adp down">${r.delta}</td><td>${Math.round(r.fpts)}</td></tr>`
    )
    .join("");

  $("#scFinish").innerHTML = sc.topFinish
    .map(
      (r) =>
        `<tr><td>${r.rank}</td><td>${r.name}</td><td><span class="pos-badge ${r.pos}">${r.pos}</span></td><td>${r.team}</td><td>${r.fpts}</td><td>${r.adp ?? "—"}</td><td>${r.adpR ?? "—"}</td></tr>`
    )
    .join("");

  $("#scVorp").innerHTML = Object.entries(sc.vorpNotes)
    .map(
      ([pos, v]) =>
        `<div class="stat-pill">${pos} repl. @${v.replaceAt}: <strong>${v.name}</strong> (${v.fpts ?? "—"} pts)</div>`
    )
    .join("");
}

async function init() {
  try {
    const [players, adpFile] = await Promise.all([
      fetchJson("players.json"),
      fetchJson("adp_2025.json"),
    ]);
    const sc = buildScorecard(players, adpFile.adp || {}, "ppr");
    render(sc, adpFile);
    toast(`Scorecard ready · ${sc.nPaired} players with 2025 ADP`);
  } catch (e) {
    console.error(e);
    toast(e.message || "Failed to load scorecard", "err");
  }
}

init();
