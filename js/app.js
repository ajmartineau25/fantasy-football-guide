import {
  FACTOR_KEYS,
  FACTOR_LABELS,
  FACTOR_TAB_LABELS,
  FACTOR_DESCRIPTIONS,
  FACTOR_META,
  TEAM_LEVEL_FACTORS,
  WEIGHT_PRESETS,
  presetById,
  rankPlayers,
  rankTeamsByFactor,
  formatMetric,
  metricUnit,
  defaultSortDirForFactor,
  countRoster,
  emptyRosterCounts,
} from "./rankings.js";
import {
  sleeperGetUser,
  sleeperGetLeagues,
  sleeperGetDraft,
  sleeperGetPicks,
  sleeperGetLeague,
  sleeperGetLeagueDrafts,
  sleeperHydratePlayerIds,
  applySleeperPicks,
  espnFetchLeague,
  applyEspnDraft,
  createDraftPoller,
  markDraftedByName,
} from "./draft.js";
import {
  STRATEGIES,
  recommendPicks,
  attachValueAndTiers,
  floorCeiling,
  findHandcuff,
  stackMates,
  defaultLeagueSettings,
  estimatePickNumber,
} from "./decision.js";

const state = {
  players: [],
  meta: null,
  teams: null,
  scoring: "ppr", // ppr | half
  /** "summary" or a FACTOR_KEYS value */
  view: "summary",
  position: "ALL",
  search: "",
  hideDrafted: false,
  sortKey: "total",
  sortDir: "desc",
  weights: {},
  weightPreset: "balanced",
  enableNeed: true,
  myRoster: [],
  picks: [],
  draftSource: null, // sleeper | espn | manual
  poller: null,
  sleeper: { userId: null, username: null, draftId: null },
  espn: { leagueId: null, teamId: null },
  selectedPlayer: null,
  strategy: "balanced",
  draftSlot: 1,
  leagueTeams: 12,
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  boardMode: "sheet", // sheet | factors
  lastRecs: [],
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function toast(msg, type = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

/** Local first; fall back to public GitHub raw if data missing on host. */
const DATA_FALLBACK =
  "https://raw.githubusercontent.com/ajmartineau25/fantasy-football-guide/main/data";

async function fetchJson(path) {
  const local = `./data/${path}`;
  try {
    const res = await fetch(local);
    if (res.ok) return res.json();
  } catch (_) {
    /* try remote */
  }
  const res = await fetch(`${DATA_FALLBACK}/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

async function loadData() {
  const [players, meta, teams] = await Promise.all([
    fetchJson("players.json"),
    fetchJson("meta.json"),
    fetchJson("teams.json"),
  ]);
  state.players = players;
  state.meta = meta;
  state.teams = teams;
  const preset = presetById(state.weightPreset || "balanced");
  state.weightPreset = preset.id;
  state.weights = { ...preset.weights };
  if (!["ppr", "half"].includes(state.scoring)) {
    state.scoring = meta.league_defaults?.scoring === "half" ? "half" : "ppr";
  }
  // Defaults first, then any saved roster overrides from loadLeaguePrefs (already applied)
  if (meta.league_defaults?.roster) {
    state.roster = { ...meta.league_defaults.roster, ...state.roster };
  }
}

function rosterTargets() {
  const r = state.roster || state.meta?.league_defaults?.roster || {};
  return {
    QB: Number(r.QB ?? 1),
    RB: Number(r.RB ?? 2),
    WR: Number(r.WR ?? 2),
    TE: Number(r.TE ?? 1),
    FLEX: Number(r.FLEX ?? 1),
    K: Number(r.K ?? 1),
    DST: Number(r.DST ?? 1),
    BN: Number(r.BN ?? 6),
    teams: state.leagueTeams,
  };
}

function rosterLabel() {
  const t = rosterTargets();
  return `${t.QB}QB ${t.RB}RB ${t.WR}WR ${t.TE}TE ${t.FLEX}FLEX`;
}

function renderSheetHeader() {
  const sub = $("#sheetSub");
  const badges = $("#sheetBadges");
  if (!sub || !badges) return;
  const scoring = state.scoring === "ppr" ? "PPR" : "0.5 PPR";
  const preset = presetById(state.weightPreset);
  const flockW = state.weights?.flock ?? 0;
  sub.textContent = `${state.leagueTeams}-team · ${rosterLabel()} · ${preset.label} · Flock blend ${flockW}%`;
  badges.innerHTML = `
    <span class="sheet-badge accent">${scoring}</span>
    <span class="sheet-badge">${state.leagueTeams} TEAM</span>
    <span class="sheet-badge">Flock ${flockW}%</span>
    <span class="sheet-badge muted">Aug 24</span>
  `;
}

function persistMyRoster() {
  try {
    localStorage.setItem("ffg_my_roster", JSON.stringify(state.myRoster.map((p) => p.id)));
    localStorage.setItem(
      "ffg_league",
      JSON.stringify({
        strategy: state.strategy,
        draftSlot: state.draftSlot,
        leagueTeams: state.leagueTeams,
        scoring: state.scoring,
        roster: state.roster,
        boardMode: state.boardMode,
        weightPreset: state.weightPreset,
      })
    );
  } catch (_) {}
}

function loadLeaguePrefs() {
  try {
    const raw = localStorage.getItem("ffg_league");
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o.strategy) state.strategy = o.strategy;
    if (o.draftSlot) state.draftSlot = o.draftSlot;
    if (o.leagueTeams) state.leagueTeams = o.leagueTeams;
    if (o.scoring) state.scoring = o.scoring;
    if (o.roster && typeof o.roster === "object") state.roster = { ...state.roster, ...o.roster };
    if (o.boardMode) state.boardMode = o.boardMode;
    if (o.weightPreset) state.weightPreset = o.weightPreset;
  } catch (_) {}
}

function syncRosterInputs() {
  const map = {
    rosterQB: "QB",
    rosterRB: "RB",
    rosterWR: "WR",
    rosterTE: "TE",
    rosterFLEX: "FLEX",
    rosterK: "K",
    rosterDST: "DST",
    rosterBN: "BN",
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $(`#${id}`);
    if (el) el.value = String(state.roster[key] ?? 0);
  }
}

function readRosterInputs() {
  const map = {
    rosterQB: "QB",
    rosterRB: "RB",
    rosterWR: "WR",
    rosterTE: "TE",
    rosterFLEX: "FLEX",
    rosterK: "K",
    rosterDST: "DST",
    rosterBN: "BN",
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $(`#${id}`);
    if (el) state.roster[key] = Math.max(0, Number(el.value) || 0);
  }
}

function setBoardMode(mode) {
  state.boardMode = mode === "factors" ? "factors" : "sheet";
  $$(".mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.boardMode === state.boardMode)
  );
  const tabs = $("#rankTabs");
  if (tabs) tabs.classList.toggle("hidden", state.boardMode === "sheet");
  if (state.boardMode === "sheet") {
    state.view = "summary";
    state.sortKey = "total";
    state.sortDir = "desc";
  }
  persistMyRoster();
  renderBoard();
}

function tierClass(tier) {
  const t = Math.min(8, Math.max(1, Number(tier) || 1));
  return `tier-pill t${t}`;
}

function valueTagHtml(tag) {
  if (!tag) return "";
  return `<span class="tag ${tag}">${tag.replace("-", " ")}</span>`;
}

function renderOnClock() {
  const pickNo = estimatePickNumber(
    state.draftSlot,
    state.leagueTeams,
    state.myRoster.length,
    state.leagueTeams * 15
  );
  const { picks, scarcity, strategy, mode } = recommendPicks(state.players, {
    scoring: state.scoring,
    weights: state.weights,
    targets: rosterTargets(),
    myRoster: state.myRoster,
    strategy: state.strategy,
    pickNumber: pickNo,
    limit: 5,
  });
  state.lastRecs = picks;

  $("#statStrategy").textContent = strategy.label || state.strategy;
  const modeLabel = mode === "bpa" ? "Best player available (empty roster)" : "BPA among remaining + soft roster fit";
  $("#onClockMeta").textContent = `${modeLabel} · ${strategy.label} · ~pick ${pickNo}`;

  $("#scarcityBar").innerHTML = ["RB", "WR", "TE", "QB"]
    .map((pos) => {
      const s = scarcity[pos];
      if (!s) return "";
      const cls = s.scarcity >= 55 ? "hot" : s.scarcity <= 30 ? "ok" : "";
      return `<span class="scarcity-chip ${cls}">${pos}: ${s.left} left${s.need ? ` · need ${s.need}` : ""}</span>`;
    })
    .join("");

  $("#onClockList").innerHTML = picks
    .map((p, i) => {
      const fc = floorCeiling(p);
      const score = (p.bpaScore ?? p.displayTotal ?? p.total ?? 0).toFixed(1);
      return `<div class="on-clock-card ${i === 0 ? "pick-1" : ""}" data-id="${p.id}">
        <div class="oc-top">
          <span class="oc-rank">${i + 1}</span>
          <span class="pos-badge ${p.pos}">${p.pos}</span>
          <div>
            <div class="oc-name">${p.name} <span class="tag tier">BPA #${p.modelRank}</span>${p.tier ? `<span class="tag tier">T${p.tier}</span>` : ""}${valueTagHtml(p.valueTag)}</div>
            <div class="oc-meta">${p.team} · model <strong>${score}</strong> · ADP ${p.adpRaw} · F/C ${fc.floor}–${fc.ceiling}${p.needFit >= 70 ? ` · fills need` : ""}</div>
          </div>
        </div>
        <ul>${(p.reasons || []).map((r) => `<li>${r}</li>`).join("")}</ul>
        <div class="btn-row" style="margin-top:8px">
          <button type="button" class="btn btn-primary oc-draft" data-id="${p.id}" style="font-size:0.75rem;padding:6px">Draft him</button>
        </div>
      </div>`;
    })
    .join("") || `<div class="help-text">No players left on the board.</div>`;

  $$("#onClockList .on-clock-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".oc-draft")) return;
      openPlayer(card.dataset.id);
    });
  });
  $$("#onClockList .oc-draft").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      manualDraft(btn.dataset.id, true);
    });
  });

  // Right rail = same BPA list
  $("#recList").innerHTML = picks
    .slice(0, 6)
    .map(
      (p) => `
    <div class="rec-item" data-id="${p.id}">
      <span class="pos-badge ${p.pos}">${p.pos}</span>
      <div>
        <div><strong>${p.name}</strong></div>
        <div class="meta" style="color:var(--text-muted);font-size:0.72rem">${p.team} · BPA #${p.modelRank} · model ${(p.bpaScore ?? p.total).toFixed(1)}</div>
      </div>
      <span class="score">${(p.bpaScore ?? p.displayTotal ?? p.total).toFixed(1)}</span>
    </div>`
    )
    .join("");
  $$("#recList .rec-item").forEach((el) => {
    el.addEventListener("click", () => openPlayer(el.dataset.id));
  });
}

