/* ============================================================================
   LAST CALL — browser harness
   ----------------------------------------------------------------------------
   Two real browser clients (one desktop, one phone-sized) play a complete
   match: create, join by code, lobby chat, reactions, a mid-match reconnect,
   and the game-over standings. Fails on any uncaught page error.

   Needs a server on :8787 and playwright-core with a chromium installed:
     npm i --no-save playwright-core
     npx playwright install chromium-headless-shell
     node tools/test-browser.js
   ========================================================================== */
let chromium;
try { chromium = require('playwright-core').chromium; }
catch (e) { chromium = require('/tmp/pw/node_modules/playwright-core').chromium; }

const URL = process.env.BASE_URL || 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, name, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  page.name = name;
  return page;
}

async function myTurn(page) {
  return page.$eval('#btn-self', (b) => !b.disabled).catch(() => false);
}

/* Check-and-click in one page-side step so a turn change mid-click cannot
   leave Playwright hammering a button that has since been disabled. */
async function takeShot(page) {
  return page.$eval('#hand', () => {
    const self = document.getElementById('btn-self');
    const other = document.getElementById('btn-other');
    if (self.disabled) return false;
    if (!other.disabled) other.click(); else self.click();
    return true;
  }).catch(() => false);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
  });

  const A = await newPage(browser, 'A', { width: 1280, height: 800 });
  const B = await newPage(browser, 'B', { width: 390, height: 844 });

  // ── A creates a room
  await A.goto(URL, { waitUntil: 'domcontentloaded' });
  await A.waitForSelector('#scr-title:not([hidden])', { timeout: 8000 });
  await A.screenshot({ path: '/tmp/shots/01-title.png' });
  await A.fill('#in-name', 'Vera');
  await A.click('#btn-create');
  await A.waitForSelector('#scr-lobby:not([hidden])', { timeout: 8000 });
  const code = await A.textContent('#room-code');
  console.log('room code:', code);
  if (!/^[A-Z0-9]{4}$/.test(code.trim())) throw new Error('bad room code: ' + code);

  // ── B joins by code (phone-sized)
  await B.goto(URL, { waitUntil: 'domcontentloaded' });
  await B.waitForSelector('#scr-title:not([hidden])', { timeout: 8000 });
  await B.fill('#in-name', 'Otis');
  await B.click('#btn-join-open');
  await B.waitForSelector('#join-row:not([hidden])', { timeout: 4000 });
  await B.fill('#in-code', code.trim());
  await B.click('#join-row button[type=submit]').catch(async () => { await B.press('#in-code', 'Enter'); });
  await B.waitForSelector('#scr-lobby:not([hidden])', { timeout: 8000 });

  await sleep(600);
  const seatsA = await A.$$eval('#lobby-seats .seat-card:not(.empty)', (n) => n.length);
  const seatsB = await B.$$eval('#lobby-seats .seat-card:not(.empty)', (n) => n.length);
  console.log('seats seen by A/B:', seatsA, seatsB);
  if (seatsA !== 2 || seatsB !== 2) throw new Error('lobby seats wrong');
  await A.screenshot({ path: '/tmp/shots/02-lobby.png' });

  // ── chat in the lobby
  await A.fill('#lobby-input', 'deal already, i have plans');
  await A.press('#lobby-input', 'Enter');
  await B.waitForFunction(() => document.querySelectorAll('#lobby-log .chat-msg').length > 0, { timeout: 5000 });
  console.log('lobby chat ok');

  // ── A starts the match
  await A.click('#lobby-controls button.primary');
  for (const p of [A, B]) {
    await p.waitForFunction(() => {
      const h = document.getElementById('hand');
      return h && !h.classList.contains('hidden');
    }, { timeout: 10000 });
  }
  console.log('match started on both clients');
  await sleep(2500);
  await A.screenshot({ path: '/tmp/shots/03-game-a.png' });
  await B.screenshot({ path: '/tmp/shots/04-game-b.png' });

  // ── reactions float over the table
  await B.click('#chat-toggle');
  await B.click('#chat-reacts button');
  await A.waitForSelector('#floats .float', { timeout: 5000 });
  console.log('reaction float ok');
  await B.click('#chat-toggle');

  // ── cards must stay inside the viewport on the phone
  const inView = await B.$$eval('#cards .pcard', (nodes) => nodes.every((n) => {
    const r = n.getBoundingClientRect();
    return r.left >= -2 && r.right <= window.innerWidth + 2 && r.top >= 0 && r.bottom <= window.innerHeight;
  }));
  console.log('phone cards in viewport:', inView);
  if (!inView) throw new Error('player card outside viewport on phone');

  const cardsA = await A.$$eval('#cards .pcard', (n) => n.length);
  const magA = await A.$$eval('#mag-shells .mag-shell', (n) => n.length);
  console.log('cards:', cardsA, 'mag slots:', magA);
  if (cardsA !== 2) throw new Error('expected 2 player cards, got ' + cardsA);

  // ── play it out: whoever's turn it is, shoot the other person
  const deadline = Date.now() + 180000;
  let shots = 0;
  while (Date.now() < deadline) {
    const overA = await A.$eval('#scr-over', (n) => !n.hidden).catch(() => false);
    const overB = await B.$eval('#scr-over', (n) => !n.hidden).catch(() => false);
    if (overA || overB) break;
    for (const p of [A, B]) {
      if (await takeShot(p)) { shots++; await sleep(1200); }
    }
    await sleep(350);
  }
  console.log('shots taken by test:', shots);

  // ── mid-match reconnect: B's page dies and comes back to the same seat
  const bNameBefore = await B.evaluate(() => localStorage.getItem('lastcall.session') ? 'yes' : 'no');
  console.log('B session stored:', bNameBefore);
  await B.reload({ waitUntil: 'domcontentloaded' });
  await B.waitForFunction(() => {
    const h = document.getElementById('hand');
    return h && !h.classList.contains('hidden') && document.querySelectorAll('#cards .pcard').length === 2;
  }, { timeout: 15000 });
  const backName = await B.$eval('#cards .pcard.me .pc-name', (n) => n.textContent.trim());
  console.log('B reconnected as:', backName);
  if (!/Otis/.test(backName)) throw new Error('reconnect lost the seat');
  await B.screenshot({ path: '/tmp/shots/08-reconnected.png' });

  // finish the match after the reconnect
  const deadline2 = Date.now() + 180000;
  while (Date.now() < deadline2) {
    const overA = await A.$eval('#scr-over', (n) => !n.hidden).catch(() => false);
    const overB = await B.$eval('#scr-over', (n) => !n.hidden).catch(() => false);
    if (overA && overB) break;
    for (const p of [A, B]) {
      if (await takeShot(p)) await sleep(1200);
    }
    await sleep(350);
  }
  await A.screenshot({ path: '/tmp/shots/05-late.png' });

  const overA = await A.$eval('#scr-over', (n) => !n.hidden).catch(() => false);
  const overB = await B.$eval('#scr-over', (n) => !n.hidden).catch(() => false);
  console.log('game over shown A/B:', overA, overB);
  if (!(overA && overB)) throw new Error('match did not finish in time');
  const title = await A.textContent('#over-title');
  const rows = await A.$$eval('#over-stats .stat-row', (n) => n.length);
  console.log('over title:', title.trim(), '| stat rows:', rows);
  await A.screenshot({ path: '/tmp/shots/06-over.png' });
  await B.screenshot({ path: '/tmp/shots/07-over-b.png' });

  // ── errors?
  for (const p of [A, B]) {
    const real = p.errors.filter((e) => !/favicon|manifest|WebAudio|autoplay/i.test(e));
    if (real.length) { console.log('ERRORS ON', p.name); real.forEach((e) => console.log('  ', e)); process.exitCode = 1; }
    else console.log(p.name, ': no page errors');
  }
  console.log(process.exitCode ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
