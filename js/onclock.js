/**
 * On the Clock — connect-first live draft assistant.
 * One primary pick with reasons + 3 silent alternates + remaining board.
 */
import {
  presetById,
  rankPlayers,
  countRoster,
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
  estimatePickNumber,
} from "./decision.js";

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

function persistDraft() {
  try {
    localStorage.setItem(
      "ffg_draft",
      JSON.stringify({
        source: state.draftSource,
        connected: state.connected,
        scoring: state.scoring,
        strategy: state.strategy,
        draftSlot: state.draftSlot,
        leagueTeams: state.leagueTeams,
        roster: state.roster,
        weightPreset: state.weightPreset,
        myRosterIds: state.myRoster.map((p) => p.id),
        drafted: state.players
          .filter((p) => p.drafted)
          .map((p) => ({ id: p.id, isMine: state.myRoster.some((m) => m.id === p.id) })),
        picks: state.picks.slice(-80),
        sleeper: state.sleeper,
        espn: state.espn,
      })
    );
  } catch (_) {}
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

    const draft = JSON.parse(localStorage.getItem("ffg_draft") || "{}");
    if (draft.source) state.draftSource = draft.source;
    if (draft.connected) state.connected = !!draft.connected;
    if (draft.sleeper) state.sleeper = { ...state.sleeper, ...draft.sleeper };
    if (draft.espn) state.espn = { ...state.espn, ...draft.espn };
    if (Array.isArray(draft.picks)) state.picks = draft.picks;
    state._pendingDrafted = draft.drafted || [];
    state._pendingMyIds = draft.myRosterIds || [];
  } catch (_) {}
}

function applyPendingDrafted() {
  const drafted = state._pendingDrafted || [];
  const myIds = new Set(state._pendingMyIds || []);
  for (const row of drafted) {
    const p = state.players.find((x) => x.id === row.id);
    if (!p) continue;
    p.drafted = true;
    if (row.isMine || myIds.has(p.id)) {
      if (!state.myRoster.some((m) => m.id === p.id)) state.myRoster.push(p);
    }
  }
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

  $("#myRosterList").innerHTML =
    state.myRoster
      .map(
        (p) =>
          `<div class="rec-item"><span class="pos-badge ${p.pos}">${p.pos}</span><div><strong>${p.name}</strong><div class="meta" style="color:var(--text-muted);font-size:0.72rem">${p.team}</div></div></div>`
      )
      .join("") || `<p class="help-text">No picks yet</p>`;

  // chips for empty holes
  const holes = order.filter((pos) => (counts[pos] || 0) === 0 && pos !== "K" && pos !== "DST");
  $("#ocNeedChips").innerHTML = holes.length
    ? holes.map((p) => `<span class="oc-chip need">Need ${p}</span>`).join("")
    : `<span class="oc-chip ok">Starters covered</span>`;
}

function renderTurnBar() {
  if (!state.connected) return;
  const info = picksUntilYou();
  const drafted = state.players.filter((p) => p.drafted).length;
  if (info.yourTurn) {
    $("#ocTurnLabel").textContent = "You're on the clock";
    $("#ocTurnLabel").className = "oc-turn-label hot";
  } else {
    $("#ocTurnLabel").textContent =
      info.until === 1 ? "You're up in 1 pick" : `You're up in ${info.until} picks`;
    $("#ocTurnLabel").className = "oc-turn-label";
  }
  $("#ocTurnMeta").textContent = `Round ~${info.round} · overall pick ${info.overall} · ${drafted} drafted · ${state.strategy.replace("_", " ")}`;
}

