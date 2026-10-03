/* ============================================================================
   LAST CALL — the interface
   ----------------------------------------------------------------------------
   All text in this game is DOM, never pixels in the WebGL buffer. That is the
   single decision that makes it readable on a 5-inch phone: the browser does
   the text rendering, the hinting, the reflow and the accessibility, and the
   3D layer only has to draw a table and a gun.

   Player cards are anchored to projected seat positions, so they orbit with
   the camera like they are physically at the table — but they remain ordinary
   selectable, screen-readable elements.
   ========================================================================== */
'use strict';

import { profile, setName, setAvatar, unlock, isUnlocked, price, CHAR_BLURB } from './profile.js';

/* ── icons ──────────────────────────────────────────────────────────────── */
const S = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}${extra || ''}</svg>`;

export const ITEM_ICON = {
  puff: S('<path d="M4 16h9a3 3 0 0 0 0-6H9"/><path d="M13 13h6a2.5 2.5 0 0 0 0-5h-4"/><path d="M17 8V5.5M20 14v2.5M3 20h18"/>'),
  glasses: S('<circle cx="7" cy="14" r="3.4"/><circle cx="17" cy="14" r="3.4"/><path d="M10.4 13.4c1-1 2.2-1 3.2 0"/><path d="M3.6 12 5 8h3M20.4 12 19 8h-3"/>'),
  brew: S('<path d="M10 3h4v3.2l2 3.3V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.5l2-3.3z"/><path d="M8 13h8"/><path d="M10.5 3h3"/>'),
  saw: S('<path d="M3 15 15 3l6 6-12 12H3z"/><path d="M6 18l1.6-1.6M9 15l1.6-1.6M12 12l1.6-1.6M15 9l1.6-1.6"/><circle cx="17" cy="7" r="1.4"/>'),
  ties: S('<path d="M9 4c-2 2 0 4 2 5s4 2 4 5-2 4-4 4-3-1-3-2.5S9.5 13 11 12.5"/><path d="M14.5 3.5 17 6l-2.5 2.5"/><path d="M9.5 20.5 7 18l2.5-2.5"/>'),
  refund: S('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/><path d="M12 9v6M10 10.5h3a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h3"/>'),
  pill: S('<rect x="2.6" y="8.6" width="18.8" height="6.8" rx="3.4"/><path d="M12 8.6v6.8"/><path d="M6.6 12h1M17.4 12h-1"/>'),
  burner: S('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 5.5h3"/><circle cx="12" cy="18" r="1"/>'),
  sticky: S('<path d="M9 11V5.5a1.6 1.6 0 0 1 3.2 0V11"/><path d="M12.2 10.6V7.4a1.6 1.6 0 0 1 3.2 0v4"/><path d="M15.4 11.6v-2a1.6 1.6 0 0 1 3.2 0V15a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.6-1.5L4 15.6a1.7 1.7 0 0 1 2.5-2.3L9 15.5"/>')
};

export const AVATAR = {
  fedora:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 17h18"/><path d="M4.5 17c0-1 .7-1.6 1.6-1.8L8 10.5c.3-1.6 1-2.3 4-2.3s3.7.7 4 2.3l1.9 4.7c.9.2 1.6.8 1.6 1.8"/><path d="M8.4 14h7.2"/></svg>`,
  shades:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2" y="9" width="8" height="5.5" rx="2"/><rect x="14" y="9" width="8" height="5.5" rx="2"/><path d="M10 11h4"/><path d="M2 10 4.5 7M22 10 19.5 7"/></svg>`,
  moustache: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 12.5c-1-2-2.6-3-4.6-2.6-2.2.5-3.4 2.4-2.9 4 .4 1.4 2 1.7 3 .8.9-.8 2-1.4 4.5-1.4s3.6.6 4.5 1.4c1 .9 2.6.6 3-.8.5-1.6-.7-3.5-2.9-4-2-.4-3.6.6-4.6 2.6z"/></svg>`,
  cigarette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 16h14v3H2z"/><path d="M16 16h5v3h-5z" stroke-dasharray="2 1.6"/><path d="M18 12c0-1.6 1.6-2 1.6-3.6S18.4 6 18.4 6"/></svg>`,
  moth:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 7v11"/><path d="M12 9C10 5.5 6.5 4 4.5 6s-.5 6 2 7c-2 .6-3 2.6-1.6 4.4C6.2 19.4 9.6 18 12 15"/><path d="M12 9c2-3.5 5.5-5 7.5-3s.5 6-2 7c2 .6 3 2.6 1.6 4.4C17.8 19.4 14.4 18 12 15"/><path d="M10.5 6 8.5 4M13.5 6l2-2"/></svg>`,
  cat:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 10 4 3.5 8.5 6M19 10l1-6.5L15.5 6"/><path d="M12 20c-4 0-7-2.6-7-6.6C5 9.7 8 7 12 7s7 2.7 7 6.4c0 4-3 6.6-7 6.6z"/><path d="M9.4 12.6h.01M14.6 12.6h.01"/><path d="M12 15.2v1.2M10 17h4"/></svg>`,
  skull:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2.5c-4.7 0-8 3.2-8 7.6 0 2.6 1.2 4.3 2.6 5.3v3.1c0 1 .8 1.9 1.8 1.9h7.2c1 0 1.8-.9 1.8-1.9v-3.1c1.4-1 2.6-2.7 2.6-5.3 0-4.4-3.3-7.6-8-7.6z"/><circle cx="9" cy="10.6" r="1.7"/><circle cx="15" cy="10.6" r="1.7"/><path d="M12 14.5v2"/></svg>`,
  cactus:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 21V6a2.5 2.5 0 0 1 5 0v2"/><path d="M9.5 21V13a2.5 2.5 0 0 0-5 0v2.5"/><path d="M4.5 15.5h3M17 21h-5"/><path d="M9.5 12h3"/></svg>`,
  toucan:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 9c0-1.5 1.2-3 3-3h4c3 0 5.5 2.4 5.5 5.5S13.6 17 11 17H7c-2.4 0-4-2-4-4z"/><path d="M21 8c0 4.6-3 7.4-6 8l.6-3.4C15.8 10.8 17.6 9 21 8z"/><circle cx="8" cy="9.4" r="1"/><path d="M11 17c.6 2 2 3 3.4 3"/></svg>`,
  toaster:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="9" width="18" height="11" rx="2.2"/><path d="M6 9V6.5h4V9M14 9V6.5h4V9"/><path d="M9.5 12v4M14.5 12v4"/><path d="M6.5 17.5h11"/></svg>`
};

export const REACTIONS = ['💀', '😂', '🔥', '😱', '🫡', '🤡', '🍺', '🤞'];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

/* ===========================================================================
   UI
   =========================================================================== */
export class UI {
  constructor(handlers) {
    this.h = handlers || {};
    this.cards = new Map();
    this.avatar = 'fedora';
    this.muted = false;
    this.chatOpen = false;
    this.unread = 0;
    this.lastChatId = 0;
    this.armedItem = null;
    this.targeting = false;
    this.you = null;
    this.state = null;
    this.handlersReady = false;
  }

  /* ── boot: wire the static chrome once ────────────────────────────────── */
  init() {
    this.buildAvatars();
    this.buildReactions();

    $('btn-how').addEventListener('click', () => {
      const b = $('howto-body');
      b.hidden = !b.hidden;
    });

    $('btn-create').addEventListener('click', () => this.h.onCreate && this.h.onCreate(this.identity(), { solo: false }));
    $('btn-solo').addEventListener('click', () => this.h.onCreate && this.h.onCreate(this.identity(), { solo: true }));
    $('btn-join-open').addEventListener('click', () => {
      const row = $('join-row');
      row.hidden = !row.hidden;
      if (!row.hidden) $('in-code').focus();
    });
    $('join-row').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = ($('in-code').value || '').trim().toUpperCase().slice(0, 4);
      if (code.length < 4) return this.toast('Codes are four letters.', 'bad');
      this.h.onJoin && this.h.onJoin(Object.assign(this.identity(), { code }));
    });

    // persist the name/avatar between visits
    const p = profile();
    if (p.name) $('in-name').value = p.name;
    if (p.avatar && AVATAR[p.avatar]) this.avatar = p.avatar;
    $('in-name').addEventListener('input', () => this.saveIdentity());
    this.refreshCoins();

    $('btn-copy').addEventListener('click', () => this.copyInvite());
    $('btn-share').addEventListener('click', () => this.shareInvite());
    $('btn-menu').addEventListener('click', () => this.openMenu());
    $('btn-close-menu').addEventListener('click', () => this.showScreen(null));
    $('btn-leave').addEventListener('click', () => { this.showScreen(null); this.h.onLeave && this.h.onLeave(); });
    $('btn-leave-over').addEventListener('click', () => this.h.onLeave && this.h.onLeave());
    $('btn-rematch').addEventListener('click', () => { this.showScreen(null); this.h.onRematch && this.h.onRematch(); });

    $('chat-toggle').addEventListener('click', () => this.toggleChat(true));
    this.bindChatForm('chat-form', 'chat-input');
    this.bindChatForm('lobby-form', 'lobby-input');

    $('btn-self').addEventListener('click', () => this.onSelf());
    $('btn-other').addEventListener('click', () => this.onOther());

    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === 'Escape') { this.targeting = false; this.armedItem = null; this.renderHand(); this.clearTargetHighlight(); this.showScreen(null); }
      if (e.key === ' ' || e.key === 's' || e.key === 'S') { e.preventDefault(); this.onSelf(); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.onOther(); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); this.toggleChat(true); $('chat-input').focus(); }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) this.useItemBySlot(n - 1);
    });

    window.addEventListener('resize', () => {
      for (const card of this.cards.values()) {
        card._w = card.offsetWidth || card._w;
        card._h = card.offsetHeight || card._h;
      }
      this.layout();
    });
    this.handlersReady = true;
  }

  setAvatar(a) {
    this.avatar = a;
    document.querySelectorAll('#avatar-pick button').forEach((b) => b.classList.toggle('on', b.dataset.av === a));
  }

  buildAvatars() {
    const wrap = $('avatar-pick');
    wrap.innerHTML = '';
    const p = profile();
    Object.keys(AVATAR).forEach((k) => {
      const owned = isUnlocked('chars', k);
      const b = el('button', owned ? '' : 'locked', AVATAR[k] + (owned ? '' : `<span class="price">${price('chars', k)}</span>`));
      b.dataset.av = k;
      b.type = 'button';
      b.title = CHAR_BLURB[k] || k;
      b.setAttribute('aria-label', k);
      b.addEventListener('click', () => {
        if (owned || isUnlocked('chars', k)) { this.setAvatar(k); setName(this.pendingName()); return; }
        const res = unlock('chars', k);
        if (res.ok) {
          this.toast('Unlocked ' + k + ' for ' + res.spent + ' coins.');
          this.buildAvatars(); this.setAvatar(k); this.refreshCoins();
        } else {
          this.toast('Need ' + res.need + ' more coins. Go survive something.', 'bad');
        }
      });
      wrap.appendChild(b);
    });
    this.setAvatar(this.avatar);
  }

  pendingName() { return ($('in-name').value || '').trim().slice(0, 16); }

  /* the little brass economy, always visible on the title screen */
  refreshCoins() {
    const p = profile();
    let strip = $('profile-strip');
    if (!strip) {
      strip = el('div', 'profile-strip');
      strip.id = 'profile-strip';
      const ident = document.querySelector('.identity');
      if (ident) ident.parentNode.insertBefore(strip, ident);
    }
    strip.innerHTML =
      `<span class="coin" title="coins">◉</span><b>${p.coins}</b>` +
      `<span class="pstat">${p.stats.wins}W · ${p.stats.matches} played</span>` +
      `<span class="pstat">${p.stats.kills} kills · ${p.stats.selfBlanks} nerve</span>`;
  }

  buildReactions() {
    const wrap = $('chat-reacts');
    wrap.innerHTML = '';
    REACTIONS.forEach((r) => {
      const b = el('button', '', r);
      b.type = 'button';
      b.addEventListener('click', () => this.h.onReact && this.h.onReact(r));
      wrap.appendChild(b);
    });
    const dock = $('emojis');
    dock.className = '';
    dock.id = 'emojis';
    REACTIONS.forEach((r) => {
      const b = el('button', '', r);
      b.type = 'button';
      b.addEventListener('click', () => this.h.onReact && this.h.onReact(r));
      dock.appendChild(b);
    });
  }

  bindChatForm(formId, inputId) {
    const f = $(formId);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const i = $(inputId);
      const text = (i.value || '').trim();
      if (!text) return;
      this.h.onChat && this.h.onChat(text);
      i.value = '';
      this.toggleChat(false);
    });
  }

  identity() {
    const raw = ($('in-name').value || '').trim().slice(0, 16);
    return { name: raw || 'Someone', avatar: this.avatar };
  }
  saveIdentity() {
    setName(this.pendingName() || 'Someone');
    setAvatar(this.avatar);
  }

  copyInvite() {
    const url = location.origin + location.pathname + '#' + (this.roomCode || '');
    const done = () => this.toast('Invite link copied.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.fallbackCopy(url, done));
    } else this.fallbackCopy(url, done);
  }
  fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { this.toast(text); }
    document.body.removeChild(ta);
  }
  shareInvite() {
    const url = location.origin + location.pathname + '#' + (this.roomCode || '');
    navigator.share({ title: 'LAST CALL', text: 'Sit down at my table. Code ' + this.roomCode, url })
      .catch(() => {});
  }

  /* ── screens ──────────────────────────────────────────────────────────── */
  showScreen(name) {
    const map = {
      title: 'scr-title', lobby: 'scr-lobby', reload: 'scr-reload',
      over: 'scr-over', menu: 'scr-menu'
    };
    for (const k of Object.keys(map)) {
      const node = $(map[k]);
      if (!node) continue;
      node.hidden = k !== name;
    }
    this.currentScreen = name;
    const cardsNode = $('cards');
    if (cardsNode) cardsNode.style.opacity = name === 'over' ? '0.18' : '1';
    if (name === 'over') this.h.onOverShown && this.h.onOverShown();
  }

  toast(text, kind) {
    const t = el('div', 'toast' + (kind === 'bad' ? ' bad' : ''), text);
    $('toast-wrap').appendChild(t);
    setTimeout(() => t.remove(), 3100);
  }

  banner(text, kind) {
    const b = $('banner');
    b.className = '';
    void b.offsetWidth;
    b.textContent = text;
    b.className = 'show ' + (kind || '');
  }

  setDealerLine(text) {
    const d = $('dealer');
    const line = $('dealer-line');
    if (!text) { d.classList.add('hidden'); return; }
    d.classList.remove('hidden');
    line.textContent = text;
    line.classList.remove('show');
    void line.offsetWidth;
    line.classList.add('show');
  }

  setConn(status) {
    const c = $('conn');
    const txt = $('conn-text');
    c.classList.remove('bad', 'off');
    if (status === 'online') { txt.textContent = 'live'; }
    else if (status === 'reconnecting') { c.classList.add('bad'); txt.textContent = 'reconnecting'; }
    else { c.classList.add('off'); txt.textContent = 'offline'; }
  }

  setMuted(m) {
    this.muted = m;
    $('menu-sound').textContent = m ? 'Off' : 'On';
    $('menu-sound').classList.toggle('on', !m);
  }

  /* ── lobby ────────────────────────────────────────────────────────────── */
  renderLobby(room, you) {
    this.roomCode = room.code;
    // `you` may arrive as the welcome object or as a bare id; ui.you is
    // always the id string, because every other comparison depends on it.
    const youObj = you && typeof you === 'object' ? you : { id: you };
    this.you = youObj.id;
    this.isHost = !!(youObj.isHost) || room.hostId === youObj.id;
    const youId = youObj.id;
    $('room-code').textContent = room.code;
    if (navigator.share) $('btn-share').hidden = false;

    const seats = $('lobby-seats');
    seats.innerHTML = '';
    room.players.forEach((p) => {
      const c = el('div', 'seat-card' + (p.id === room.hostId ? ' host' : '') + (p.id === youId ? ' me' : ''));
      c.style.setProperty('--seat', p.colour);
      c.innerHTML =
        `<div class="pc-av">${AVATAR[p.avatar] || AVATAR.fedora}</div>
         <div style="min-width:0">
           <div class="nm">${esc(p.name)}${p.id === youId ? ' <span class="you">YOU</span>' : ''}</div>
           <div class="sub">${p.isBot ? 'regular' : (p.id === room.hostId ? 'host' : 'player')}</div>
         </div>`;
      if (this.isHost && p.id !== youId) {
        const k = el('button', 'kick', '×');
        k.title = 'Remove';
        k.addEventListener('click', () => this.h.onKick && this.h.onKick(p.id));
        c.appendChild(k);
      }
      seats.appendChild(c);
    });
    for (let i = room.players.length; i < 6; i++) {
      const c = el('div', 'seat-card empty', `<div class="sub">empty seat</div>`);
      seats.appendChild(c);
    }

    const controls = $('lobby-controls');
    controls.innerHTML = '';
    const isHost = this.isHost;

    if (isHost) {
      controls.appendChild(this.settingsPanel(room));
      const seats = room.settings.seats || 4;
      const here = room.players.length;
      const humans = room.humans != null ? room.humans : here;
      const fillNote = humans === 1 && here < seats
        ? 'regulars fill the ' + (seats - here) + ' empty seats'
        : here + ' at the table — dealing as is';
      const start = el('button', 'big primary',
        `<b>Deal the shells</b><small>${fillNote}</small>`);
      start.addEventListener('click', () => this.h.onStart && this.h.onStart());
      controls.appendChild(start);

      const bots = el('button', 'big',
        `<b>Add a regular now</b><small>a bot, for an empty chair</small>`);
      bots.addEventListener('click', () => this.h.onAddBot && this.h.onAddBot());
      bots.hidden = here >= 6;
      controls.appendChild(bots);
    } else {
      const wait = el('div', 'hint', 'Waiting for the host to deal. Say something cruel in the meantime.');
      controls.appendChild(wait);
    }

    const hint = $('lobby-hint');
    hint.innerHTML = room.players.length < 2
      ? 'Send the link. Two is the minimum for a game.'
      : `${room.players.length} seated · ${room.humans} human${room.humans === 1 ? '' : 's'} · ${room.bots} bot${room.bots === 1 ? '' : 's'}`;

    $('scr-lobby').hidden = false;
    this.showScreen('lobby');
  }

  /* Host-only table configuration. Every pick is one tap and applies at once;
     the server validates against allowlists, so a rigged client can only
     ever choose cosmetics that exist. */
  settingsPanel(room) {
    const wrap = el('div', 'lobby-settings');
    const s = room.settings || {};
    const group = (label, opts, cur, key) => {
      const g = el('div', 'set-group');
      g.innerHTML = `<span class="set-label">${label}</span>`;
      const row = el('div', 'set-row');
      opts.forEach(([val, text]) => {
        const cat = key === 'map' ? 'maps' : key === 'weapon' ? 'weapons' : null;
        const owned = !cat || isUnlocked(cat, val);
        const b = el('button', 'chipset' + (cur === val ? ' on' : '') + (owned ? '' : ' locked'),
          text + (owned ? '' : ` <i class="price">${price(cat, val)}</i>`));
        b.type = 'button';
        b.addEventListener('click', () => {
          if (cat && !owned) {
            const res = unlock(cat, val);
            if (!res.ok) return this.toast('Need ' + res.need + ' more coins for that.', 'bad');
            this.toast('Unlocked ' + text + '.', '');
            this.renderLobby(this.room, { id: this.you, isHost: this.isHost });
          }
          this.h.onSettings && this.h.onSettings({ [key]: val });
        });
        row.appendChild(b);
      });
      g.appendChild(row);
      wrap.appendChild(g);
    };
    group('Seats', [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], s.seats || 4, 'seats');
    group('Clock', [[30, 'Fast'], [45, 'Normal'], [75, 'Relaxed'], [120, 'Chatty'], [0, 'Off']], s.turnSeconds == null ? 75 : s.turnSeconds, 'turnSeconds');
    group('Room', [['backroom', 'Backroom'], ['diner', 'Diner'], ['rooftop', 'Rooftop']], s.map || 'backroom', 'map');
    group('Gun', [['revolver', 'Revolver'], ['sawedoff', 'Sawed-off'], ['flintlock', 'Flintlock'], ['golden', 'Golden']], s.weapon || 'revolver', 'weapon');
    group('Chaos', [['chill', 'Chill'], ['standard', 'Standard'], ['chaos', 'Chaos']], s.chaos || 'standard', 'chaos');
    return wrap;
  }

  renderLobbyLog(entries) {
    const log = $('lobby-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = '';
    entries.slice(-24).forEach((e) => log.appendChild(this.chatNode(e)));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  /* ── the table ────────────────────────────────────────────────────────── */
  setGameVisible(on) {
    ['hud', 'hand', 'chat-toggle'].forEach((id) => $(id).classList.toggle('hidden', !on));
    if (!on) $('chat').classList.add('hidden');
    if (on && this.currentScreen === 'lobby') this.showScreen(null);
    if (!on) this.cards.forEach((c) => c.remove());
    if (!on) this.cards.clear();
  }

  applyState(msg) {
    this.state = msg.view;
    this.you = msg.you || this.you;
    this.priv = msg.priv || this.priv;
    if (msg.dealerLine) this.setDealerLine(msg.dealerLine);

    const v = msg.view;
    const me = v.players.find((p) => p.id === this.you) || null;
    this.me = me;

    $('round-num').textContent = v.round;
    this.renderMag(v.mag);
    this.renderHand();
    this.renderCards(v);
    this.updateClocks(v);
  }

  renderMag(mag) {
    if (!mag) return;
    $('mag-live').textContent = mag.live;
    $('mag-blank').textContent = mag.blank;
    $('mag-left').textContent = mag.remaining;
    const wrap = $('mag-shells');
    const total = mag.size;
    if (wrap.childElementCount !== total) {
      wrap.innerHTML = '';
      for (let i = 0; i < total; i++) wrap.appendChild(el('div', 'mag-shell'));
    }
    // Order is deliberately NOT the firing order: live and blank are shuffled
    // into a stable-looking pattern so the strip cannot leak the sequence.
    const slots = [];
    for (let i = 0; i < mag.live; i++) slots.push('live');
    for (let i = 0; i < mag.blank; i++) slots.push('blank');
    const order = seededOrder(total, mag.size);
    const mapping = [];
    order.forEach((slotIdx, i) => { if (i < slots.length) mapping[slotIdx] = slots[i]; });
    for (let i = 0; i < total; i++) {
      const node = wrap.children[i];
      const kind = i < mag.spent ? 'spent' : (mapping[i] || 'blank');
      node.className = 'mag-shell' + (kind === 'live' ? ' live' : '') + (kind === 'spent' ? ' spent' : '');
    }
  }

  renderCards(v) {
    const wrap = $('cards');
    const count = v.players.length;
    const seen = new Set();
    v.players.forEach((p, i) => {
      seen.add(p.id);
      let card = this.cards.get(p.id);
      if (!card) {
        card = el('div', 'pcard');
        card.innerHTML =
          `<div class="pc-body">
             <div class="pc-av"></div>
             <div class="pc-main">
               <div class="pc-name"></div>
               <div class="hearts"></div>
               <div class="pc-badges"></div>
             </div>
           </div>
           <div class="pc-items"></div>`;
        card.addEventListener('click', () => {
          if (this.targeting) this.targetChosen(p.id);
        });
        card.style.opacity = '0';
        wrap.appendChild(card);
        this.cards.set(p.id, card);
      }
      const isMe = p.id === this.you;
      const isTurn = v.turnId === p.id;
      card.className = 'pcard'
        + (isMe ? ' me' : '')
        + (p.isBot ? ' bot' : '')
        + (isTurn ? ' turn' : '')
        + (p.alive ? '' : ' dead')
        + (this.targeting && this.validTarget(p.id) ? ' targetable' : '')
        + (this.pickedTarget === p.id ? ' selected' : '');
      card.style.setProperty('--seat', p.colour);
      card.dataset.pid = p.id;

      card.querySelector('.pc-av').innerHTML = AVATAR[p.avatar] || AVATAR.fedora;
      card.querySelector('.pc-name').innerHTML =
        esc(p.name) + (isMe ? ' <span class="you">YOU</span>' : '');

      card.querySelector('.hearts').innerHTML = hearts(p.hp, p.maxHp);
      const badges = [];
      if (!p.alive) badges.push('<span class="badge out">out</span>');
      if (p.cuffed) badges.push('<span class="badge cuffed">tied up</span>');
      if (p.sawed) badges.push('<span class="badge sawed">sawed ×2</span>');
      if (p.isBot && !p.connected) badges.push('<span class="badge off">away</span>');
      if (p.spectating) badges.push('<span class="badge off">watching</span>');
      card.querySelector('.pc-badges').innerHTML = badges.join('');

      card.querySelector('.pc-items').innerHTML =
        p.items.length ? p.items.map((it) => `<span class="chip small" title="${esc(ITEM_NAME(it))}">${ITEM_ICON[it]}</span>`).join('')
                       : '';
      card._player = p;
      card._index = i;
      card._count = count;
      card._w = card.offsetWidth || card._w || 210;
      card._h = card.offsetHeight || card._h || 92;
    });
    for (const [id, node] of this.cards) {
      if (!seen.has(id)) { node.remove(); this.cards.delete(id); }
    }
    this.layout();
  }

  /* Project each seat and move its card. Called every frame from the render
     loop, which is why it only touches transform — and why seat sizes are
     cached at build time instead of being measured 60 times a second.
     Positions are clamped to the viewport: a card anchored to a seat behind
     the camera would otherwise live forever half off a phone screen. */
  layout(projector) {
    if (!this.cards.size) return;
    const fn = projector || this.projector;
    if (!fn) return;
    this.projector = fn;
    const vw = window.innerWidth, vh = window.innerHeight;
    const top = 92;
    const bottom = vh - (vw <= 760 ? 168 : 148);
    for (const card of this.cards.values()) {
      const p = fn(card._index, card._count);
      if (!p || !p.visible) { card.style.opacity = '0'; continue; }
      const w = card._w || 210, h = card._h || 92;
      const x = Math.round(Math.min(vw - w / 2 - 8, Math.max(w / 2 + 8, p.x)));
      const y = Math.round(Math.min(bottom - h / 2, Math.max(top + h / 2, p.y)));
      card.style.opacity = '1';
      card.style.transform = `translate(-50%,-50%) translate(${x}px, ${y}px)`;
      card.style.zIndex = String(1000 - Math.round(p.depth * 100));
    }
  }

  renderHand() {
    const v = this.state;
    if (!v) return;
    const me = v.players.find((p) => p.id === this.you);
    const hand = $('hand');
    if (!me) return;

    const isTurn = v.turnId === this.you && v.phase === 'turn';
    const who = $('hand-who');
    const current = v.players.find((p) => p.id === v.turnId);
    who.className = 'who' + (isTurn ? ' yours actor' : '');
    if (v.phase !== 'turn') who.textContent = 'The table is settling';
    else if (isTurn) who.textContent = 'Your move';
    else if (current) who.textContent = current.name + (current.isBot ? ' is deciding' : ' is deciding') + '…';

    $('hand-lives').innerHTML = hearts(me.hp, me.maxHp);
    hand.classList.toggle('spectator', !me.alive);

    const holder = $('hand-items');
    holder.className = 'items' + (me.items.length ? '' : ' empty');
    const sig = me.items.join(',') + '|' + (isTurn ? 1 : 0) + '|' + (this.armedItem || '');
    if (holder._sig !== sig) {
      holder._sig = sig;
      holder.innerHTML = '';
      me.items.forEach((it, idx) => {
        const b = el('button', 'item' + (this.armedItem === it ? ' armed' : ''),
          `${ITEM_ICON[it]}<span class="tip"><b>${esc(ITEM_NAME(it))}</b>${esc(ITEM_BLURB(it))}</span>`);
        b.type = 'button';
        b.disabled = !isTurn;
        b.title = ITEM_NAME(it);
        b.addEventListener('click', () => this.useItem(it));
        b.addEventListener('mouseenter', () => {
          if (!isTurn) return;
          this.armedItem = it;
          holder.querySelectorAll('.item').forEach((n, i) => n.classList.toggle('armed', me.items[i] === it));
        });
        holder.appendChild(b);
      });
    }

    const selfBtn = $('btn-self');
    const otherBtn = $('btn-other');
    selfBtn.disabled = !isTurn;
    otherBtn.disabled = !isTurn;

    // the odds line: what a reasonable person would compute
    const odds = this.oddsLine();
    $('self-odds').textContent = odds;
    otherBtn.classList.toggle('armed', this.targeting);
    const others = v.players.filter((p) => p.alive && p.id !== this.you);
    $('other-hint').textContent = this.targeting
      ? (others.length ? 'tap a player' : 'nobody left')
      : (others.length + ' standing');
    $('other-hint').textContent = this.targeting ? 'tap somebody' : 'pick a target';

    if (this.targeting) this.highlightTargets();
  }

  oddsLine() {
    const v = this.state;
    if (!v || !v.mag) return '—';
    const mag = v.mag;
    if (!mag.remaining) return 'the magazine is empty';
    const priv = this.priv || {};
    let live = priv.remainingLive;
    let blank = priv.remainingBlank;
    if (live == null) { live = mag.live; blank = mag.blank; }
    const pct = Math.round((live / mag.remaining) * 100);
    if (priv.peek && priv.peek.index === mag.spent) {
      return priv.peek.shell === 'live' ? 'the chamber is LIVE' : 'the chamber is BLANK';
    }
    return pct + '% live';
  }

  /* ── actions ──────────────────────────────────────────────────────────── */
  onSelf() {
    const v = this.state;
    if (!v || v.turnId !== this.you || v.phase !== 'turn') return;
    if (this.targeting) { this.targeting = false; this.clearTargetHighlight(); this.renderHand(); return; }
    this.h.onAct && this.h.onAct({ type: 'shoot', target: this.you });
  }

  onOther() {
    const v = this.state;
    if (!v || v.turnId !== this.you || v.phase !== 'turn') return;
    const others = v.players.filter((p) => p.alive && p.id !== this.you);
    if (!others.length) return this.toast('Nobody left to shoot.', 'bad');
    if (others.length === 1 && !this.targeting) return this.targetChosen(others[0].id);
    this.targeting = !this.targeting;
    this.renderHand();
    this.renderCards(v);
  }

  targetChosen(id) {
    this.targeting = false;
    this.pickedTarget = null;
    this.clearTargetHighlight();
    this.renderHand();
    if (this.state) this.renderCards(this.state);
    this.h.onAct && this.h.onAct({ type: 'shoot', target: id });
  }

  validTarget(id) {
    const v = this.state;
    if (!v) return false;
    const p = v.players.find((x) => x.id === id);
    if (!p || !p.alive) return false;
    if (this.armedItem) {
      const spec = ITEM_KIND(this.armedItem);
      return spec === 'target' && id !== this.you;
    }
    return id !== this.you;
  }

  highlightTargets() {
    for (const [id, card] of this.cards) {
      card.classList.toggle('targetable', this.targeting && this.validTarget(id));
    }
    $('cards').style.pointerEvents = this.targeting ? 'auto' : 'none';
    for (const card of this.cards.values()) card.style.pointerEvents = this.targeting ? 'auto' : 'none';
  }
  clearTargetHighlight() {
    for (const card of this.cards.values()) {
      card.classList.remove('targetable', 'selected');
      card.style.pointerEvents = 'none';
    }
  }

  useItemBySlot(i) {
    const me = this.me;
    if (!me || !me.items[i]) return;
    this.useItem(me.items[i]);
  }

  useItem(item) {
    const v = this.state;
    if (!v || v.turnId !== this.you || v.phase !== 'turn') return;
    const kind = ITEM_KIND(item);
    if (kind === 'target') {
      const others = v.players.filter((p) => p.alive && p.id !== this.you);
      if (!others.length) return this.toast('Nobody to point it at.', 'bad');
      if (others.length === 1) return this.h.onAct && this.h.onAct({ type: 'item', item, target: others[0].id });
      this.armedItem = item;
      this.targeting = true;
      this.toast('Pick somebody for the ' + ITEM_NAME(item) + '.');
      this.renderHand();
      this.renderCards(v);
      return;
    }
    this.armedItem = null;
    this.h.onAct && this.h.onAct({ type: 'item', item });
  }

  /* ── clock ────────────────────────────────────────────────────────────── */
  setTurnClock(seconds, total) {
    const node = $('turn-clock');
    if (seconds == null) { node.hidden = true; return; }
    node.hidden = false;
    $('turn-clock-num').textContent = Math.max(0, Math.ceil(seconds));
    node.classList.toggle('warn', seconds <= 10);
  }
  updateClocks() {}

  /* ── chat ─────────────────────────────────────────────────────────────── */
  chatNode(e) {
    if (e.system) return el('div', 'chat-msg sys', esc(e.text));
    return el('div', 'chat-msg', `<b style="color:${esc(e.colour || '#e8b04b')}">${esc(e.name)}</b> ${esc(e.text)}`);
  }

  pushChat(entry, context) {
    const log = context === 'lobby' ? $('lobby-log') : $('chat-log');
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(this.chatNode(entry));
    while (log.childElementCount > 80) log.firstChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;

    if (context !== 'lobby' && entry.system !== true && entry.id !== this.you && !this.chatOpen) {
      this.unread++;
      const badge = $('chat-badge');
      badge.hidden = false;
      badge.textContent = this.unread > 9 ? '9+' : this.unread;
    }
  }

  toggleChat(force) {
    this.chatOpen = force != null ? force : !this.chatOpen;
    $('chat').classList.toggle('hidden', !this.chatOpen);
    if (this.chatOpen) {
      this.unread = 0;
      $('chat-badge').hidden = true;
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
      if (window.innerWidth > 760) $('chat-input').focus();
    }
  }

  floatReaction(emoji, opts) {
    const node = el('div', 'float', emoji);
    const o = opts || {};
    node.style.left = (o.x != null ? o.x : 50 + (Math.random() * 24 - 12)) + '%';
    node.style.top = (o.y != null ? o.y : 58 + Math.random() * 14) + '%';
    node.style.animationDelay = (Math.random() * 0.12) + 's';
    $('floats').appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }

  /* ── game over ────────────────────────────────────────────────────────── */
  renderOver(winnerId, payday) {
    const v = this.state;
    if (!v) return;
    const won = winnerId === this.you;
    const winner = v.players.find((p) => p.id === winnerId);
    const h2 = $('over-title');
    h2.className = won ? 'win' : 'lose';
    h2.textContent = won ? 'YOU WALK OUT UPRIGHT' : (winner ? winner.name.toUpperCase() + ' WALKS OUT UPRIGHT' : 'EVERYBODY LOSES');

    const me = v.players.find((p) => p.id === this.you);
    const myPos = v.players.filter((p) => p.alive).length;
    $('over-sub').innerHTML = (won
      ? 'The house congratulates you in the way it congratulates anyone: by loading another magazine.'
      : 'You lasted ' + v.round + ' magazine' + (v.round === 1 ? '' : 's') + '. The floor is comfortable once you commit to it.')
      + (payday ? ` <span class="payday">+${payday} ◉</span>` : '');

    const ranked = v.players.slice().sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return (b.stats.kills * 100 + b.hp) - (a.stats.kills * 100 + a.hp);
    });
    $('over-stats').innerHTML = ranked.map((p, i) => `
      <div class="stat-row${i === 0 && p.alive ? ' first' : ''}${p.alive ? '' : ' dead'}">
        <div class="pos">${i + 1}</div>
        <div class="nm">${esc(p.name)} <i>${p.id === this.you ? '(you)' : p.isBot ? '(regular)' : ''}</i></div>
        <div class="kills">${p.stats.kills ? p.stats.kills + ' kill' + (p.stats.kills === 1 ? '' : 's') : ''}</div>
        <div class="hp">${hearts(p.hp, p.maxHp)}</div>
      </div>`).join('');

    const isHost = this.room && this.room.hostId === this.you;
    $('btn-rematch').hidden = !isHost;
    $('btn-rematch').querySelector('small').textContent = isHost ? 'same table, new magazine' : 'waiting for the host';
    $('scr-over').hidden = false;
    this.showScreen('over');
  }

  /* ── menu ─────────────────────────────────────────────────────────────── */
  openMenu() {
    const room = this.room;
    const seats = $('menu-seats');
    seats.innerHTML = '';
    if (room) {
      room.players.forEach((p) => {
        const c = el('div', 'stat-row');
        c.innerHTML = `<div class="pos">${p.isBot ? '◊' : '●'}</div>
          <div class="nm">${esc(p.name)}${p.id === this.you ? ' <i>(you)</i>' : ''}</div>
          <div class="kills">${p.connected === false ? 'away' : ''}</div>
          <div class="hp"></div>`;
        if (room.hostId === this.you && p.id !== this.you) {
          const k = el('button', 'kick', '×');
          k.style.color = 'var(--muted)';
          k.addEventListener('click', () => { this.h.onKick && this.h.onKick(p.id); this.openMenu(); });
          c.appendChild(k);
        }
        seats.appendChild(c);
      });
    }

    const clock = $('menu-clock');
    clock.innerHTML = '';
    [['Fast', 30], ['Normal', 45], ['Relaxed', 75], ['Chatty', 120], ['Off', 0]].forEach(([label, val]) => {
      const b = el('button', room && room.settings.turnSeconds === val ? 'on' : '', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.h.onSettings && this.h.onSettings({ turnSeconds: val });
        this.openMenu();
      });
      clock.appendChild(b);
    });
    clock.querySelectorAll('button').forEach((b) => { b.disabled = !this.isHost; });

    $('menu-sound').textContent = this.muted ? 'Off' : 'On';
    $('menu-host-row').hidden = !this.isHost;

    $('scr-menu').hidden = false;
    this.showScreen('menu');
  }
}

/* ── helpers ────────────────────────────────────────────────────────────── */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hearts(hp, maxHp) {
  let out = '';
  const total = Math.max(maxHp, hp);
  for (let i = 0; i < total; i++) out += `<span class="heart${i < hp ? '' : ' off'}"></span>`;
  return out;
}

const ITEM_META = {
  puff: { name: 'Just One Puff', blurb: 'One life back.', kind: 'instant' },
  glasses: { name: 'Reading Glasses', blurb: 'See the shell in the chamber.', kind: 'instant' },
  brew: { name: 'Liquid Courage', blurb: 'The chambered shell falls out, unspent. Everyone sees it.', kind: 'instant' },
  saw: { name: 'Handsaw', blurb: 'Your next shot deals 2.', kind: 'instant' },
  ties: { name: 'Zip Ties', blurb: 'They miss their next turn.', kind: 'target' },
  refund: { name: 'Petty Refund', blurb: 'Flip the chambered shell. Live becomes blank. Blank becomes live.', kind: 'instant' },
  pill: { name: 'Mystery Pill', blurb: 'Fifty-fifty: two lives back, or one gone.', kind: 'instant' },
  burner: { name: 'Burner Phone', blurb: 'A stranger tells you one future shell.', kind: 'instant' },
  sticky: { name: 'Sticky Fingers', blurb: 'Take a random item off somebody else.', kind: 'target' }
};
export const ITEM_NAME = (id) => (ITEM_META[id] && ITEM_META[id].name) || id;
export const ITEM_BLURB = (id) => (ITEM_META[id] && ITEM_META[id].blurb) || '';
export const ITEM_KIND = (id) => (ITEM_META[id] && ITEM_META[id].kind) || 'instant';

/* A deterministic shuffle so the shell strip looks arranged rather than random
   but never actually carries the magazine order. */
function seededOrder(n, salt) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  let s = (n * 2654435761 + salt * 40503) >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