function applyWeightPreset(id, { silent = false } = {}) {
  const preset = presetById(id);
  state.weightPreset = preset.id;
  state.weights = { ...preset.weights };
  renderWeightPresets();
  renderWeights();
  renderBoard();
  if (!silent) toast(`Ranking style: ${preset.label}`);
}

function renderWeightPresets() {
  const box = $("#weightPresets");
  if (!box) return;
  box.innerHTML = WEIGHT_PRESETS.map((p) => {
    const active = state.weightPreset === p.id ? "active" : "";
    return `<button type="button" class="preset-chip ${active}" data-preset="${p.id}" title="${p.desc}">
      ${p.label}
    </button>`;
  }).join("");
  const desc = $("#presetDesc");
  if (desc) desc.textContent = presetById(state.weightPreset).desc;
  box.querySelectorAll(".preset-chip").forEach((btn) => {
    btn.addEventListener("click", () => applyWeightPreset(btn.dataset.preset));
  });
}

function renderWeights() {
  const box = $("#weights");
  if (!box) return;
  box.innerHTML = FACTOR_KEYS.map((key) => {
    const val = state.weights[key] ?? 0;
    const label = state.meta?.factors?.find((f) => f.key === key)?.label || FACTOR_LABELS[key];
    return `
      <div class="weight-row">
        <label for="w-${key}">${label}</label>
        <span class="val" id="wv-${key}">${val}</span>
        <input type="range" id="w-${key}" min="0" max="30" value="${val}" data-key="${key}" />
      </div>`;
  }).join("");

  box.querySelectorAll("input[type=range]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.key;
      state.weights[key] = Number(input.value);
      state.weightPreset = "custom";
      $(`#wv-${key}`).textContent = input.value;
      updateWeightTotal();
      renderWeightPresets();
      renderBoard();
    });
  });
  updateWeightTotal();
}

