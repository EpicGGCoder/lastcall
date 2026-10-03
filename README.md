# LAST CALL

**A shotgun party game for 2–6 friends.** One table, one revolver, one magazine
loaded with a mix of live rounds and blanks. On your turn you point the gun at
somebody — or at yourself. A blank against your own chin keeps the turn. The
last person still standing walks out upright.

Create a room, send the four-letter code, and the table fills up. Players who
die stay at the table as spectators with a chat box and a reaction button,
which is exactly as dangerous as it sounds.

- **No installs, no accounts.** A browser tab is the whole client.
- **Phone and desktop alike.** The layout is built thumb-first.
- **Light by design.** The 3D table is hand-written WebGL: a few thousand
  triangles, one point light, one 128×128 texture. No engine, no asset
  downloads, no build step to play.
- **Server-authoritative.** The shell order never leaves the server; the
  client only ever sees counts. Cheating requires modifying the server.

---

## Run it

```bash
node server/index.js          # that's the whole install: zero dependencies
```

Then open `http://localhost:8787`, create a room, and share the code (or the
invite link) with your friends. Everyone needs to be able to reach that
address — on a laptop behind NAT, point a tunnel at port 8787
(`ssh -R`, tailscale funnel, cloudflared, ngrok — anything).

Environment:

| variable | default   | meaning                        |
|----------|-----------|--------------------------------|
| `PORT`   | `8787`    | HTTP + WebSocket port          |
| `HOST`   | `0.0.0.0` | bind address                   |

Docker, if that is your religion:

```bash
docker build -t lastcall . && docker run -p 8787:8787 lastcall
```

### The single-file edition

```bash
node tools/build-single.js    # client/ -> single/lastcall.html (≈168 KB)
```

`single/lastcall.html` is the entire client — styles, scripts, icons and
manifest inlined as data URIs. Attach it to a message, drop it on any static
host, or open it straight off the filesystem. It still needs a socket server
to play with others; point it at one with `?server=wss://your.host/ws`.
When this file exists, `node server/index.js` serves it at `/`.

---

## How a night goes

1. **The magazine.** Each round the dealer loads `min(10, 4 + players)` shells,
   somewhere between 34% and 66% live. Everyone sees the counts. Nobody sees
   the order — not even the server's clients, which only ever receive counts.
2. **Your turn.** Shoot somebody else, or shoot yourself. A **blank against
   yourself keeps your turn** — the entire emotional economy of the game runs
   on that sentence. A live round against yourself does not.
3. **Items.** Two to four per round, dealt face-up to you alone: zip ties, a
   handsaw, reading glasses that peek at the chamber, a beer that ejects the
   chambered shell, a pill that is either medicine or poison, a burner phone
   that rings with news of one future shell, sticky fingers, a petty refund
   that flips the chamber, and one puff of something regrettable.
4. **Lives.** Three each at small tables, two at five or six. Lose them all
   and you are out — but you keep your seat, your chat, and your reactions.
5. **Escalation.** Magazines reload, rounds stack, and the dealer's narration
   gets progressively less professional.

**Controls:** tap/click, or `Space`/`S` shoot yourself · `F` shoot someone ·
`1–4` use item · `T` chat · `Esc` cancel.

---

## What is in the box

```
server/
  index.js     HTTP + upgrade routing, the message switch
  ws.js        a zero-dependency RFC 6455 WebSocket server
  rooms.js     the Hub: rooms, seats, tokens, timers, bots, sweepers
  game.js      the pure rules engine (no I/O, fully testable)
  bots.js      personas that play the odds and miscalculate on purpose
  lines.js     the dealer's voice, chosen server-side so every player
               reads the same joke at the same moment
client/
  index.html   the shell: canvas + DOM cards + five screens
  style.css    dark brass, fluid type, safe-area aware
  js/math.js   column-major matrices, projection, xorshift
  js/meshes.js all geometry, generated at boot (no model files exist)
  js/glkit.js  two shader programs, buffer cache, adaptive resolution
  js/scene.js  the room: table, lamp, gun, shell ring, dust, camera rig
  js/audio.js  every sound, synthesized live in WebAudio (no audio files)
  js/net.js    the socket: reconnect with backoff, session tokens, queue
  js/ui.js     player cards anchored to projected 3D seats, chat, screens
  js/main.js   the director: events become beats, then the state lands
single/        the built one-file edition
tools/         build + three test harnesses + an independent WS client
```

Design decisions worth knowing:

- **Players are DOM, not pixels.** Cards are ordinary HTML anchored to
  projected seat positions every frame. The browser does text rendering,
  reflow and accessibility; WebGL only draws the room.
- **The shell ring never encodes order.** A spent shell is removed at random
  from the pool of matching colour, so the table display cannot leak the
  sequence even by accident.
- **Events before state.** The server ships a batch of events together with
  the resulting state; the client plays the beats (bang, flash, camera shove,
  dealer line) and only then reveals the new state. Health bars do not drop
  before the gun goes off.
- **The dealer speaks once.** Lines are picked server-side so all clients
  show the same joke for the same event.

---

## Tests

```bash
npm test                  # engine invariants + the raw wire protocol
npm run test:engine       # 2,000 random full matches, invariant-checked
npm run test:wire         # speaks RFC 6455 through an independent client
npm run test:browser      # two real browsers play a match, incl. reconnect
```

The browser harness needs `playwright-core` and a chromium:

```bash
npm i --no-save playwright-core && npx playwright install chromium-headless-shell
```

---

## Hosting it for real

The client is static and happy anywhere. **The socket server needs a process
that stays alive** — plain Node, a container, Fly.io, Railway, Render, a VPS,
a Raspberry Pi in a cupboard. Serverless functions (Vercel, Netlify, Lambda)
cannot hold a WebSocket open, so they are the wrong home for `server/`;
host the static `single/lastcall.html` there if you like and point it at a
socket server elsewhere with `?server=`.

The server keeps rooms in memory and sweeps idle ones (30 min in play,
90 min in lobby, 5 min for a disconnected seat). One process, one table
service; scale by running one per region and sharing invite links.