function renderSuggestions() {
  if (!state.connected) return;

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
    limit: 4,
  });

  const primary = picks[0];
  const alts = picks.slice(1, 4);
  const hero = $("#ocHero");

  if (!primary) {
    hero.innerHTML = `<p class="help-text">No players left on the board.</p>`;
    $("#ocAlts").innerHTML = "";
    return;
  }

  hero.innerHTML = `
    <div class="oc-hero-kicker">Recommended pick</div>
    <div class="oc-hero-top">
      <span class="pos-badge ${primary.pos}">${primary.pos}</span>
      <div>
        <div class="oc-hero-name">${primary.name}</div>
        <div class="oc-hero-meta">${primary.team} · Bye ${primary.bye || "—"} · ADP ${primary.adpRaw ?? primary.adp?.[state.scoring] ?? "—"} · Model #${primary.modelRank}</div>
      </div>
    </div>
    <ul class="oc-reasons">
      ${(primary.reasons || []).map((r) => `<li>${r}</li>`).join("")}
    </ul>
    ${(primary.risks || []).length ? `<div class="oc-risks"><strong>Watch:</strong> ${primary.risks.join(" · ")}</div>` : ""}
    <div class="btn-row" style="margin-top:14px">
      <button type="button" class="btn btn-primary oc-draft-primary" data-id="${primary.id}">Draft ${primary.name.split(" ").pop()}</button>
    </div>
  `;
  hero.querySelector(".oc-draft-primary")?.addEventListener("click", () => {
    takePick(primary.id, true);
  });

  $("#ocAlts").innerHTML = alts
    .map(
      (p, i) => `
    <button type="button" class="oc-alt" data-id="${p.id}">
      <span class="oc-alt-n">${i + 2}</span>
      <span class="pos-badge ${p.pos}">${p.pos}</span>
      <span class="oc-alt-name">${p.name}</span>
      <span class="oc-alt-meta">${p.team} · ADP ${p.adpRaw ?? "—"}</span>
    </button>`
    )
    .join("") || `<p class="help-text">No alternates</p>`;

  $$("#ocAlts .oc-alt").forEach((btn) => {
    btn.addEventListener("click", () => takePick(btn.dataset.id, true));
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
    </tr>`
    )
    .join("");

  $("#ocBoardTable").innerHTML = `
    <thead><tr>
      <th>Rank</th><th>Player</th><th>Team</th><th>Bye</th><th>ADP</th><th>Pos</th><th>Tier</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="7" style="padding:16px;color:var(--text-muted)">Board empty</td></tr>`}</tbody>`;
}

function renderDraftLog() {
  const log = $("#draftLog");
  if (!log) return;
  log.innerHTML = state.picks
    .slice()
    .reverse()
    .slice(0, 40)
    .map(
      (p) =>
        `<div class="pick ${p.isMine ? "mine" : ""}"><span class="num">#${p.pickNo ?? "—"}</span><span>${p.isMine ? "★ " : ""}${p.name} <span style="color:var(--text-muted)">${p.pos || ""} ${p.team || ""}</span></span></div>`
    )
    .join("") || `<p class="help-text">No picks yet</p>`;
}

function renderAll() {
  if (!state.connected) {
    $("#ocGate")?.classList.remove("hidden");
    $("#ocRoom")?.classList.add("hidden");
    setLiveStatus("", "Not connected — connect to unlock picks");
    return;
  }
  $("#ocGate")?.classList.add("hidden");
  $("#ocRoom")?.classList.remove("hidden");
  renderNeedMeter();
  renderTurnBar();
  renderSuggestions();
  renderGoneBefore();
  renderRemainingBoard();
  renderDraftLog();
  persistDraft();
}

function takePick(id, isMine) {
  const p = state.players.find((x) => x.id === id);
  if (!p || p.drafted) return;
  p.drafted = true;
  if (isMine && !state.myRoster.some((m) => m.id === id)) state.myRoster.push(p);
  const pickNo = state.players.filter((x) => x.drafted).length;
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
    if (!draftId && leagueId) {
      const drafts = await sleeperGetLeagueDrafts(leagueId);
      draftId = drafts?.[0]?.draft_id;
    }
    if (!draftId && userId) {
      const leagues = await sleeperGetLeagues(userId, "2026");
      if (leagues?.[0]) {
        const drafts = await sleeperGetLeagueDrafts(leagues[0].league_id);
        draftId = drafts?.[0]?.draft_id;
      }
    }
    if (!draftId) throw new Error("Could not resolve a draft ID");
    state.sleeper.draftId = draftId;
    await sleeperHydratePlayerIds(state.players);
    const draft = await sleeperGetDraft(draftId);
    const picks = await sleeperGetPicks(draftId);
    const applied = applySleeperPicks(state.players, picks, {
      userId: state.sleeper.userId,
      draftOrder: draft.draft_order,
      slotToRoster: draft.slot_to_roster_id,
    });
    state.myRoster = applied.myRoster || [];
    state.picks = applied.picks || [];

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
      renderAll();
    }, 4000);

    setConnected("sleeper", `Sleeper live · draft ${draftId}`);
    toast("Sleeper connected — board is live");
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
    const applied = applyEspnDraft(state.players, json, { teamId });
    state.myRoster = applied.myRoster || [];
    state.picks = applied.picks || [];
    state.espn = { leagueId, teamId };
    if (state.poller) state.poller.stop();
    state.poller = createDraftPoller(async () => {
      const fresh = await espnFetchLeague({ leagueId, season, useProxy });
      const again = applyEspnDraft(state.players, fresh, { teamId });
      state.myRoster = again.myRoster || [];
      state.picks = again.picks || [];
      renderAll();
    }, 6000);
    setConnected("espn", `ESPN live · league ${leagueId}`);
    toast("ESPN connected — board is live");
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
    renderAll();
  });
  const strat = $("#strategySelect");
  strat.value = state.strategy;
  strat.addEventListener("change", () => {
    state.strategy = strat.value;
    const s = STRATEGIES[state.strategy];
    if ($("#strategyDesc") && s) $("#strategyDesc").textContent = s.desc;
    renderAll();
  });
  if ($("#strategyDesc") && STRATEGIES[state.strategy]) {
    $("#strategyDesc").textContent = STRATEGIES[state.strategy].desc;
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
