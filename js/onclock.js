/**
 * On the Clock — connect-first live draft assistant.
 * One primary pick with reasons + 3 silent alternates + remaining board.
 */
import {
  presetById,
  rankPlayers,
  countRoster,
  WEIGHT_PRESETS,
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
  detectSleeperDraftSlot,
  detectSleeperTeamCount,
  detectEspnDraftSlot,
  detectEspnTeamCount,
  parseSleeperRosterSettings,
  parseEspnRosterSettings,
} from "./draft.js";
import {
  STRATEGIES,
  recommendPicks,
  attachValueAndTiers,
  estimatePickNumber,
} from "./decision.js";
import {
  writeDraftState,
  applyStoredDraftToPlayers,
  snapshotDrafted,
  onDraftUpdated,
} from "./draft-sync.js";
import { assignToSlots, renderSleeperRosterHtml } from "./roster-slots.js";

const state = {
  players: [],
  meta: null,
  teams: null,
  scoring: "ppr",
  weights: {},
  weightPreset: "balanced",
  strategy: "balanced",
  draftSlot: 1,
  leagueTeams: 12,
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  myRoster: [],
  picks: [],
  draftSource: null, // sleeper | espn | manual
  connected: false,
  poller: null,
  sleeper: { userId: null, username: null, draftId: null },
  espn: { leagueId: null, teamId: null },
  queue: [], // player ids — "I'd take" order; first available becomes primary
  soundOnTurn: false,
  _wasYourTurn: false,
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const DATA_FALLBACK =
  "https://raw.githubusercontent.com/ajmartineau25/fantasy-football-guide/main/data";

function toast(msg, type = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3200);
}