function updateWeightTotal() {
  const sum = FACTOR_KEYS.reduce((a, k) => a + (Number(state.weights[k]) || 0), 0);
  const el = $("#weightTotal");
  el.className = `weight-total ${sum === 100 ? "ok" : "bad"}`;
  el.innerHTML = `<span>Weight sum</span><span>${sum}${sum === 100 ? " ✓" : " (aim for 100)"}</span>`;
}

function renderNeedMeter() {
  const counts = countRoster(state.myRoster);
  const t = rosterTargets();
  const order = ["QB", "RB", "WR", "TE", "K", "DST"];
  const depth = {
    QB: t.QB + 1,
    RB: t.RB + 2 + Math.ceil(t.FLEX * 0.4),
    WR: t.WR + 2 + Math.ceil(t.FLEX * 0.5),
    TE: t.TE + 1,
    K: 1,
    DST: 1,
  };
  $("#needMeter").innerHTML = order
    .map((pos) => {
      const have = counts[pos] || 0;
      const want = depth[pos];
      const pct = Math.min(100, Math.round((have / want) * 100));
      const need = have === 0 ? "need-high" : have < want * 0.5 ? "need-med" : "";
      return `
        <div class="need-item ${need}">
          <div class="pos">${pos}</div>
          <div class="fill"><div style="width:${pct}%"></div></div>
          <div class="count">${have} / ${want}</div>
        </div>`;
    })
    .join("");
}

function topRecommendations(ranked, n = 5) {
  const available = ranked.filter((p) => !p.drafted);
  return available.slice(0, n);
}

function renderRecommendations(ranked) {
  const recs = topRecommendations(ranked, 6);
  $("#recList").innerHTML = recs
    .map(
      (p) => `
    <div class="rec-item" data-id="${p.id}">
      <span class="pos-badge ${p.pos}">${p.pos}</span>
      <div>
        <div><strong>${p.name}</strong></div>
        <div class="meta" style="color:var(--text-muted);font-size:0.72rem">${p.team} · ADP ${p.adp[state.scoring]}</div>
      </div>
      <span class="score">${p.displayTotal.toFixed(1)}</span>
    </div>`
    )
    .join("");
  $$("#recList .rec-item").forEach((el) => {
    el.addEventListener("click", () => openPlayer(el.dataset.id));
  });
}

function renderDraftLog() {
  const log = $("#draftLog");
  if (!state.picks.length) {
    log.innerHTML = `<div class="help-text">No picks yet. Connect Sleeper/ESPN or mark picks manually.</div>`;
    return;
  }
  const recent = [...state.picks].reverse().slice(0, 40);
  log.innerHTML = recent
    .map(
      (p) => `
    <div class="pick ${p.isMine ? "mine" : ""}">
      <span class="num">#${p.pickNo ?? "—"}</span>
      <span>${p.isMine ? "★ " : ""}${p.name} <span style="color:var(--text-muted)">${p.pos || ""} ${p.team || ""}</span></span>
    </div>`
    )
    .join("");
}

/** Bar width from a 0–100 model percentile (or approx from factor). */
function barWidthPct(pct) {
  return Math.max(4, Math.round((Math.min(100, Math.max(0, pct)) / 100) * 48));
}

function isFactorView() {
  return FACTOR_KEYS.includes(state.view);
}

function viewLabel() {
  if (state.view === "summary") return "Summary";
  return FACTOR_TAB_LABELS[state.view] || FACTOR_LABELS[state.view] || state.view;
}

