/**
 * Live draft integrations for Sleeper (public API) and ESPN (unofficial API).
 * Sleeper works fully from the browser. ESPN often needs a CORS proxy for private leagues.
 */

const SLEEPER = "https://api.sleeper.app/v1";

/** Optional public CORS proxy fallback for ESPN (user can override). */
const DEFAULT_CORS_PROXY = "https://corsproxy.io/?";

/**
 * Normalize player name for fuzzy matching.
 */
export function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match drafted player metadata to local board player.
 */
export function matchPlayer(localPlayers, { name, pos, team, sleeperId }) {
  if (sleeperId) {
    const byId = localPlayers.find((p) => p.sleeper_id === sleeperId);
    if (byId) return byId;
  }
  const n = normalizeName(name);
  if (!n) return null;

  // Exact name
  let hits = localPlayers.filter((p) => normalizeName(p.name) === n);
  if (hits.length === 1) return hits[0];
  if (pos) hits = hits.filter((p) => p.pos === pos);
  if (hits.length === 1) return hits[0];
  if (team) {
    const t = team.toUpperCase();
    hits = hits.filter((p) => p.team === t);
    if (hits.length === 1) return hits[0];
  }

  // Partial / last-name
  const last = n.split(" ").pop();
  hits = localPlayers.filter((p) => {
    const pn = normalizeName(p.name);
    return pn === n || pn.endsWith(" " + last) || pn.includes(n);
  });
  if (pos) hits = hits.filter((p) => p.pos === pos);
  if (team) hits = hits.filter((p) => p.team === (team || "").toUpperCase());
  return hits[0] || null;
}

/* ---------- Sleeper ---------- */