async function fetchJson(path) {
  try {
    const res = await fetch(`./data/${path}`);
    if (res.ok) return res.json();
  } catch (_) {}
  const res = await fetch(`${DATA_FALLBACK}/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function rosterTargets() {
  const r = state.roster || {};
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

/** Apply linked-league roster shape and sync left-panel inputs + right roster. */
function applyLinkedRosterSettings(roster, { source = "league" } = {}) {
  if (!roster) return false;
  state.roster = {
    QB: Number(roster.QB ?? state.roster.QB ?? 1),
    RB: Number(roster.RB ?? state.roster.RB ?? 2),
    WR: Number(roster.WR ?? state.roster.WR ?? 2),
    TE: Number(roster.TE ?? state.roster.TE ?? 1),
    FLEX: Number(roster.FLEX ?? state.roster.FLEX ?? 1),
    K: Number(roster.K ?? state.roster.K ?? 1),
    DST: Number(roster.DST ?? state.roster.DST ?? 1),
    BN: Number(roster.BN ?? state.roster.BN ?? 6),
  };
  if (roster.teams) {
    state.leagueTeams = Number(roster.teams) || state.leagueTeams;
    const teamsEl = $("#leagueTeams");
    if (teamsEl) teamsEl.value = String(state.leagueTeams);
  }
  syncRosterInputsFromState();
  const meta = $("#rosterPanelMeta");
  if (meta) {
    const t = state.roster;
    meta.textContent = `Linked ${source}: ${t.QB}QB ${t.RB}RB ${t.WR}WR ${t.TE}TE ${t.FLEX}FLEX · ${t.BN} BN`;
  }
  persistDraft();
  renderSleeperRoster();
  return true;
}

function syncRosterInputsFromState() {
  // On the Clock may not have roster number inputs — Rankings does.
  // Keep shared state; Rankings picks it up via ffg_draft / ffg_league.
  try {
    const league = JSON.parse(localStorage.getItem("ffg_league") || "{}");
    localStorage.setItem(
      "ffg_league",
      JSON.stringify({
        ...league,
        roster: state.roster,
        leagueTeams: state.leagueTeams,
      })
    );
  } catch (_) {}
}

function persistDraft() {
  // Drop drafted/queued ids that no longer exist or are taken
  state.queue = (state.queue || []).filter((id) => {
    const p = state.players.find((x) => x.id === id);
    return p && !p.drafted;
  });
  writeDraftState({
    source: state.draftSource,
    connected: state.connected,
    scoring: state.scoring,
    strategy: state.strategy,
    draftSlot: state.draftSlot,
    leagueTeams: state.leagueTeams,
    roster: state.roster,
    weightPreset: state.weightPreset,
    myRosterIds: state.myRoster.map((p) => p.id),
    drafted: snapshotDrafted(state.players, state.myRoster),
    picks: state.picks.slice(-80),
    sleeper: state.sleeper,
    espn: state.espn,
    queue: state.queue,
    soundOnTurn: state.soundOnTurn,
  });
}

function loadPrefs() {
  try {
    const league = JSON.parse(localStorage.getItem("ffg_league") || "{}");
    if (league.strategy) state.strategy = league.strategy;
    if (league.draftSlot) state.draftSlot = league.draftSlot;
    if (league.leagueTeams) state.leagueTeams = league.leagueTeams;
    if (league.scoring) state.scoring = league.scoring;
    if (league.roster) state.roster = { ...state.roster, ...league.roster };
    if (league.weightPreset) state.weightPreset = league.weightPreset;
  } catch (_) {}
}

function applyPendingDrafted() {
  const applied = applyStoredDraftToPlayers(state.players);
  state.draftSource = applied.source;
  state.connected = applied.connected;
  state.sleeper = { ...state.sleeper, ...applied.sleeper };
  state.espn = { ...state.espn, ...applied.espn };
  state.picks = applied.picks || [];
  state.myRoster = applied.myRoster || [];
  state.queue = applied.queue || [];
  state.soundOnTurn = !!applied.soundOnTurn;
}

function pruneQueue() {
  state.queue = (state.queue || []).filter((id) => {
    const p = state.players.find((x) => x.id === id);
    return p && !p.drafted;
  });
}

function addToQueue(id) {
  pruneQueue();
  if (state.queue.includes(id)) {
    toast("Already in your queue");
    return;
  }
  if (state.queue.length >= 5) {
    toast("Queue full (max 5) — remove one first", "err");
    return;
  }
  const p = state.players.find((x) => x.id === id);
  if (!p || p.drafted) {
    toast("Player not available", "err");
    return;
  }
  state.queue.push(id);
  toast(`Queued ${p.name}`);
  persistDraft();
  renderAll();
}

function removeFromQueue(id) {
  state.queue = state.queue.filter((x) => x !== id);
  persistDraft();
  renderAll();
}

function playTurnBeep() {
  if (!state.soundOnTurn) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 180);
  } catch (_) {}
}

function setLiveStatus(kind, label) {
  const dot = $("#liveDot");
  const lab = $("#liveLabel");
  if (dot) dot.className = `status-dot ${kind || ""}`;
  if (lab) lab.textContent = label;
}

function setConnected(source, label) {
  state.connected = true;
  state.draftSource = source;
  setLiveStatus("live", label);
  $("#ocGate")?.classList.add("hidden");
  $("#ocRoom")?.classList.remove("hidden");
  const manual = $("#manualName");
  if (manual) manual.disabled = false;
  persistDraft();
  renderAll();
}

/** Prompt user once to confirm auto-detected draft slot. */
function proposeDraftSlot(slot, { teams = null, source = "" } = {}) {
  const n = Number(slot);
  if (!Number.isFinite(n) || n < 1) return;
  state._pendingSlot = n;
  if (teams) {
    state.leagueTeams = teams;
    const el = $("#leagueTeams");
    if (el) el.value = String(teams);
  }
  const box = $("#slotConfirm");
  if (!box) {
    state.draftSlot = n;
    const slotEl = $("#draftSlot");
    if (slotEl) slotEl.value = String(n);
    return;
  }
  $("#detectedSlotNum").textContent = String(n);
  $("#detectedSlotPick").textContent = String(n);
  box.classList.remove("hidden");
  const status = $("#slotStatus");
  if (status) {
    status.textContent = `Detected from ${source || "league"} — confirm to lock your pick countdown.`;
  }
}

function confirmDraftSlot() {
  const n = Number(state._pendingSlot) || Number($("#draftSlot")?.value) || 1;
  state.draftSlot = n;
  const slotEl = $("#draftSlot");
  if (slotEl) slotEl.value = String(n);
  $("#slotConfirm")?.classList.add("hidden");
  const status = $("#slotStatus");
  if (status) status.textContent = `Locked: you’re slot ${n} (R1 pick #${n}). Change anytime above.`;
  persistDraft();
  renderAll();
  toast(`You’re draft slot ${n}`);
}

function applyRankingPreset(id, { silent = false, fromStrategy = false } = {}) {
  const preset = presetById(id);
  state.weightPreset = preset.id;
  state.weights = { ...preset.weights };
  renderOcPresets();
  if (!silent) {
    toast(
      fromStrategy
        ? `Strategy set ranking style → ${preset.label}`
        : `Ranking style: ${preset.label}`
    );
  }
  persistDraft();
  renderAll();
}

function renderOcPresets() {
  const box = $("#ocWeightPresets");
  if (!box) return;
  box.innerHTML = WEIGHT_PRESETS.map((p) => {
    const active = state.weightPreset === p.id ? "active" : "";
    return `<button type="button" class="preset-chip ${active}" data-preset="${p.id}" title="${p.desc}">${p.label}</button>`;
  }).join("");
  const desc = $("#ocPresetDesc");
  if (desc) desc.textContent = presetById(state.weightPreset).desc;
  box.querySelectorAll(".preset-chip").forEach((btn) => {
    btn.addEventListener("click", () => applyRankingPreset(btn.dataset.preset));
  });
}

function strategyHelpHtml(strat) {
  const rounds = strat.bestRounds ? `<div class="oc-strat-rounds"><strong>Best rounds:</strong> ${strat.bestRounds}</div>` : "";
  const guide = strat.roundGuide ? `<div class="help-text" style="margin-top:4px">${strat.roundGuide}</div>` : "";
  return `${strat.desc}${rounds}${guide}`;
}

function applyStrategy(id, { syncPreset = true } = {}) {
  const key = STRATEGIES[id] ? id : "balanced";
  const strat = STRATEGIES[key];
  state.strategy = key;
  const sel = $("#strategySelect");
  if (sel) sel.value = key;
  const desc = $("#strategyDesc");
  if (desc) desc.innerHTML = strategyHelpHtml(strat);
  if (syncPreset && strat.suggestedPreset) {
    applyRankingPreset(strat.suggestedPreset, { fromStrategy: true });
  } else {
    persistDraft();
    renderAll();
  }
}

function picksUntilYou() {
  const totalPicks = state.players.filter((p) => p.drafted).length;
  const teams = state.leagueTeams;
  const slot = state.draftSlot;
  // Next overall pick number (1-based) that will be made
  const nextOverall = totalPicks + 1;
  // Find next pick that belongs to our slot in snake
  for (let overall = nextOverall; overall <= teams * 20; overall++) {
    const round = Math.ceil(overall / teams);
    const posInRound = ((overall - 1) % teams) + 1;
    const ownerSlot = round % 2 === 1 ? posInRound : teams - posInRound + 1;
    if (ownerSlot === slot) {
      return { until: overall - nextOverall, overall, round, yourTurn: overall === nextOverall };
    }
  }
  return { until: 0, overall: nextOverall, round: 1, yourTurn: true };
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
      return `<div class="need-item ${need}">
        <div class="pos">${pos}</div>
        <div class="fill"><div style="width:${pct}%"></div></div>
        <div class="count">${have}/${want}</div>
      </div>`;
    })
    .join("");

  // chips for empty holes
  const holes = order.filter((pos) => (counts[pos] || 0) === 0 && pos !== "K" && pos !== "DST");
  $("#ocNeedChips").innerHTML = holes.length
    ? holes.map((p) => `<span class="oc-chip need">Need ${p}</span>`).join("")
    : `<span class="oc-chip ok">Starters covered</span>`;

  renderSleeperRoster();
}