function renderViewBanner() {
  const banner = $("#viewBanner");
  if (state.view === "summary") {
    banner.innerHTML = `
      <h3>Summary — multi-factor model total</h3>
      <p>Players ranked by a <strong>0–100 model score</strong>: each factor is converted to a percentile in its natural units, then combined with your weights. Columns show the real metrics (FPts, ADP, win totals, etc.) — not a fake 1–32 for everything.</p>
      <div class="banner-meta">
        <div class="stat-pill">Model total <strong>0–100</strong></div>
        <div class="stat-pill">Playcaller / QB / SOS <strong>1–32 teams</strong></div>
        <div class="stat-pill">Last year <strong>FPts</strong> · ADP <strong>pick #</strong> · Vegas <strong>player props</strong></div>
      </div>`;
    return;
  }

  const key = state.view;
  const label = FACTOR_TAB_LABELS[key] || FACTOR_LABELS[key];
  const fm = FACTOR_META[key] || {};
  const meta = state.meta?.factors?.find((f) => f.key === key);
  const unit = meta?.unit || fm.unit || "";
  const desc = meta?.desc || FACTOR_DESCRIPTIONS[key] || fm.desc || "";
  const weight = state.weights[key] ?? 0;
  const teamNote = TEAM_LEVEL_FACTORS.has(key)
    ? " Team board below lists all 32 clubs."
    : "";

  banner.innerHTML = `
    <h3>${label} <span style="color:var(--text-muted);font-weight:600">· natural scale</span></h3>
    <p>${desc}${teamNote}</p>
    <div class="banner-meta">
      <div class="stat-pill">Unit <strong>${unit}</strong></div>
      <div class="stat-pill">Scale <strong>${fm.scaleNote || unit}</strong></div>
      <div class="stat-pill">Summary weight <strong>${weight}</strong></div>
    </div>`;
}

function renderTeamRankPanel() {
  const panel = $("#teamRankPanel");
  if (!isFactorView() || !TEAM_LEVEL_FACTORS.has(state.view) || !state.teams) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const key = state.view;
  const rows = rankTeamsByFactor(state.teams, key);
  const titleMap = {
    playcaller: "All 32 playcallers — applies to QB/RB/WR/TE only (not K/DST)",
    qb: "Team QB quality — applies to WR & TE only (not RB/QB/K/DST)",
    oline: "Offensive line — applies to RB & QB only (not WR/TE/K/DST)",
    sos: "Strength of schedule (32 = easiest → 1 = hardest)",
  };

  const cards = rows
    .map((r) => {
      const top = r.rank <= 3 ? "top3" : r.rank >= 30 ? "bottom3" : "";
      let detail = r.detail;
      let displayVal;
      let unitSuffix;
      if (key === "playcaller") {
        detail = `${r.playcaller_name || detail}${r.scheme ? " · " + r.scheme : ""}`;
        displayVal = r.value;
        unitSuffix = "/32";
      } else if (key === "qb") {
        detail = r.name + " · WR/TE only";
        displayVal = r.qb_rank;
        unitSuffix = "/32";
      } else if (key === "oline") {
        detail = r.name + " · RB/QB only";
        displayVal = r.ol_rank ?? r.value;
        unitSuffix = "/32";
      } else if (key === "sos") {
        detail = r.name;
        displayVal = r.sos_rank;
        unitSuffix = "/32";
      }
      return `
        <div class="team-rank-card ${top}">
          <div class="rk">${r.rank}</div>
          <div>
            <div class="team-abbr">${r.team}</div>
            <div class="team-detail">${detail}</div>
          </div>
          <div class="team-score">${displayVal}<span>${unitSuffix}</span></div>
        </div>`;
    })
    .join("");

  panel.classList.remove("hidden");
  panel.innerHTML = `
    <h3>${titleMap[key] || "Team rankings"}</h3>
    <div class="team-rank-grid">${cards}</div>
    <p class="section-label" style="margin-top:14px">Players on this factor</p>`;
}

function getRankedList() {
  const isFactor = isFactorView();
  // Factor tabs: sort by the active factor unless user clicked another column header
  let sortKey = state.sortKey;
  if (isFactor && (sortKey === "total" || !sortKey)) {
    sortKey = state.view;
  }

  return rankPlayers(state.players, {
    scoring: state.scoring,
    weights: state.weights,
    position: state.position,
    hideDrafted: state.hideDrafted,
    search: state.search,
    sortKey,
    sortDir: state.sortDir,
    rosterCounts: countRoster(state.myRoster),
    targets: rosterTargets(),
    enableNeed: !isFactor && state.enableNeed,
  });
}

