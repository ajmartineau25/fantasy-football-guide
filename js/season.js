import { rankPlayers, countRoster } from "./rankings.js";
import { optimizeLineup, waiverTargets, defaultLeagueSettings } from "./decision.js";

const DATA_FALLBACK =
  "https://raw.githubusercontent.com/ajmartineau25/fantasy-football-guide/main/data";

const state = {
  players: [],
  meta: null,
  scoring: "ppr",
  week: 1,
  roster: [],
  weights: {},
  targets: defaultLeagueSettings().roster,
};

const $ = (s) => document.querySelector(s);

function toast(msg, type = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2800);
}

async function fetchJson(path) {
  try {
    const res = await fetch(`./data/${path}`);
    if (res.ok) return res.json();
  } catch (_) {}
  const res = await fetch(`${DATA_FALLBACK}/${path}`);
  if (!res.ok) throw new Error(path);
  return res.json();
}

function loadDraftRosterFromStorage() {
  try {
    const raw = localStorage.getItem("ffg_my_roster");
    if (!raw) return [];
    const ids = JSON.parse(raw);
    return state.players.filter((p) => ids.includes(p.id));
  } catch {
    return [];
  }
}

function saveRoster() {
  localStorage.setItem("ffg_my_roster", JSON.stringify(state.roster.map((p) => p.id)));
}

function matchPlayer(name) {
  const q = name.toLowerCase().trim();
  return state.players.find((p) => p.name.toLowerCase() === q)
    || state.players.find((p) => p.name.toLowerCase().includes(q));
}

function renderRoster() {
  $("#statRosterN").textContent = String(state.roster.length);
  $("#rosterList").innerHTML = state.roster
    .map(
      (p) => `<div class="rec-item">
        <span class="pos-badge ${p.pos}">${p.pos}</span>
        <div><strong>${p.name}</strong><div class="meta" style="font-size:0.72rem;color:var(--text-muted)">${p.team}</div></div>
        <button class="btn" data-drop="${p.id}" style="width:auto;padding:4px 8px;font-size:0.72rem">Drop</button>
      </div>`
    )
    .join("") || `<div class="help-text">No roster yet. Load from draft or add names.</div>`;

  document.querySelectorAll("[data-drop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.roster = state.roster.filter((p) => p.id !== btn.dataset.drop);
      saveRoster();
      renderAll();
    });
  });
}

function renderLineup() {
  if (!state.roster.length) {
    $("#lineupGrid").innerHTML = `<div class="help-text">Add players to optimize.</div>`;
    $("#benchList").innerHTML = "";
    $("#statStarters").textContent = "—";
    $("#sitStartNotes").innerHTML = "Load a roster to get sit/start guidance.";
    return;
  }

  const { lineup, bench } = optimizeLineup(state.roster, {
    scoring: state.scoring,
    weights: state.weights,
    slots: {
      QB: state.targets.QB || 1,
      RB: state.targets.RB || 2,
      WR: state.targets.WR || 2,
      TE: state.targets.TE || 1,
      FLEX: state.targets.FLEX || 1,
      K: state.targets.K || 1,
      DST: state.targets.DST || 1,
    },
  });

  const order = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST"];
  let html = "";
  let starterCount = 0;
  for (const slot of order) {
    const arr = lineup[slot] || [];
    for (const p of arr) {
      starterCount++;
      html += `<div class="lineup-slot">
        <div class="slot-label">${slot}</div>
        <div class="slot-player">
          <span class="pos-badge ${p.pos}">${p.pos}</span>
          <div>
            <strong>${p.name}</strong>
            <div class="meta">${p.team} · week score ${p.weekScore ?? "—"}</div>
          </div>
        </div>
      </div>`;
    }
  }
  $("#lineupGrid").innerHTML = html || `<div class="help-text">Could not fill lineup.</div>`;
  $("#statStarters").textContent = String(starterCount);

  $("#benchList").innerHTML = bench
    .map(
      (p) => `<div class="rec-item">
        <span class="pos-badge ${p.pos}">${p.pos}</span>
        <div><strong>${p.name}</strong><div class="meta" style="font-size:0.72rem;color:var(--text-muted)">${p.team}</div></div>
        <span class="score">${(p.displayTotal ?? p.total).toFixed(1)}</span>
      </div>`
    )
    .join("") || `<div class="help-text">No bench.</div>`;

  // Sit/start notes
  const notes = [];
  const flex = lineup.FLEX?.[0];
  const benchRbWr = bench.filter((p) => ["RB", "WR", "TE"].includes(p.pos)).slice(0, 3);
  if (flex && benchRbWr[0] && (benchRbWr[0].weekScore || 0) > (flex.weekScore || 0) - 1) {
    notes.push(`Watch: ${benchRbWr[0].name} is close to your FLEX (${flex.name}).`);
  }
  for (const p of [...(lineup.RB || []), ...(lineup.WR || [])]) {
    const sos = p.activeMetrics?.sos ?? p.metrics?.ppr?.sos ?? 16;
    if (sos <= 10) notes.push(`Caution starting ${p.name}: tougher SOS profile (${sos}/32).`);
    if (sos >= 26) notes.push(`Good matchup profile for ${p.name} (SOS ease ${sos}/32).`);
  }
  const injured = state.roster.filter((p) => (p.metrics?.ppr?.injury ?? 17) <= 10);
  for (const p of injured) notes.push(`${p.name}: low health profile — confirm inactive/active before lock.`);
  if (!notes.length) notes.push("No major red flags. Lineup optimized on model + schedule ease + health.");
  $("#sitStartNotes").innerHTML = notes.map((n) => `<p style="margin-bottom:8px">• ${n}</p>`).join("");
}