function renderSleeperRoster() {
  const el = $("#sleeperRoster");
  if (!el) return;
  const slots = assignToSlots(state.myRoster, rosterTargets(), state.scoring);
  el.innerHTML = renderSleeperRosterHtml(slots);
  const meta = $("#rosterPanelMeta");
  if (meta) {
    const filled = slots.filter((s) => s.player).length;
    const starters = slots.filter((s) => s.starter && s.player).length;
    const starterSlots = slots.filter((s) => s.starter).length;
    meta.textContent = `${filled} drafted · ${starters}/${starterSlots} starters`;
  }
}

function renderTurnBar() {
  if (!state.connected) return;
  const info = picksUntilYou();
  const drafted = state.players.filter((p) => p.drafted).length;
  const bar = $("#ocTurnBar");
  if (info.yourTurn) {
    $("#ocTurnLabel").textContent = "You're on the clock";
    $("#ocTurnLabel").className = "oc-turn-label hot";
    bar?.classList.add("your-turn");
    document.body.classList.add("oc-your-turn");
    if (!state._wasYourTurn) {
      playTurnBeep();
      toast("You're on the clock");
    }
  } else {
    $("#ocTurnLabel").textContent =
      info.until === 1 ? "You're up in 1 pick" : `You're up in ${info.until} picks`;
    $("#ocTurnLabel").className = "oc-turn-label";
    bar?.classList.remove("your-turn");
    document.body.classList.remove("oc-your-turn");
  }
  state._wasYourTurn = !!info.yourTurn;
  $("#ocTurnMeta").textContent = `Round ~${info.round} · overall pick ${info.overall} · ${drafted} drafted · ${state.strategy.replace("_", " ")}`;
}