function renderBoard() {
  renderSheetHeader();
  renderViewBanner();
  renderTeamRankPanel();

  const isFactor = state.boardMode === "factors" && isFactorView();
  let list = getRankedList();

  if (isFactor) {
    list = list.map((p, i) => ({ ...p, rank: i + 1 }));
  } else {
    // Summary: attach model rank, value vs ADP, tiers
    list = attachValueAndTiers(list, state.scoring);
  }

  const available = state.players.filter((p) => !p.drafted).length;
  const drafted = state.players.filter((p) => p.drafted).length;

  $("#statPlayers").textContent = String(list.length);
  $("#statAvailable").textContent = String(available);
  $("#statDrafted").textContent = String(drafted);
  $("#statScoring").textContent = state.scoring === "ppr" ? "1 PPR" : "0.5 PPR";
  $("#statView").textContent = viewLabel();

  let thead;
  let rows;

  if (isFactor) {
    const fk = state.view;
    const flabel = FACTOR_LABELS[fk];
    const unit = metricUnit(fk);
    thead = `
      <tr>
        <th data-sort="${fk}" class="${state.sortKey === fk || state.sortKey === "total" ? "sorted" : ""}">#</th>
        <th data-sort="name" class="${state.sortKey === "name" ? "sorted" : ""}">Player</th>
        <th>Pos</th>
        <th>Team</th>
        <th data-sort="adpRaw" class="${state.sortKey === "adpRaw" ? "sorted" : ""}">ADP</th>
        <th data-sort="fpts" class="${state.sortKey === "fpts" ? "sorted" : ""}">'25 FPts</th>
        <th data-sort="${fk}" class="factor-focus-col ${state.sortKey === fk || state.sortKey === "total" ? "sorted" : ""}">${flabel} (${unit})</th>
        <th data-sort="total">Model 0–100</th>
        <th></th>
      </tr>`;

    rows = list
      .map((p) => {
        const myId = state.myRoster.some((m) => m.id === p.id);
        const m = p.activeMetrics || p.activeScores || {};
        const formatted = formatMetric(fk, m, state.scoring);
        const pct = p.percentiles?.[fk] ?? 0;
        const teamExtra =
          fk === "playcaller"
            ? p.raw?.playcaller_name || ""
            : fk === "vegas"
              ? `${m.vegasYardsLabel || "Yds"} O/U · ${m.vegasTdLabel || "TDs"} O/U`
              : fk === "qb"
                ? m.qb != null
                  ? `Team QB ${m.qb}/32 (WR/TE)`
                  : "N/A for this position"
                : fk === "oline"
                  ? m.oline != null
                    ? `OL ${m.oline}/32 (RB/QB)`
                    : "N/A for this position"
                : fk === "sos"
                  ? `SOS ${m.sos}/32`
                  : fk === "opportunity"
                    ? `Role rank at ${p.pos}`
                    : fk === "efficiency"
                      ? "0–100 rating"
                      : fk === "injury"
                        ? "Games played profile"
                        : fk === "age"
                          ? `Fitness ${Math.round(m.ageFitness || 0)}/100`
                          : "";
        return `
        <tr class="${p.drafted ? "drafted" : ""} ${myId ? "my-pick" : ""}" data-id="${p.id}">
          <td>${p.rank}</td>
          <td>
            <div class="player-cell">
              <div>
                <div class="name">${p.name}${p.rookie ? ' <span style="color:var(--warn);font-size:0.7rem">R</span>' : ""}</div>
                <div class="meta">${teamExtra}</div>
              </div>
            </div>
          </td>
          <td><span class="pos-badge ${p.pos}">${p.pos}</span></td>
          <td class="score-cell">${p.team}</td>
          <td class="score-cell">${p.adp[state.scoring]}</td>
          <td class="score-cell">${(p.fpts_2025[state.scoring] ?? 0).toFixed(1)}</td>
          <td class="score-cell score-total factor-focus-col">
            <span class="score-bar" style="width:${barWidthPct(pct)}px"></span>
            ${formatted}
          </td>
          <td class="score-cell">${p.total.toFixed(1)}</td>
          <td>
            <button class="btn draft-btn" data-id="${p.id}" style="width:auto;padding:4px 8px;font-size:0.72rem" ${p.drafted ? "disabled" : ""}>
              ${p.drafted ? "Out" : "Draft"}
            </button>
          </td>
        </tr>`;
      })
      .join("");
  } else {
    // Flock-style draft sheet: Rank | Player | Team | Bye | ADP | Pos | Tier
    thead = `
      <tr>
        <th data-sort="total" class="${state.sortKey === "total" ? "sorted" : ""}">Rank</th>
        <th data-sort="name" class="${state.sortKey === "name" ? "sorted" : ""}">Player</th>
        <th>Team</th>
        <th>Bye</th>
        <th data-sort="adpRaw" class="${state.sortKey === "adpRaw" ? "sorted" : ""}">ADP</th>
        <th>Pos</th>
        <th>Tier</th>
        <th></th>
      </tr>`;

    const topIds = new Set(topRecommendations(list, 3).map((p) => p.id));

    rows = list
      .map((p) => {
        const myId = state.myRoster.some((m) => m.id === p.id);
        return `
        <tr class="sheet-row ${p.drafted ? "drafted" : ""} ${myId ? "my-pick" : ""} ${topIds.has(p.id) && !p.drafted ? "recommended" : ""}" data-id="${p.id}">
          <td class="rank-num">${p.rank}</td>
          <td>
            <div class="player-cell">
              <div class="name">${p.name}${p.rookie ? ' <span class="rookie-tag">R</span>' : ""}</div>
            </div>
          </td>
          <td class="team-cell">${p.team}</td>
          <td class="score-cell muted">${p.bye || "—"}</td>
          <td class="score-cell">${Number(p.adp[state.scoring]).toFixed(1)}</td>
          <td><span class="pos-badge ${p.pos}">${p.pos}</span></td>
          <td>${p.tier ? `<span class="${tierClass(p.tier)}">T${p.tier}</span>` : "—"}</td>
          <td>
            <button class="btn draft-btn" data-id="${p.id}" style="width:auto;padding:5px 10px;font-size:0.72rem" ${p.drafted ? "disabled" : ""}>
              ${p.drafted ? "Out" : "Draft"}
            </button>
          </td>
        </tr>`;
      })
      .join("");
  }

  $("#boardTable").innerHTML = `<thead>${thead}</thead><tbody>${rows || `<tr><td colspan="20" style="padding:24px;color:var(--text-muted)">No players match filters.</td></tr>`}</tbody>`;

  $$("#boardTable th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "name" || key === "adpRaw" ? "asc" : "desc";
      }
      renderBoard();
    });
  });

  $$("#boardTable tbody tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".draft-btn")) return;
      openPlayer(tr.dataset.id);
    });
  });

  $$("#boardTable .draft-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      manualDraft(btn.dataset.id, true);
    });
  });

  renderNeedMeter();
  renderOnClock();
  renderDraftLog();
  persistMyRoster();
}

