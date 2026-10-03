# LAST CALL — design doc

> *A shotgun, a table, and everyone's worst ideas.*

## Pitch
Buckshot Roulette, but it's a party game with your friends. A 4-6 player
free-for-all at a filthy bar table. The dealer loads a magazine with a **known
count** of live and blank shells — but never tells you the order. Take turns
pointing a shotgun at each other, or at yourself. Items make it worse.

Last one breathing wins.

## Why multiplayer changes the design
Buckshot Roulette is a 1v1 duel. That's a tense little puzzle. But the reason
people keep sharing the game is the *spectacle* — and spectacle is fifty times
better with an audience. So:

* **2-6 players, elimination, last alive wins.** Turn order is public, so
  alliances form and dissolve in thirty seconds.
* **Shooting yourself is the best move in the game.** A blank keeps your turn.
  Which means the funniest possible action is also the correct one, and that's
  the whole design in one sentence.
* **Eliminated players stay to watch.** No being sent to a menu. They heckle.
  They get a "haunt" button. This is the single cheapest retention feature in
  any party game and almost nobody builds it.

## The core loop
The dealer loads a magazine: *"4 live. 2 blank."* The count is public. The order
is not. Everybody knows the odds are drifting toward pain, and everybody has to
act anyway.

On your turn you point the shotgun at a player, or at your own head.

| you shot | result |
|---|---|
| yourself, blank | nothing happens, **you keep your turn** |
| yourself, live | you take the damage. That was a mistake. |
| someone else, blank | a click. The turn moves on. |
| someone else, live | damage. The turn moves on. |

## Items
Two things matter here: items are played on your turn but **don't end it**, and
the hand is capped at four. So every item is a decision about tempo, not just
power.

| item | what it does |
|---|---|
| **Just One Puff** | +1 life. For the health-conscious. |
| **Reading Glasses** | See the shell currently in the chamber. |
| **Liquid Courage** | Slug it. The chambered shell falls out unspent — and everyone sees what it was. |
| **Handsaw** | Next shot deals 2. The dealer does not clean it between uses. |
| **Zip Ties** | Someone misses their next turn. Not twice in a row, that's a house rule. |
| **Petty Refund** | Flip the chambered shell. Live becomes blank. Blank becomes live. |
| **Mystery Pill** | 50/50: +2 life, or -1 life. Expiry date illegible. |
| **Burner Phone** | A stranger tells you one future shell. |
| **Sticky Fingers** | Steal a random item off someone else. |

Three of these exist purely to create *moments*: the beer makes information
public and dangerous, the saw turns a known blank into a coin flip for everyone
watching, and the refund means the shell you counted on isn't the shell you get.

## The dealer
Every table has one. He narrates. He is not helpful.

* *"Four live. Two blank. I'd tell you the order, but where's the fun."*
* *"Shotgun's empty. Give me a minute."*
* *"That's one in the leg. Walk it off."*
* *"Nobody wins anything. You just keep going."*

## Round escalation
Magazine size grows with the table (6 shells for two players, 10 for six).
Item deal scales too: 2 items each in round one, 3 in round two, 4 after that.
Late-round tables get loud and stupid, which is exactly right.

## Presentation
Real 3D, cheaply. A custom WebGL renderer — no Three.js, no scene graph, no
asset pipeline. Roughly 6,000 triangles and one draw call per mesh:

* a filthy table, a break-action shotgun, a shell tray, a swinging bulb
* one point light with distance falloff and a flicker everyone can see
* dust motes drifting through the light, because it costs nothing and sells everything
* a camera that flies down the barrel when the gun goes off
* the players themselves are **DOM cards anchored to projected 3D positions** —
  crisp readable text, real 3D where the lighting matters

That hybrid is the trick that keeps this on a phone: no text in WebGL, no
geometry wasted on things that are conceptually a name and a number.

## Architecture
Server-authoritative, and the server knows nothing about graphics.

```
server/ws.js      minimal RFC6455 WebSocket server, ~200 lines, zero deps
server/game.js    pure game logic — injectable RNG, fully testable
server/rooms.js   room lifecycle, sessions, reconnect, bots
server/bots.js    AI opponents so a room is never empty
server/index.js   static file serving + ws upgrade + a health endpoint
```

The client renders whatever the server says, and animates the events it receives.
The server never trusts the client: turn ownership, item possession and phase are
all validated before anything happens.

The server also serves the client, so **one command runs the whole game**:

```bash
node server/index.js       # game + rooms at http://localhost:8787
```