/**
 * Primary = first undrafted queue player if any, else model BPA #1.
 * Alts = remaining queue + model fills to 3 (no duplicate).
 */
function buildPickStack() {
  pruneQueue();
  const pickNo = estimatePickNumber(
    state.draftSlot,
    state.leagueTeams,
    state.myRoster.length,
    state.leagueTeams * 15
  );
  const { picks } = recommendPicks(state.players, {
    scoring: state.scoring,
    weights: state.weights,
    targets: rosterTargets(),
    myRoster: state.myRoster,
    strategy: state.strategy,
    pickNumber: pickNo,
    limit: 40,
  });
  const byId = new Map(picks.map((p) => [p.id, p]));
  // Enrich queue players with full recommend data when possible
  const queuePlayers = state.queue
    .map((id) => {
      if (byId.has(id)) return { ...byId.get(id), fromQueue: true };
      const raw = state.players.find((p) => p.id === id && !p.drafted);
      if (!raw) return null;
      return {
        ...raw,
        fromQueue: true,
        modelRank: "—",
        adpRaw: raw.adp?.[state.scoring],
        reasons: [
          "Pinned in your queue — promoted after higher picks were taken",
          `Still available · ADP ${raw.adp?.[state.scoring] ?? "—"}`,
        ],
        risks: [],
      };
    })
    .filter(Boolean);

  let primary = null;
  let fromQueue = false;
  if (queuePlayers.length) {
    primary = queuePlayers[0];
    fromQueue = true;
  } else if (picks[0]) {
    primary = picks[0];
  }

  const used = new Set(primary ? [primary.id] : []);
  const alts = [];
  for (const p of queuePlayers.slice(1)) {
    if (used.has(p.id)) continue;
    alts.push(p);
    used.add(p.id);
    if (alts.length >= 3) break;
  }
  for (const p of picks) {
    if (used.has(p.id)) continue;
    alts.push(p);
    used.add(p.id);
    if (alts.length >= 3) break;
  }
  return { primary, alts, fromQueue, modelPicks: picks };
}

function renderQueue() {
  const box = $("#ocQueue");
  if (!box) return;
  pruneQueue();
  if (!state.queue.length) {
    box.innerHTML = `<p class="help-text">Pin backups with <strong>I'd take</strong> on alternates or the board. If your #1 gets sniped, the next queued player becomes the hero instantly.</p>`;
    return;
  }
  box.innerHTML = state.queue
    .map((id, i) => {
      const p = state.players.find((x) => x.id === id);
      if (!p) return "";
      return `<div class="oc-queue-item" data-id="${id}">
        <span class="oc-alt-n">${i + 1}</span>
        <span class="pos-badge ${p.pos}">${p.pos}</span>
        <span class="oc-alt-name">${p.name}</span>
        <span class="oc-alt-meta">${p.team}</span>
        <button type="button" class="btn oc-q-remove" data-id="${id}" title="Remove">×</button>
      </div>`;
    })
    .join("");
  $$("#ocQueue .oc-q-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromQueue(btn.dataset.id);
    });
  });
}