function setRankingView(view) {
  state.view = view;
  if (view === "summary") {
    state.sortKey = "total";
    state.sortDir = "desc";
  } else {
    state.sortKey = view;
    state.sortDir = defaultSortDirForFactor(view);
  }
  $$("#rankTabs .rank-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === view)
  );
  renderBoard();
}

function openPlayer(id) {
  const p = state.players.find((x) => x.id === id);
  if (!p) return;
  state.selectedPlayer = p;
  const ranked = rankPlayers(state.players, {
    scoring: state.scoring,
    weights: state.weights,
    enableNeed: false,
  });
  const row = ranked.find((r) => r.id === p.id);
  const total = row?.total ?? 0;
  const m = p.metrics?.[state.scoring] || p.scores?.[state.scoring] || {};
  const pct = row?.percentiles || {};

  const factors = FACTOR_KEYS.map((k) => {
    const meta = state.meta?.factors?.find((f) => f.key === k);
    const label = meta?.label || FACTOR_LABELS[k];
    const unit = meta?.unit || metricUnit(k);
    const text = formatMetric(k, m, state.scoring);
    const bar = pct[k] ?? 0;
    return `
      <div class="factor-card">
        <div class="label">${label} <span style="opacity:0.7">(${unit})</span></div>
        <div class="num" style="font-size:1.15rem">${text}</div>
        <div class="bar"><div style="width:${bar}%"></div></div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px">model pct ${bar.toFixed(0)}</div>
      </div>`;
  }).join("");

  const enriched = { ...p, displayTotal: total, total, activeMetrics: m };
  const fc = floorCeiling(enriched);
  const cuff = findHandcuff(p, state.players);
  const stacks = stackMates(p, state.players);
  const adp = p.adp[state.scoring];
  const modelRank = row ? ranked.findIndex((r) => r.id === p.id) + 1 : "—";
  const value = typeof modelRank === "number" ? Math.round((adp - modelRank) * 10) / 10 : null;

  $("#modalBody").innerHTML = `
    <div class="modal-header">
      <div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <span class="pos-badge ${p.pos}">${p.pos}</span>
          <span style="color:var(--text-muted);font-size:0.85rem">${p.team_name || p.team}</span>
        </div>
        <h3>${p.name}</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-top:4px">
          Age ${p.age || "—"} · Bye ${p.bye} · ADP ${adp} · Model #${modelRank}
          ${value != null ? ` · vs ADP ${value > 0 ? "+" : ""}${value}` : ""}
          ${p.rookie ? " · Rookie" : ""}
          ${p.drafted ? " · <strong style='color:var(--danger)'>DRAFTED</strong>" : ""}
        </p>
      </div>
      <button class="modal-close" id="modalCloseBtn" aria-label="Close">×</button>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
      <div class="stat-pill">Model <strong>${total.toFixed(1)}</strong>/100</div>
      <div class="stat-pill">Floor–Ceiling <strong>${fc.floor}–${fc.ceiling}</strong></div>
      <div class="stat-pill">2025 FPts <strong>${(p.fpts_2025[state.scoring] ?? 0).toFixed(1)}</strong></div>
      <div class="stat-pill">Playcaller <strong>${m.playcaller != null ? p.raw.playcaller_name + " (" + m.playcaller + "/32)" : "N/A"}</strong></div>
      <div class="stat-pill">QB env <strong>${m.qb != null ? m.qb + "/32" : "N/A"}</strong></div>
      <div class="stat-pill">O-Line <strong>${m.oline != null ? m.oline + "/32" : "N/A"}</strong></div>
      <div class="stat-pill">Vegas <strong>${formatMetric("vegas", m, state.scoring)}</strong></div>
      ${cuff ? `<div class="stat-pill">Handcuff <strong>${cuff.name}</strong></div>` : ""}
      ${stacks.length ? `<div class="stat-pill">Stack <strong>${stacks.map((s) => s.name).join(", ")}</strong></div>` : ""}
    </div>
    <h2 style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:8px">Factor metrics (natural units)</h2>
    <div class="factor-grid">${factors}</div>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn btn-primary" id="modalDraftBtn" ${p.drafted ? "disabled" : ""}>${p.drafted ? "Already drafted" : "Mark drafted (mine)"}</button>
      <button class="btn" id="modalDraftOtherBtn" ${p.drafted ? "disabled" : ""}>Mark taken by league</button>
    </div>
  `;
  $("#modal").classList.add("open");
  $("#modalCloseBtn").onclick = closeModal;
  $("#modalDraftBtn").onclick = () => {
    manualDraft(p.id, true);
    closeModal();
  };
  $("#modalDraftOtherBtn").onclick = () => {
    manualDraft(p.id, false);
    closeModal();
  };
}

function closeModal() {
  $("#modal").classList.remove("open");
  state.selectedPlayer = null;
}