export async function sleeperGetUser(username) {
  const res = await fetch(`${SLEEPER}/user/${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(`Sleeper user not found: ${username}`);
  return res.json();
}

export async function sleeperGetLeagues(userId, season = "2026") {
  const res = await fetch(`${SLEEPER}/user/${userId}/leagues/nfl/${season}`);
  if (!res.ok) throw new Error("Failed to load Sleeper leagues");
  return res.json();
}

export async function sleeperGetDraft(draftId) {
  const res = await fetch(`${SLEEPER}/draft/${draftId}`);
  if (!res.ok) throw new Error("Failed to load Sleeper draft");
  return res.json();
}

export async function sleeperGetPicks(draftId) {
  const res = await fetch(`${SLEEPER}/draft/${draftId}/picks`);
  if (!res.ok) throw new Error("Failed to load Sleeper picks");
  return res.json();
}

export async function sleeperGetLeague(leagueId) {
  const res = await fetch(`${SLEEPER}/league/${leagueId}`);
  if (!res.ok) throw new Error("Failed to load Sleeper league");
  return res.json();
}

export async function sleeperGetLeagueDrafts(leagueId) {
  const res = await fetch(`${SLEEPER}/league/${leagueId}/drafts`);
  if (!res.ok) throw new Error("Failed to load league drafts");
  return res.json();
}

/**
 * Best-effort: attach sleeper_id onto local players via search_rank / name map from players endpoint.
 * The full players payload is large; we try filtered positions or skip if blocked.
 */
export async function sleeperHydratePlayerIds(localPlayers) {
  try {
    const res = await fetch(`${SLEEPER}/players/nfl?active=true`);
    if (!res.ok) return { matched: 0 };
    const map = await res.json();
    const byName = new Map();
    for (const [id, pl] of Object.entries(map)) {
      if (!pl || !pl.full_name && !pl.first_name) continue;
      const full = pl.full_name || `${pl.first_name || ""} ${pl.last_name || ""}`.trim();
      const key = normalizeName(full);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ id, pos: pl.position, team: pl.team });
    }
    // DEF teams
    for (const [id, pl] of Object.entries(map)) {
      if (pl?.position === "DEF" && pl.team) {
        byName.set(normalizeName(pl.team + " defense"), [{ id, pos: "DST", team: pl.team }]);
        byName.set(normalizeName(pl.team), [{ id, pos: "DST", team: pl.team }]);
      }
    }

    let matched = 0;
    for (const p of localPlayers) {
      if (p.pos === "DST") {
        const hits = byName.get(normalizeName(p.team)) || [];
        const def = hits.find((h) => h.pos === "DEF" || h.pos === "DST") || hits[0];
        if (def) {
          p.sleeper_id = def.id;
          matched++;
        }
        continue;
      }
      const hits = byName.get(normalizeName(p.name)) || [];
      let hit = hits[0];
      if (hits.length > 1) {
        hit = hits.find((h) => h.pos === p.pos && h.team === p.team) ||
          hits.find((h) => h.pos === p.pos) ||
          hits[0];
      }
      if (hit) {
        p.sleeper_id = hit.id;
        matched++;
      }
    }
    return { matched, total: localPlayers.length };
  } catch (e) {
    console.warn("Sleeper player hydrate failed", e);
    return { matched: 0, error: String(e) };
  }
}

/**
 * Apply Sleeper picks onto local board.
 * @returns {{ draftedIds: Set, myRoster: object[], picks: object[], myRosterId: number|null }}
 */
/**
 * Sleeper draft_order maps user_id → slot (1-based).
 */
export function detectSleeperDraftSlot(draft, userId) {
  if (!draft?.draft_order || userId == null) return null;
  const raw =
    draft.draft_order[userId] ??
    draft.draft_order[String(userId)];
  const slot = Number(raw);
  return Number.isFinite(slot) && slot > 0 ? slot : null;
}

export function detectSleeperTeamCount(draft) {
  const n = Number(draft?.settings?.teams || draft?.metadata?.teams);
  return Number.isFinite(n) && n >= 8 ? n : null;
}

/**
 * Parse Sleeper draft or league settings → our roster shape.
 * Draft settings use slots_qb, slots_rb, …; league uses roster_positions array.
 */
export function parseSleeperRosterSettings(draftOrLeague) {
  const s = draftOrLeague?.settings || {};
  const fromSlots = {
    QB: numOrNull(s.slots_qb),
    RB: numOrNull(s.slots_rb),
    WR: numOrNull(s.slots_wr),
    TE: numOrNull(s.slots_te),
    FLEX: numOrNull(s.slots_flex),
    K: numOrNull(s.slots_k),
    DST: numOrNull(s.slots_def),
    BN: numOrNull(s.slots_bn),
  };
  // Superflex counts as an extra FLEX-like QB-eligible spot — fold into FLEX display for now
  const sf = numOrNull(s.slots_super_flex) || numOrNull(s.slots_superflex) || 0;
  if (sf > 0) fromSlots.FLEX = (fromSlots.FLEX || 0) + sf;

  const hasAny = Object.values(fromSlots).some((v) => v != null);
  if (hasAny) {
    return {
      QB: fromSlots.QB ?? 1,
      RB: fromSlots.RB ?? 2,
      WR: fromSlots.WR ?? 2,
      TE: fromSlots.TE ?? 1,
      FLEX: fromSlots.FLEX ?? 1,
      K: fromSlots.K ?? 0,
      DST: fromSlots.DST ?? 0,
      BN: fromSlots.BN ?? 6,
      teams: numOrNull(s.teams) || null,
    };
  }

  // League object: roster_positions like ["QB","RB","RB","WR","WR","TE","FLEX","BN",...]
  const positions = draftOrLeague?.roster_positions;
  if (Array.isArray(positions) && positions.length) {
    const counts = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BN: 0 };
    for (const raw of positions) {
      const p = String(raw || "").toUpperCase();
      if (p === "QB") counts.QB += 1;
      else if (p === "RB") counts.RB += 1;
      else if (p === "WR") counts.WR += 1;
      else if (p === "TE") counts.TE += 1;
      else if (p === "FLEX" || p === "WRRB_FLEX" || p === "REC_FLEX") counts.FLEX += 1;
      else if (p === "SUPER_FLEX" || p === "SUPERFLEX" || p === "Q/W/R/T") counts.FLEX += 1;
      else if (p === "K") counts.K += 1;
      else if (p === "DEF" || p === "DST") counts.DST += 1;
      else if (p === "BN" || p === "BENCH") counts.BN += 1;
      // ignore IR/TAXI for starter board
    }
    return {
      ...counts,
      teams: numOrNull(s.teams) || numOrNull(draftOrLeague?.total_rosters) || null,
    };
  }
  return null;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ESPN mSettings → roster slot counts.
 * lineupslots: { "0": 1, "2": 2, ... } where keys are position IDs.
 */
export function parseEspnRosterSettings(leagueJson) {
  const settings = leagueJson?.settings || {};
  const slots = settings.rosterSettings?.lineupSlotCounts || settings.rosterSettings?.lineupSlots;
  // ESPN position IDs (common):
  // 0 QB, 2 RB, 4 WR, 6 TE, 23 FLEX, 16 D/ST, 17 K, 20 BENCH, 21 IR
  const map = {
    0: "QB",
    2: "RB",
    4: "WR",
    6: "TE",
    23: "FLEX",
    16: "DST",
    17: "K",
    20: "BN",
  };
  if (slots && typeof slots === "object") {
    const out = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BN: 0 };
    for (const [key, val] of Object.entries(slots)) {
      const label = map[key] || map[Number(key)];
      if (!label) continue;
      out[label] += Number(val) || 0;
    }
    // Some leagues use 3 = RB/WR flex variants — treat unknown flex-like as FLEX if present
    if (slots["21"] != null) {
      /* IR ignored */
    }
    out.teams = detectEspnTeamCount(leagueJson);
    return out;
  }
  return null;
}

/**
 * ESPN teams often expose draftDayOrder / draftPosition (1-based slot).
 */
export function detectEspnDraftSlot(leagueJson, teamId) {
  if (teamId == null) return null;
  const teams = leagueJson?.teams || [];
  const t = teams.find((x) => Number(x.id) === Number(teamId));
  if (!t) return null;
  const raw =
    t.draftDayOrder ??
    t.draftPosition ??
    t.draftOverallPick ??
    t?.primaryOwner?.draftPosition;
  const slot = Number(raw);
  return Number.isFinite(slot) && slot > 0 ? slot : null;
}

export function detectEspnTeamCount(leagueJson) {
  const n =
    Number(leagueJson?.settings?.size) ||
    Number(leagueJson?.status?.teamsJoined) ||
    (leagueJson?.teams || []).length;
  return Number.isFinite(n) && n >= 8 ? n : null;
}

export function applySleeperPicks(localPlayers, picks, { userId, draftOrder, slotToRoster } = {}) {
  // Reset
  for (const p of localPlayers) {
    p.drafted = false;
    p.draftedBy = null;
    p.pickNo = null;
  }

  let myRosterId = null;
  if (userId && draftOrder) {
    const slot = draftOrder[userId];
    if (slot != null && slotToRoster) {
      myRosterId = slotToRoster[String(slot)] ?? slotToRoster[slot] ?? null;
    }
  }

  const draftedIds = new Set();
  const myRoster = [];
  const normalizedPicks = [];

  for (const pick of picks || []) {
    const meta = pick.metadata || {};
    const name = `${meta.first_name || ""} ${meta.last_name || ""}`.trim() || meta.full_name;
    const pos = meta.position === "DEF" ? "DST" : meta.position;
    const team = meta.team;
    const sleeperId = pick.player_id;

    let local = null;
    if (sleeperId) {
      local = localPlayers.find((p) => p.sleeper_id === sleeperId);
    }
    if (!local) {
      local = matchPlayer(localPlayers, { name, pos, team, sleeperId });
    }
    // DST by team abbrev as player_id
    if (!local && (pos === "DST" || pos === "DEF") && (team || sleeperId)) {
      const t = (team || sleeperId || "").toUpperCase();
      local = localPlayers.find((p) => p.pos === "DST" && p.team === t);
    }

    if (local) {
      local.drafted = true;
      local.draftedBy = pick.picked_by || pick.roster_id;
      local.pickNo = pick.pick_no;
      draftedIds.add(local.id);
      const isMine =
        (userId && pick.picked_by === userId) ||
        (myRosterId != null && Number(pick.roster_id) === Number(myRosterId));
      if (isMine) myRoster.push(local);
    }

    normalizedPicks.push({
      pickNo: pick.pick_no,
      round: pick.round,
      name: name || local?.name || sleeperId,
      pos: pos || local?.pos,
      team: team || local?.team,
      isMine:
        (userId && pick.picked_by === userId) ||
        (myRosterId != null && Number(pick.roster_id) === Number(myRosterId)),
      localId: local?.id || null,
    });
  }

  normalizedPicks.sort((a, b) => a.pickNo - b.pickNo);
  return { draftedIds, myRoster, picks: normalizedPicks, myRosterId };
}

/* ---------- ESPN ---------- */

/**
 * ESPN fantasy endpoints (unofficial).
 * Public leagues: often work without auth.
 * Private leagues: need espn_s2 + SWID cookies; browser CORS usually blocks direct calls.
 */
export function buildEspnLeagueUrl(leagueId, season = 2026, views = ["mDraftDetail", "mTeam", "mSettings"]) {
  const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;
  const viewQ = views.map((v) => `view=${v}`).join("&");
  return `${base}?${viewQ}`;
}

export async function espnFetchLeague({
  leagueId,
  season = 2026,
  espnS2 = "",
  swid = "",
  useProxy = true,
  proxyPrefix = DEFAULT_CORS_PROXY,
}) {
  const url = buildEspnLeagueUrl(leagueId, season);
  const headers = { Accept: "application/json" };
  // Cookie headers only work from a local proxy / extension — browsers block Cookie header.
  // We still accept values so a future local proxy can inject them.
  let fetchUrl = url;
  if (useProxy) {
    fetchUrl = proxyPrefix + encodeURIComponent(url);
  }

  const res = await fetch(fetchUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `ESPN fetch failed (${res.status}). Private leagues need espn_s2/SWID via a local proxy, or use a public league.`
    );
  }
  return res.json();
}

/**
 * Parse ESPN draft detail into picks and mark local board.
 */
export function applyEspnDraft(localPlayers, leagueJson, { teamId } = {}) {
  for (const p of localPlayers) {
    p.drafted = false;
    p.draftedBy = null;
    p.pickNo = null;
  }

  const detail = leagueJson?.draftDetail || {};
  const picksRaw = detail.picks || [];
  const playersMap = {};
  // players can be under players map in some views
  if (leagueJson?.players) {
    for (const pl of leagueJson.players) {
      const id = pl.id ?? pl.player?.id;
      if (id != null) playersMap[id] = pl.player || pl;
    }
  }

  const draftedIds = new Set();
  const myRoster = [];
  const picks = [];

  const posMap = {
    1: "QB",
    2: "RB",
    3: "WR",
    4: "TE",
    5: "K",
    16: "DST",
  };

  for (const pick of picksRaw) {
    const playerId = pick.playerId;
    const info = playersMap[playerId] || {};
    const fullName =
      info.fullName ||
      [info.firstName, info.lastName].filter(Boolean).join(" ") ||
      `Player ${playerId}`;
    const pos =
      posMap[info.defaultPositionId] ||
      posMap[pick.defaultPositionId] ||
      null;
    const team =
      info.proTeamAbbreviation ||
      info.proTeamId ||
      null;

    let local = matchPlayer(localPlayers, { name: fullName, pos, team: typeof team === "string" ? team : null });
    // Try ESPN id if we stored it
    if (!local && playerId) {
      local = localPlayers.find((p) => String(p.espn_id) === String(playerId));
    }
    if (local) {
      local.drafted = true;
      local.draftedBy = pick.teamId;
      local.pickNo = pick.overallPickNumber ?? pick.pickOrder;
      draftedIds.add(local.id);
      if (teamId != null && Number(pick.teamId) === Number(teamId)) {
        myRoster.push(local);
      }
    }

    picks.push({
      pickNo: pick.overallPickNumber ?? pick.pickOrder,
      round: pick.roundId,
      name: fullName,
      pos: pos || local?.pos,
      team: (typeof team === "string" ? team : local?.team) || "",
      isMine: teamId != null && Number(pick.teamId) === Number(teamId),
      localId: local?.id || null,
    });
  }

  picks.sort((a, b) => (a.pickNo || 0) - (b.pickNo || 0));
  return { draftedIds, myRoster, picks, draftComplete: !!detail.drafted };
}

/**
 * Polling controller for live drafts.
 */
export function createDraftPoller(fn, intervalMs = 5000) {
  let timer = null;
  let stopped = true;

  async function tick() {
    if (stopped) return;
    try {
      await fn();
    } catch (e) {
      console.error("Draft poll error", e);
    }
  }

  return {
    start() {
      stopped = false;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    get running() {
      return !stopped && !!timer;
    },
  };
}

/** Manual mark drafted by name (for mock / non-connected drafts). */
export function markDraftedByName(localPlayers, name, isMine = false) {
  const local = matchPlayer(localPlayers, { name });
  if (!local) return null;
  local.drafted = true;
  local.draftedBy = isMine ? "me" : "other";
  return local;
}