function renderSuggestions() {
  if (!state.connected) return;

  const { primary, alts, fromQueue } = buildPickStack();
  const hero = $("#ocHero");
  renderQueue();

  if (!primary) {
    hero.innerHTML = `<p class="help-text">No players left on the board.</p>`;
    $("#ocAlts").innerHTML = "";
    return;
  }

  const reasons = primary.reasons?.length
    ? primary.reasons
    : fromQueue
      ? ["Next in your queue after the previous pick was taken"]
      : [];

  hero.innerHTML = `
    <div class="oc-hero-kicker">${fromQueue ? "From your queue" : "Recommended pick"}</div>
    <div class="oc-hero-top">
      <span class="pos-badge ${primary.pos}">${primary.pos}</span>
      <div>
        <div class="oc-hero-name">${primary.name}</div>
        <div class="oc-hero-meta">${primary.team} · Bye ${primary.bye || "—"} · ADP ${primary.adpRaw ?? primary.adp?.[state.scoring] ?? "—"} · Model #${primary.modelRank ?? "—"}</div>
      </div>
    </div>
    <ul class="oc-reasons">
      ${reasons.map((r) => `<li>${r}</li>`).join("")}
    </ul>
    ${(primary.risks || []).length ? `<div class="oc-risks"><strong>Watch:</strong> ${primary.risks.join(" · ")}</div>` : ""}
    <div class="btn-row" style="margin-top:14px">
      <button type="button" class="btn btn-primary oc-draft-primary" data-id="${primary.id}">Draft ${primary.name.split(" ").pop()}</button>
      ${fromQueue ? "" : `<button type="button" class="btn oc-queue-primary" data-id="${primary.id}">I'd take (queue)</button>`}
    </div>
  `;
  hero.querySelector(".oc-draft-primary")?.addEventListener("click", () => {
    takePick(primary.id, true);
  });
  hero.querySelector(".oc-queue-primary")?.addEventListener("click", () => {
    addToQueue(primary.id);
  });

  $("#ocAlts").innerHTML = alts
    .map(
      (p, i) => `
    <div class="oc-alt-row">
      <button type="button" class="oc-alt" data-id="${p.id}" data-action="draft">
        <span class="oc-alt-n">${i + 2}</span>
        <span class="pos-badge ${p.pos}">${p.pos}</span>
        <span class="oc-alt-name">${p.name}${p.fromQueue ? ' <em class="oc-q-tag">Q</em>' : ""}</span>
        <span class="oc-alt-meta">${p.team} · ADP ${p.adpRaw ?? p.adp?.[state.scoring] ?? "—"}</span>
      </button>
      <button type="button" class="btn oc-id-take" data-id="${p.id}" title="Add to queue">I'd take</button>
    </div>`
    )
    .join("") || `<p class="help-text">No alternates</p>`;

  $$("#ocAlts .oc-alt").forEach((btn) => {
    btn.addEventListener("click", () => takePick(btn.dataset.id, true));
  });
  $$("#ocAlts .oc-id-take").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToQueue(btn.dataset.id);
    });
  });
}

function renderGoneBefore() {
  if (!state.connected) return;
  const info = picksUntilYou();
  const cutoff = info.overall; // ADP at or before your next pick
  const avail = state.players
    .filter((p) => !p.drafted)
    .map((p) => ({ ...p, adpN: Number(p.adp?.[state.scoring] ?? 999) }))
    .filter((p) => p.adpN <= cutoff + 0.5)
    .sort((a, b) => a.adpN - b.adpN)
    .slice(0, 8);

  $("#ocGoneMeta").textContent = `ADP ≤ ~${cutoff} (before/at your next pick #${info.overall})`;
  $("#ocGone").innerHTML = avail.length
    ? avail
        .map(
          (p) =>
            `<span class="oc-gone-chip"><span class="pos-badge ${p.pos}">${p.pos}</span> ${p.name} <em>${p.adpN.toFixed(1)}</em></span>`
        )
        .join("")
    : `<span class="help-text">Quiet stretch — few consensus names before you</span>`;
}

function renderRemainingBoard() {
  if (!state.connected) return;
  let list = rankPlayers(state.players, {
    scoring: state.scoring,
    weights: state.weights,
    hideDrafted: true,
    enableNeed: false,
    enableVorp: true,
    vorpBlend: 0.5,
    targets: rosterTargets(),
  });
  list = attachValueAndTiers(list, state.scoring).filter((p) => !p.drafted);

  $("#ocBoardMeta").textContent = `${list.length} available · live`;
  const rows = list
    .slice(0, 80)
    .map(
      (p, i) => `
    <tr data-id="${p.id}">
      <td class="rank-num">${i + 1}</td>
      <td><div class="name">${p.name}${p.rookie ? ' <span class="rookie-tag">R</span>' : ""}</div></td>
      <td class="team-cell">${p.team}</td>
      <td class="score-cell muted">${p.bye || "—"}</td>
      <td class="score-cell">${Number(p.adp[state.scoring]).toFixed(1)}</td>
      <td><span class="pos-badge ${p.pos}">${p.pos}</span></td>
      <td>${p.tier ? `<span class="tier-pill t${Math.min(8, p.tier)}">T${p.tier}</span>` : "—"}</td>
      <td><button type="button" class="btn oc-board-queue" data-id="${p.id}" style="padding:4px 8px;font-size:0.7rem">I'd take</button></td>
    </tr>`
    )
    .join("");

  $("#ocBoardTable").innerHTML = `
    <thead><tr>
      <th>Rank</th><th>Player</th><th>Team</th><th>Bye</th><th>ADP</th><th>Pos</th><th>Tier</th><th></th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="8" style="padding:16px;color:var(--text-muted)">Board empty</td></tr>`}</tbody>`;

  $$("#ocBoardTable .oc-board-queue").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToQueue(btn.dataset.id);
    });
  });
}

function renderAll() {
  if (!state.connected) {
    $("#ocGate")?.classList.remove("hidden");
    $("#ocRoom")?.classList.add("hidden");
    setLiveStatus("", "Not connected — connect to unlock picks");
    renderSleeperRoster();
    return;
  }
  $("#ocGate")?.classList.add("hidden");
  $("#ocRoom")?.classList.remove("hidden");
  renderNeedMeter();
  renderTurnBar();
  renderSuggestions();
  renderGoneBefore();
  renderRemainingBoard();
  renderSleeperRoster();
  persistDraft();
}

function takePick(id, isMine) {
  const p = state.players.find((x) => x.id === id);
  if (!p || p.drafted) return;
  p.drafted = true;
  const pickNo = state.players.filter((x) => x.drafted).length;
  p.pickNo = pickNo;
  if (isMine && !state.myRoster.some((m) => m.id === id)) state.myRoster.push(p);
  state.queue = state.queue.filter((q) => q !== id);
  state.picks.push({
    pickNo,
    name: p.name,
    pos: p.pos,
    team: p.team,
    isMine: !!isMine,
    id: p.id,
  });
  toast(isMine ? `You drafted ${p.name}` : `${p.name} drafted`);
  renderAll();
}

async function connectSleeper() {
  try {
    const username = $("#sleeperUser").value.trim();
    let draftId = $("#sleeperDraft").value.trim();
    const leagueId = $("#sleeperLeague").value.trim();
    if (!username && !draftId && !leagueId) {
      toast("Enter username, league ID, or draft ID", "err");
      return;
    }
    setLiveStatus("live", "Connecting Sleeper…");
    let userId = null;
    if (username) {
      const user = await sleeperGetUser(username);
      userId = user.user_id;
      state.sleeper.username = username;
      state.sleeper.userId = userId;
    }
    let resolvedLeagueId = leagueId || null;
    if (!draftId && leagueId) {
      const drafts = await sleeperGetLeagueDrafts(leagueId);
      draftId = drafts?.[0]?.draft_id;
    }
    if (!draftId && userId) {
      const leagues = await sleeperGetLeagues(userId, "2026");
      if (leagues?.[0]) {
        resolvedLeagueId = leagues[0].league_id;
        const drafts = await sleeperGetLeagueDrafts(resolvedLeagueId);
        draftId = drafts?.[0]?.draft_id;
      }
    }
    if (!draftId) throw new Error("Could not resolve a draft ID");
    state.sleeper.draftId = draftId;
    await sleeperHydratePlayerIds(state.players);
    const draft = await sleeperGetDraft(draftId);
    if (!resolvedLeagueId && draft?.league_id) resolvedLeagueId = draft.league_id;

    // Roster slots from draft settings, fallback to league object
    let rosterCfg = parseSleeperRosterSettings(draft);
    if ((!rosterCfg || rosterCfg.BN == null) && resolvedLeagueId) {
      try {
        const league = await sleeperGetLeague(resolvedLeagueId);
        rosterCfg = parseSleeperRosterSettings(league) || rosterCfg;
      } catch (_) {}
    }
    if (rosterCfg) applyLinkedRosterSettings(rosterCfg, { source: "Sleeper" });

    const picks = await sleeperGetPicks(draftId);
    const applied = applySleeperPicks(state.players, picks, {
      userId: state.sleeper.userId,
      draftOrder: draft.draft_order,
      slotToRoster: draft.slot_to_roster_id,
    });
    state.myRoster = applied.myRoster || [];
    state.picks = applied.picks || [];

    const slot = detectSleeperDraftSlot(draft, state.sleeper.userId);
    const teams = detectSleeperTeamCount(draft) || rosterCfg?.teams;
    if (slot) proposeDraftSlot(slot, { teams, source: "Sleeper" });

    let lastPickCount = (applied.picks || []).length;
    if (state.poller) state.poller.stop();
    state.poller = createDraftPoller(async () => {
      const fresh = await sleeperGetPicks(draftId);
      const again = applySleeperPicks(state.players, fresh, {
        userId: state.sleeper.userId,
        draftOrder: draft.draft_order,
        slotToRoster: draft.slot_to_roster_id,
      });
      state.myRoster = again.myRoster || [];
      state.picks = again.picks || [];
      const n = (again.picks || []).length;
      const matched = again.draftedIds?.size ?? 0;
      setLiveStatus("live", `Sleeper live · ${n} picks · ${matched} matched`);
      if (n > lastPickCount) {
        const newest = again.picks[again.picks.length - 1];
        toast(`Pick ${newest?.pickNo ?? n}: ${newest?.name || "player"}`);
        lastPickCount = n;
      }
      renderAll();
    }, 2500);

    setConnected("sleeper", `Sleeper live · ${lastPickCount} picks · draft ${draftId}`);
    const rosterNote = rosterCfg
      ? ` · ${rosterCfg.RB}RB/${rosterCfg.WR}WR/${rosterCfg.FLEX}FLEX`
      : "";
    toast(
      slot
        ? `Sleeper connected · slot ${slot}${rosterNote}`
        : `Sleeper connected${rosterNote}`
    );
  } catch (e) {
    console.error(e);
    setLiveStatus("error", e.message || "Sleeper failed");
    toast(e.message || "Sleeper connect failed", "err");
  }
}

async function connectEspn() {
  try {
    const leagueId = $("#espnLeague").value.trim();
    if (!leagueId) {
      toast("Enter ESPN league ID", "err");
      return;
    }
    const teamId = Number($("#espnTeam").value) || null;
    const season = Number($("#espnSeason").value) || 2026;
    const useProxy = $("#espnProxy").checked;
    setLiveStatus("live", "Connecting ESPN…");
    const json = await espnFetchLeague({ leagueId, season, useProxy });
    const rosterCfg = parseEspnRosterSettings(json);
    if (rosterCfg) applyLinkedRosterSettings(rosterCfg, { source: "ESPN" });
    const applied = applyEspnDraft(state.players, json, { teamId });
    state.myRoster = applied.myRoster || [];
    state.picks = applied.picks || [];
    state.espn = { leagueId, teamId };
    const slot = detectEspnDraftSlot(json, teamId);
    const teams = detectEspnTeamCount(json) || rosterCfg?.teams;
    if (slot) proposeDraftSlot(slot, { teams, source: "ESPN" });
    let lastPickCount = (applied.picks || []).length;
    if (state.poller) state.poller.stop();
    state.poller = createDraftPoller(async () => {
      const fresh = await espnFetchLeague({ leagueId, season, useProxy });
      const again = applyEspnDraft(state.players, fresh, { teamId });
      state.myRoster = again.myRoster || [];
      state.picks = again.picks || [];
      const n = (again.picks || []).length;
      setLiveStatus("live", `ESPN live · ${n} picks`);
      if (n > lastPickCount) {
        const newest = again.picks[again.picks.length - 1];
        toast(`Pick ${newest?.pickNo ?? n}: ${newest?.name || "player"}`);
        lastPickCount = n;
      }
      renderAll();
    }, 3000);
    setConnected("espn", `ESPN live · ${lastPickCount} picks · league ${leagueId}`);
    const rosterNote = rosterCfg
      ? ` · ${rosterCfg.RB}RB/${rosterCfg.WR}WR/${rosterCfg.FLEX}FLEX`
      : "";
    toast(slot ? `ESPN connected · slot ${slot}${rosterNote}` : `ESPN connected${rosterNote}`);
  } catch (e) {
    console.error(e);
    setLiveStatus("error", e.message || "ESPN failed");
    toast(e.message || "ESPN connect failed", "err");
  }
}

function connectManual() {
  setConnected("manual", "Manual draft · type picks as they happen");
  toast("Manual draft started — mark picks on the left");
}

function resetDraft() {
  if (state.poller) state.poller.stop();
  state.poller = null;
  state.connected = false;
  state.draftSource = null;
  state.myRoster = [];
  state.picks = [];
  state.queue = [];
  state._wasYourTurn = false;
  document.body.classList.remove("oc-your-turn");
  for (const p of state.players) {
    p.drafted = false;
    delete p._isMine;
  }
  persistDraft();
  renderAll();
  toast("Draft reset");
}

function bindUI() {
  $$(".tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
      ["sleeper", "espn", "manual"].forEach((id) => {
        const el = $(`#tab-${id}`);
        if (el) el.classList.toggle("hidden", tab.dataset.tab !== id);
      });
    });
  });

  $$(".scoring-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scoring = btn.dataset.scoring;
      $$(".scoring-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
    });
  });

  $("#leagueTeams").value = String(state.leagueTeams);
  $("#leagueTeams").addEventListener("change", (e) => {
    state.leagueTeams = Number(e.target.value) || 12;
    renderAll();
  });
  $("#draftSlot").value = String(state.draftSlot);
  $("#draftSlot").addEventListener("change", (e) => {
    state.draftSlot = Number(e.target.value) || 1;
    $("#slotConfirm")?.classList.add("hidden");
    const status = $("#slotStatus");
    if (status) status.textContent = `Manual slot ${state.draftSlot}.`;
    persistDraft();
    renderAll();
  });
  $("#btnConfirmSlot")?.addEventListener("click", confirmDraftSlot);
  $("#btnDismissSlot")?.addEventListener("click", () => {
    $("#slotConfirm")?.classList.add("hidden");
    $("#draftSlot")?.focus();
    const status = $("#slotStatus");
    if (status) status.textContent = "Adjust slot manually above.";
  });

  // Rebuild strategy options from STRATEGIES (keeps HTML in sync)
  const strat = $("#strategySelect");
  if (strat) {
    strat.innerHTML = Object.entries(STRATEGIES)
      .map(([id, s]) => `<option value="${id}">${s.label}</option>`)
      .join("");
    strat.value = state.strategy in STRATEGIES ? state.strategy : "balanced";
    strat.addEventListener("change", () => applyStrategy(strat.value, { syncPreset: true }));
  }
  if ($("#strategyDesc") && STRATEGIES[state.strategy]) {
    $("#strategyDesc").innerHTML = strategyHelpHtml(STRATEGIES[state.strategy]);
  }
  renderOcPresets();

  const soundEl = $("#soundOnTurn");
  if (soundEl) {
    soundEl.checked = !!state.soundOnTurn;
    soundEl.addEventListener("change", () => {
      state.soundOnTurn = soundEl.checked;
      persistDraft();
      toast(state.soundOnTurn ? "Turn sound on" : "Turn sound off");
    });
  }

  $("#btnSleeper").addEventListener("click", connectSleeper);
  $("#btnEspn").addEventListener("click", connectEspn);
  $("#btnManualConnect").addEventListener("click", connectManual);
  $("#btnStopPoll").addEventListener("click", () => {
    if (state.poller) state.poller.stop();
    setLiveStatus("idle", "Polling stopped");
  });
  $("#btnResetDraft").addEventListener("click", resetDraft);

  $("#manualName").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!state.connected) {
      toast("Connect Manual (or Sleeper/ESPN) first", "err");
      return;
    }
    const name = e.target.value.trim();
    if (!name) return;
    const isMine = $("#manualMine").checked;
    const hit = markDraftedByName(state.players, name, isMine);
    if (!hit) {
      toast(`No match for “${name}”`, "err");
      return;
    }
    if (isMine && !state.myRoster.some((m) => m.id === hit.id)) state.myRoster.push(hit);
    state.picks.push({
      pickNo: state.players.filter((p) => p.drafted).length,
      name: hit.name,
      pos: hit.pos,
      team: hit.team,
      isMine,
      id: hit.id,
    });
    e.target.value = "";
    toast(`${isMine ? "You drafted" : "Marked"} ${hit.name}`);
    renderAll();
  });

  // scoring button active state
  $$(".scoring-toggle button").forEach((b) =>
    b.classList.toggle("active", b.dataset.scoring === state.scoring)
  );
}

async function init() {
  try {
    loadPrefs();
    const [players, meta, teams] = await Promise.all([
      fetchJson("players.json"),
      fetchJson("meta.json"),
      fetchJson("teams.json"),
    ]);
    state.players = players;
    state.meta = meta;
    state.teams = teams;
    const preset = presetById(state.weightPreset || "balanced");
    state.weights = { ...preset.weights };
    applyPendingDrafted();
    bindUI();
    if (state.connected && state.draftSource) {
      $("#ocGate")?.classList.add("hidden");
      $("#ocRoom")?.classList.remove("hidden");
      setLiveStatus("live", `Restored ${state.draftSource} session`);
      // Re-enable manual input if needed
      if (state.draftSource === "manual") {
        const m = $("#manualName");
        if (m) m.disabled = false;
      }
    }
    renderAll();
    toast(state.connected ? "Draft room restored" : "Connect a draft to unlock picks");
  } catch (e) {
    console.error(e);
    toast("Failed to load player data", "err");
  }
}

init();