function manualDraft(id, isMine) {
  const p = state.players.find((x) => x.id === id);
  if (!p || p.drafted) return;
  p.drafted = true;
  p.draftedBy = isMine ? "me" : "other";
  p.pickNo = (state.picks[state.picks.length - 1]?.pickNo || 0) + 1;
  if (isMine && !state.myRoster.find((m) => m.id === p.id)) state.myRoster.push(p);
  state.picks.push({
    pickNo: p.pickNo,
    name: p.name,
    pos: p.pos,
    team: p.team,
    isMine,
    localId: p.id,
  });
  if (!state.draftSource) state.draftSource = "manual";
  persistMyRoster();
  renderBoard();
  toast(`${p.name} marked drafted${isMine ? " (your team)" : ""}`);
}

function resetDraft() {
  for (const p of state.players) {
    p.drafted = false;
    p.draftedBy = null;
    p.pickNo = null;
  }
  state.myRoster = [];
  state.picks = [];
  state.draftSource = null;
  persistMyRoster();
  if (state.poller) {
    state.poller.stop();
    state.poller = null;
  }
  setLiveStatus("idle");
  renderBoard();
  toast("Draft board reset");
}

function setLiveStatus(mode, text) {
  const dot = $("#liveDot");
  const label = $("#liveLabel");
  dot.className = "status-dot";
  if (mode === "live") {
    dot.classList.add("live");
    label.textContent = text || "Live polling";
  } else if (mode === "error") {
    dot.classList.add("error");
    label.textContent = text || "Error";
  } else {
    label.textContent = text || "Not connected";
  }
}

/* ---- Sleeper connect ---- */
async function connectSleeper() {
  const username = $("#sleeperUser").value.trim();
  const leagueId = $("#sleeperLeague").value.trim();
  const draftIdInput = $("#sleeperDraft").value.trim();
  if (!username && !draftIdInput && !leagueId) {
    toast("Enter Sleeper username, league ID, or draft ID", "err");
    return;
  }

  try {
    setLiveStatus("live", "Connecting…");
    let draftId = draftIdInput;
    let userId = null;

    if (username) {
      const user = await sleeperGetUser(username);
      userId = user.user_id;
      state.sleeper.userId = userId;
      state.sleeper.username = username;
      $("#sleeperUserInfo").textContent = `User: ${user.display_name || username} (${userId})`;

      if (!draftId && !leagueId) {
        const leagues = await sleeperGetLeagues(userId, "2026");
        if (!leagues.length) {
          // try 2025 fallback for testing
          const old = await sleeperGetLeagues(userId, "2025");
          if (old.length) {
            toast(`No 2026 leagues; found ${old.length} from 2025 — pick a league ID`, "err");
            $("#sleeperUserInfo").textContent += ` · ${old.map((l) => l.name + ":" + l.league_id).slice(0, 3).join(", ")}`;
          } else {
            toast("No leagues found for this user", "err");
          }
          setLiveStatus("error", "No leagues");
          return;
        }
        const list = leagues.map((l) => `${l.name} → league ${l.league_id}`).join("\n");
        $("#sleeperUserInfo").textContent += ` · Leagues: ${leagues.length}`;
        toast(`Found ${leagues.length} leagues — paste a league or draft ID`, "ok");
        console.log("Sleeper leagues:\n" + list);
        // Auto-pick first league draft if only one
        if (leagues.length === 1 && leagues[0].draft_id) {
          draftId = leagues[0].draft_id;
          $("#sleeperDraft").value = draftId;
          $("#sleeperLeague").value = leagues[0].league_id;
        } else {
          setLiveStatus("idle", "Select league/draft");
          return;
        }
      }
    }

    if (!draftId && leagueId) {
      const drafts = await sleeperGetLeagueDrafts(leagueId);
      if (!drafts.length) throw new Error("No drafts for league");
      draftId = drafts[0].draft_id;
      $("#sleeperDraft").value = draftId;
    }

    state.sleeper.draftId = draftId;
    toast("Hydrating Sleeper player IDs…");
    const hyd = await sleeperHydratePlayerIds(state.players);
    if (hyd.matched) toast(`Matched ${hyd.matched}/${hyd.total} players to Sleeper`);

    await refreshSleeperDraft();

    if (state.poller) state.poller.stop();
    state.poller = createDraftPoller(refreshSleeperDraft, 4000);
    state.poller.start();
    state.draftSource = "sleeper";
    setLiveStatus("live", `Sleeper draft ${draftId}`);
    toast("Sleeper live draft connected");
  } catch (e) {
    console.error(e);
    setLiveStatus("error", "Sleeper error");
    toast(String(e.message || e), "err");
  }
}

async function refreshSleeperDraft() {
  const draftId = state.sleeper.draftId || $("#sleeperDraft").value.trim();
  if (!draftId) return;
  const [draft, picks] = await Promise.all([sleeperGetDraft(draftId), sleeperGetPicks(draftId)]);
  const result = applySleeperPicks(state.players, picks, {
    userId: state.sleeper.userId,
    draftOrder: draft.draft_order,
    slotToRoster: draft.slot_to_roster_id,
  });
  state.myRoster = result.myRoster;
  state.picks = result.picks;
  state.draftSource = "sleeper";
  renderBoard();
  setLiveStatus("live", `Sleeper · ${picks.length} picks · ${draft.status}`);
}

/* ---- ESPN connect ---- */
async function connectEspn() {
  const leagueId = $("#espnLeague").value.trim();
  const teamId = $("#espnTeam").value.trim();
  const season = Number($("#espnSeason").value) || 2026;
  const useProxy = $("#espnProxy").checked;
  if (!leagueId) {
    toast("Enter ESPN league ID", "err");
    return;
  }
  try {
    setLiveStatus("live", "ESPN connecting…");
    state.espn.leagueId = leagueId;
    state.espn.teamId = teamId ? Number(teamId) : null;

    await refreshEspnDraft(season, useProxy);

    if (state.poller) state.poller.stop();
    state.poller = createDraftPoller(() => refreshEspnDraft(season, useProxy), 8000);
    state.poller.start();
    state.draftSource = "espn";
    toast("ESPN draft connected (polling)");
  } catch (e) {
    console.error(e);
    setLiveStatus("error", "ESPN error");
    toast(String(e.message || e), "err");
  }
}

