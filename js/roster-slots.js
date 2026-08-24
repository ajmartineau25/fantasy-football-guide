/**
 * Sleeper-style roster slot assignment.
 * Starters: QB, RB, RB, WR, WR, TE, FLEX… then K, DST, then BN.
 */

/**
 * Build ordered empty slots from league roster config.
 * @returns {{ key: string, label: string, accept: string[], starter: boolean }[]}
 */
export function buildSlotTemplate(targets = {}) {
  const qb = Number(targets.QB ?? 1);
  const rb = Number(targets.RB ?? 2);
  const wr = Number(targets.WR ?? 2);
  const te = Number(targets.TE ?? 1);
  const flex = Number(targets.FLEX ?? 1);
  const k = Number(targets.K ?? 1);
  const dst = Number(targets.DST ?? 1);
  const bn = Number(targets.BN ?? 6);

  const slots = [];
  const push = (label, accept, starter, n) => {
    for (let i = 0; i < n; i++) {
      slots.push({
        key: `${label}-${i}`,
        label,
        accept,
        starter: !!starter,
      });
    }
  };

  push("QB", ["QB"], true, qb);
  push("RB", ["RB"], true, rb);
  push("WR", ["WR"], true, wr);
  push("TE", ["TE"], true, te);
  push("FLEX", ["RB", "WR", "TE"], true, flex);
  if (k > 0) push("K", ["K"], true, k);
  if (dst > 0) push("DST", ["DST"], true, dst);
  const benchAccept = ["QB", "RB", "WR", "TE"];
  if (k > 0) benchAccept.push("K");
  if (dst > 0) benchAccept.push("DST");
  push("BN", benchAccept, false, bn);
  return slots;
}

/**
 * Greedy fill: best ADP (or pick order) into first legal empty starter, else bench.
 * @param {object[]} myRoster
 * @param {object} targets
 * @param {string} scoring
 */
export function assignToSlots(myRoster, targets = {}, scoring = "ppr") {
  const slots = buildSlotTemplate(targets).map((s) => ({ ...s, player: null }));
  const ordered = [...(myRoster || [])].sort((a, b) => {
    const pa = a.pickNo ?? a.adp?.[scoring] ?? 999;
    const pb = b.pickNo ?? b.adp?.[scoring] ?? 999;
    return pa - pb;
  });

  const used = new Set();

  // Pass 1: fill positional starters (not FLEX/BN)
  for (const p of ordered) {
    if (used.has(p.id)) continue;
    const slot = slots.find(
      (s) => !s.player && s.starter && s.label !== "FLEX" && s.accept.includes(p.pos)
    );
    if (slot) {
      slot.player = p;
      used.add(p.id);
    }
  }

  // Pass 2: FLEX
  for (const p of ordered) {
    if (used.has(p.id)) continue;
    const slot = slots.find((s) => !s.player && s.label === "FLEX" && s.accept.includes(p.pos));
    if (slot) {
      slot.player = p;
      used.add(p.id);
    }
  }

  // Pass 3: bench (and any overflow)
  for (const p of ordered) {
    if (used.has(p.id)) continue;
    const slot = slots.find((s) => !s.player && s.label === "BN");
    if (slot) {
      slot.player = p;
      used.add(p.id);
    } else {
      // Extra overflow row
      const overflowAccept = ["QB", "RB", "WR", "TE"];
      if (Number(targets.K ?? 1) > 0) overflowAccept.push("K");
      if (Number(targets.DST ?? 1) > 0) overflowAccept.push("DST");
      slots.push({
        key: `BN-extra-${p.id}`,
        label: "BN",
        accept: overflowAccept,
        starter: false,
        player: p,
      });
      used.add(p.id);
    }
  }

  return slots;
}

/** Render HTML for a Sleeper-like roster panel. */
export function renderSleeperRosterHtml(slots) {
  if (!slots?.length) {
    return `<p class="help-text">No picks yet</p>`;
  }
  let html = `<div class="sleeper-roster">`;
  let lastStarter = true;
  for (const s of slots) {
    if (lastStarter && !s.starter) {
      html += `<div class="sr-divider">Bench</div>`;
    }
    lastStarter = s.starter;
    const p = s.player;
    if (p) {
      html += `<div class="sr-row filled">
        <span class="sr-slot pos-badge ${p.pos}">${s.label}</span>
        <div class="sr-player">
          <div class="sr-name">${p.name}</div>
          <div class="sr-meta">${p.team}${p.pickNo != null ? ` · pick ${p.pickNo}` : ""}</div>
        </div>
        <span class="sr-pos">${p.pos}</span>
      </div>`;
    } else {
      html += `<div class="sr-row empty">
        <span class="sr-slot muted">${s.label}</span>
        <div class="sr-player"><div class="sr-name empty-label">—</div></div>
      </div>`;
    }
  }
  html += `</div>`;
  return html;
}
