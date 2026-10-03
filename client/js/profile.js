/* ============================================================================
   LAST CALL — profile, coins, unlocks
   ----------------------------------------------------------------------------
   Your face, your pile of coins, and the things they have bought. Stored in
   the browser: no passwords, no server round-trip, works offline and in the
   single-file build. Coins are earned from server-computed match payouts
   (kills, self-blanks, survival), so the economy rides on the authoritative
   result — the browser only keeps score of what the server already declared.
   ========================================================================== */
'use strict';

const KEY = 'lastcall.profile.v1';

/* The shop. Prices are tuned against a typical payout of 8–20 coins a match:
   a new face is two good nights out; the golden gun is a week of nerve. */
export const SHOP = {
  chars: {
    fedora: 0, shades: 0, moustache: 0, cigarette: 0, cat: 0,
    moth: 40, skull: 60, cactus: 80, toucan: 100, toaster: 120
  },
  weapons: { revolver: 0, sawedoff: 60, flintlock: 90, golden: 150 },
  maps: { backroom: 0, diner: 70, rooftop: 110 }
};

export const CHAR_BLURB = {
  fedora: 'The regular. Owns three hats, wears one.',
  shades: 'Has not made eye contact since 2019.',
  moustache: 'The moustache plays; the man assists.',
  cigarette: 'Indoors. Obviously.',
  cat: 'Nine lives down to a sensible number.',
  moth: 'Here for the lamp. Stay for the violence.',
  skull: 'Wrestles on weekends. Loses politely.',
  cactus: 'Hug at your own risk.',
  toucan: 'The beak compensates for something.',
  toaster: 'Technically alive. Debatably bread.'
};

const blankProfile = () => ({
  name: '', avatar: 'fedora', coins: 0,
  unlocked: { chars: ['fedora', 'shades', 'moustache', 'cigarette', 'cat'], weapons: ['revolver'], maps: ['backroom'] },
  stats: { matches: 0, wins: 0, kills: 0, selfBlanks: 0, deaths: 0 }
});

let P = null;

export function load() {
  if (P) return P;
  try {
    const raw = localStorage.getItem(KEY);
    P = raw ? Object.assign(blankProfile(), JSON.parse(raw)) : blankProfile();
    // heal anything an older build forgot
    const b = blankProfile();
    P.unlocked = Object.assign(b.unlocked, P.unlocked || {});
    P.stats = Object.assign(b.stats, P.stats || {});
  } catch (e) { P = blankProfile(); }
  return P;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {}
}

export function profile() { return load(); }

export function setName(n) { load().name = n; save(); }
export function setAvatar(a) { load().avatar = a; save(); }

export function price(cat, id) { return (SHOP[cat] || {})[id] || 0; }
export function isUnlocked(cat, id) { return load().unlocked[cat].includes(id); }

export function unlock(cat, id) {
  const p = load();
  const cost = price(cat, id);
  if (p.unlocked[cat].includes(id)) return { ok: true, already: true };
  if (p.coins < cost) return { ok: false, need: cost - p.coins };
  p.coins -= cost;
  p.unlocked[cat].push(id);
  save();
  return { ok: true, spent: cost };
}

/* The server declares what a match paid. We bank it and remember the night. */
export function bankPayout(coins, result) {
  const p = load();
  p.coins += coins || 0;
  p.stats.matches++;
  if (result && result.won) p.stats.wins++;
  if (result) {
    p.stats.kills += result.kills || 0;
    p.stats.selfBlanks += result.selfBlanks || 0;
    if (!result.won) p.stats.deaths++;
  }
  save();
  return p;
}