function renderWaivers() {
  // Mark roster as "owned" for FA pool: use drafted flag temporarily
  const owned = new Set(state.roster.map((p) => p.id));
  const pool = state.players.map((p) => ({
    ...p,
    drafted: owned.has(p.id) ? false : p.drafted,
  }));
  // free agents = not on roster
  const fa = state.players.filter((p) => !owned.has(p.id));
  const targets = waiverTargets(fa.map((p) => ({ ...p, drafted: false })), state.roster, {
    scoring: state.scoring,
    weights: state.weights,
    targets: state.targets,
    limit: 12,
  });

  $("#waiverList").innerHTML = targets
    .map(
      (p) => `<div class="rec-item">
        <span class="pos-badge ${p.pos}">${p.pos}</span>
        <div>
          <strong>${p.name}</strong>
          <div class="meta" style="font-size:0.72rem;color:var(--text-muted)">${p.team} · ${p.reasons?.[0] || ""}</div>
        </div>
        <span class="score">${(p.addScore ?? 0).toFixed(1)}</span>
      </div>`
    )
    .join("") || `<div class="help-text">Add a roster to rank waivers for your needs.</div>`;
}

function renderAll() {
  $("#statWeek").textContent = String(state.week);
  renderRoster();
  renderLineup();
  renderWaivers();
}

function bind() {
  const sel = $("#weekSelect");
  for (let w = 1; w <= 18; w++) {
    const o = document.createElement("option");
    o.value = w;
    o.textContent = `Week ${w}`;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    state.week = Number(sel.value);
    renderAll();
  });
  $("#seasonScoring").addEventListener("change", (e) => {
    state.scoring = e.target.value;
    renderAll();
  });
  $("#btnOptimize").addEventListener("click", () => {
    renderLineup();
    toast("Lineup optimized");
  });
  $("#btnLoadDraftRoster").addEventListener("click", () => {
    const r = loadDraftRosterFromStorage();
    if (!r.length) {
      toast("No draft roster in this browser — draft first or add names", "err");
      return;
    }
    state.roster = r;
    saveRoster();
    renderAll();
    toast(`Loaded ${r.length} players from draft`);
  });
  $("#btnClearRoster").addEventListener("click", () => {
    state.roster = [];
    saveRoster();
    renderAll();
  });
  $("#addRosterName").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const name = e.target.value.trim();
    if (!name) return;
    const p = matchPlayer(name);
    if (!p) {
      toast(`No match for ${name}`, "err");
      return;
    }
    if (state.roster.find((x) => x.id === p.id)) {
      toast("Already on roster", "err");
      return;
    }
    state.roster.push(p);
    saveRoster();
    e.target.value = "";
    renderAll();
    toast(`Added ${p.name}`);
  });
}

async function init() {
  try {
    const [players, meta] = await Promise.all([
      fetchJson("players.json"),
      fetchJson("meta.json"),
    ]);
    state.players = players;
    state.meta = meta;
    state.weights = { ...meta.default_weights };
    state.targets = { ...defaultLeagueSettings().roster, ...(meta.league_defaults?.roster || {}) };
    state.scoring = meta.league_defaults?.scoring === "half" ? "half" : "ppr";
    $("#seasonScoring").value = state.scoring;
    bind();
    state.roster = loadDraftRosterFromStorage();
    renderAll();
    toast("Season Mode ready");
  } catch (e) {
    console.error(e);
    toast("Failed to load data", "err");
  }
}

init();
