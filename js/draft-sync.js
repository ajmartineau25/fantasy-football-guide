/**
 * Shared draft state between Rankings and On the Clock.
 * Persists to localStorage key `ffg_draft` and broadcasts updates.
 */

export const DRAFT_STORAGE_KEY = "ffg_draft";
export const DRAFT_EVENT = "ffg-draft-updated";

export function readDraftState() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

export function writeDraftState(partial) {
  const prev = readDraftState();
  const next = { ...prev, ...partial, updatedAt: Date.now() };
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
  try {
    window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: next }));
  } catch (_) {}
  return next;
}

/**
 * Apply drafted flags + rebuild myRoster from stored snapshot onto players[].
 */
export function applyStoredDraftToPlayers(players, draft = null) {
  const d = draft || readDraftState();
  const draftedRows = Array.isArray(d.drafted) ? d.drafted : [];
  const myIds = new Set(d.myRosterIds || []);
  const byId = new Map(draftedRows.map((r) => [r.id, r]));

  const hasSnapshot = draftedRows.length > 0 || myIds.size > 0 || !!d.connected;

  for (const p of players) {
    const row = byId.get(p.id);
    if (row) {
      p.drafted = true;
      p.draftedBy = row.isMine ? "me" : "other";
    } else if (myIds.has(p.id)) {
      p.drafted = true;
      p.draftedBy = "me";
    } else if (hasSnapshot) {
      // Snapshot is source of truth — clear anyone not in it
      p.drafted = false;
      p.draftedBy = null;
    }
  }

  const myRoster = players.filter((p) => myIds.has(p.id) || p.draftedBy === "me");
  return {
    myRoster,
    picks: Array.isArray(d.picks) ? d.picks : [],
    source: d.source || null,
    connected: !!d.connected,
    sleeper: d.sleeper || {},
    espn: d.espn || {},
    queue: Array.isArray(d.queue) ? d.queue : [],
    soundOnTurn: !!d.soundOnTurn,
  };
}

export function snapshotDrafted(players, myRoster) {
  const mySet = new Set((myRoster || []).map((p) => p.id));
  return players
    .filter((p) => p.drafted)
    .map((p) => ({ id: p.id, isMine: mySet.has(p.id) || p.draftedBy === "me" }));
}

/**
 * Subscribe to cross-tab (storage) + same-tab (custom event) draft updates.
 * Returns an unsubscribe function.
 */
export function onDraftUpdated(handler) {
  const onStorage = (e) => {
    if (e.key === DRAFT_STORAGE_KEY) {
      handler(readDraftState());
    }
  };
  const onCustom = (e) => handler(e.detail || readDraftState());
  window.addEventListener("storage", onStorage);
  window.addEventListener(DRAFT_EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DRAFT_EVENT, onCustom);
  };
}