async function refreshEspnDraft(season, useProxy) {
  const leagueId = state.espn.leagueId;
  const data = await espnFetchLeague({
    leagueId,
    season,
    useProxy,
  });
  const result = applyEspnDraft(state.players, data, { teamId: state.espn.teamId });
  state.myRoster = result.myRoster;
  state.picks = result.picks;
  renderBoard();
  setLiveStatus(
    "live",
    `ESPN · ${result.picks.length} picks${result.draftComplete ? " · complete" : ""}`
  );
}

function bindUI() {
  // Ranking view tabs (Summary + each factor)
  $$("#rankTabs .rank-tab").forEach((tab) => {
    tab.addEventListener("click", () => setRankingView(tab.dataset.view));
  });

  const stratSel = $("#strategySelect");
  if (stratSel) {
    stratSel.value = state.strategy;
    const applyStrat = () => {
      state.strategy = stratSel.value;
      const s = STRATEGIES[state.strategy];
      if ($("#strategyDesc") && s) $("#strategyDesc").textContent = s.desc;
      persistMyRoster();
      renderBoard();
    };
    stratSel.addEventListener("change", applyStrat);
    applyStrat();
  }
  const teamsEl = $("#leagueTeams");
  if (teamsEl) {
    teamsEl.value = String(state.leagueTeams);
    teamsEl.addEventListener("change", () => {
      state.leagueTeams = Number(teamsEl.value) || 12;
      persistMyRoster();
      renderBoard();
    });
  }
  const slotEl = $("#draftSlot");
  if (slotEl) {
    slotEl.value = String(state.draftSlot);
    slotEl.addEventListener("change", () => {
      state.draftSlot = Number(slotEl.value) || 1;
      persistMyRoster();
      renderBoard();
    });
  }
  syncRosterInputs();
  [
    "rosterQB",
    "rosterRB",
    "rosterWR",
    "rosterTE",
    "rosterFLEX",
    "rosterK",
    "rosterDST",
    "rosterBN",
  ].forEach((id) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.addEventListener("change", () => {
      readRosterInputs();
      persistMyRoster();
      renderBoard();
      toast(`Lineup: ${rosterLabel()}`);
    });
  });
  $$(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setBoardMode(btn.dataset.boardMode));
  });
  setBoardMode(state.boardMode);

  // Scoring
  $$(".scoring-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scoring = btn.dataset.scoring;
      $$(".scoring-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
      persistMyRoster();
      renderBoard();
    });
  });

  // Positions
  $$(".pos-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.position = chip.dataset.pos;
      $$(".pos-chips .chip").forEach((c) => c.classList.toggle("active", c === chip));
      renderBoard();
    });
  });

  $("#searchInput").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderBoard();
  });

  $("#hideDrafted").addEventListener("change", (e) => {
    state.hideDrafted = e.target.checked;
    renderBoard();
  });

  $("#enableNeed").addEventListener("change", (e) => {
    state.enableNeed = e.target.checked;
    renderBoard();
  });

  const resetBtn = $("#resetWeights");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => applyWeightPreset("balanced"));
  }

  $("#btnSleeper").addEventListener("click", connectSleeper);
  $("#btnEspn").addEventListener("click", connectEspn);
  $("#btnResetDraft").addEventListener("click", resetDraft);
  $("#btnStopPoll").addEventListener("click", () => {
    if (state.poller) state.poller.stop();
    setLiveStatus("idle", "Polling stopped");
    toast("Stopped live polling");
  });

  $("#manualName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const name = e.target.value.trim();
      if (!name) return;
      const isMine = $("#manualMine").checked;
      const local = markDraftedByName(state.players, name, isMine);
      if (!local) {
        toast(`No match for "${name}"`, "err");
        return;
      }
      // markDraftedByName only sets flags — sync roster/picks
      local.pickNo = (state.picks[state.picks.length - 1]?.pickNo || 0) + 1;
      if (isMine && !state.myRoster.find((m) => m.id === local.id)) {
        state.myRoster.push(local);
      }
      state.picks.push({
        pickNo: local.pickNo,
        name: local.name,
        pos: local.pos,
        team: local.team,
        isMine,
        localId: local.id,
      });
      if (!state.draftSource) state.draftSource = "manual";
      e.target.value = "";
      persistMyRoster();
      renderBoard();
      toast(`Drafted ${local.name}`);
    }
  });

  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

async function init() {
  try {
    loadLeaguePrefs();
    await loadData();
    // default scoring button
    $$(".scoring-toggle button").forEach((b) =>
      b.classList.toggle("active", b.dataset.scoring === state.scoring)
    );
    renderWeightPresets();
    renderWeights();
    bindUI();
    renderBoard();
    toast(`Loaded ${state.players.length} players · On-clock AI ready`);
  } catch (e) {
    console.error(e);
    toast("Failed to load data. Serve folder over HTTP (see README).", "err");
    $("#boardTable").innerHTML = `<tbody><tr><td style="padding:24px">Could not load ./data/*.json — open via a local server.</td></tr></tbody>`;
  }
}

init();
