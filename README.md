# FRONTLINE

A real-time strategy game commanded entirely through cards. Modern-warfare theme,
low-poly 3D, one screen, no scrolling, no unit micro — **you play cards (click or
drag onto the battlefield) and collect resources. That's the whole interface.**

- Cards flow into an 8-slot hand every ~3 seconds and expire 25 seconds later —
  a fluid deck cycled from your loadout. Drag a card onto the board to see a
  hologram of what you're placing; right-click cancels a held card.
- Cards place buildings (only on legal tiles, inside your territory — and every
  building you place extends that territory), deploy units, research army-wide
  upgrades, or call airstrikes. Extractors and derricks are one-click: they
  build themselves on the nearest free mine/field, and never deal into your
  hand while no site is available.
- Extractor/derrick production **pools up at the building — click the ¤/◉ badge
  that pops over it** to bank it (chips fly to your resource bar). A full silo
  stops producing, and raiders love an uncollected economy.
- Everything on the battlefield is autonomous: barracks/factories produce and push
  lanes, turrets hold ground, harvesters run convoys, units fight by behavior
  scripts (aggressive / defensive / raider / economic stances).
- Terrain is the strategy: gold mines and oil fields fund the war, forests give
  infantry cover, mountains block movement and line of sight, rivers funnel
  every push across the bridges. Three battle maps.
- Destroy the enemy HQ — but it shoots back: a medium command gun grinds down
  trickle attacks, so only a committed wave cracks a base, and your defensive
  units (rocket teams, garrisons) rush to any building under attack.
- No time limit. After 5:00 the draw accelerates; after 8:00 both sides start
  receiving free **Nuclear Strike** cards — one hit erases anything, HQs
  included. Long wars end in a flash, not a stopwatch.

## Modes

- **Campaign** — a Slay-the-Spire-style operation: branching node map (battles,
  elites, supply depots, field workshops, caches, encounters, a boss stronghold).
  Your deck grows via 3-choose-1 rewards and shops; you carry every card into
  battle. Many cards have **A/B sides** (Assault vs Garrison rifles, Tank vs
  Siege Tank, Barracks vs Commando School...) flippable only between battles,
  and the workshop forges permanent per-card upgrades. Lose your HQ once and
  the run is over.
- **Tutorial** — five short missions that introduce one system each, PvZ-style:
  real battles, minimal text, state-triggered hints.
- **Skirmish** — quick battles vs an AI commander, with a 16-card loadout editor,
  three opposing playstyles and a difficulty dial that scales the enemy's reflexes
  *and* its supply rate. A pre-deploy **briefing** previews the generated map (reroll
  it if the layout looks unfair) and the active modifiers; optional **match
  modifiers** (Blitz economy, Sudden Death, Heavy Metal) stack symmetrically for
  variety. Every match closes with a **graded field report** (S–F) and folds into a
  persistent **service record** — win streaks, win rate, fastest victory — with a
  one-tap rematch of the exact same battlefield.
- **Multiplayer (LAN)** — 1v1 over a local network in the desktop app. One player
  hosts (their screen shows the address); the other joins by IP. Each brings their
  own skirmish loadout, and the board orients to each commander's own HQ. Runs on
  **deterministic lockstep**: only card plays / collects / reissues cross the wire
  (a few bytes per action), both peers run the identical sim, and a rolling state
  checksum is traded to catch any divergence instantly. No server, no accounts.

## Run it

```
npm install
npm run dev        # play in the browser (Vite, http://localhost:5173)
npm test           # headless sim suite incl. full AI-vs-AI matches
npm run app        # run the desktop (Electron) shell against dist/ (run build first)
npm run mp:smoke   # live two-process LAN multiplayer smoke test (builds, hosts+joins)
npm run dist:win   # Windows build for Steam -> release/win-unpacked/
```

Multiplayer is desktop-only (it needs the Electron LAN sockets). To play across two
machines: launch the app on both, one picks **MULTIPLAYER (LAN) → HOST GAME** and
reads out the shown address, the other picks **JOIN GAME** and types it in. Default
port is `47615`. For a quick local test, host on one window and join `127.0.0.1`.

Balance lab (90 AI-vs-AI matches with win-rate grid):
PowerShell: `$env:BALANCE='1'; npx vitest run tests/balance.lab.test.ts`

## Architecture

```
src/sim/      deterministic 20 Hz fixed-step simulation — zero rendering deps
  map.ts        13x13 symmetric battlefield, 7 terrain types
  stats.ts      ALL balance numbers (units, buildings, damage matrix, economy)
  cards.ts      card + loadout definitions
  behavior.ts   autonomous unit/building behavior scripts
  ai.ts         the AI opponent (plays cards through the same API) + headless runner
  sim.ts        orchestrator: economy, hands, combat, escalation, win/loss
net/          deterministic-lockstep multiplayer
  protocol.ts   the tiny command schema (play / collect / reissue) + wire messages
  lockstep.ts   the tick engine: input-delay scheduling, command ordering, checksums
  checksum.ts   full state snapshot + 32-bit fingerprint for desync detection
  transport.ts  Transport interface, line framing, in-memory loopback (for tests)
  session.ts    host/join lobby handshake (agree on seed, map, loadouts, sides)
render/       Three.js layer: procedural low-poly meshes, FX, fixed iso camera
ui/           DOM HUD: card hand with TTL rings, resources, screens
game.ts       match loop: fixed-step sim + interpolated render + input
electron/     desktop shell for the Steam build (net.cjs = LAN TCP link; see steam.md)
```

The sim is seeded and deterministic: same seed + same inputs = identical match.
That makes headless testing, balance batches, replays, and **lockstep multiplayer**
(`src/net/`) all possible. The renderer consumes sim events and never mutates state.
The netcode is exercised by `tests/net.test.ts` / `tests/netlink.test.ts`: two peers
driven over an in-memory loopback, over a real TCP socket, and through the Electron
main-process link — asserted byte-identical at every tick.

## Audio

All SFX are synthesized at load by `src/audio/sfx.ts` (WebAudio, no assets, no
licensing risk): per-weapon gunfire, sized explosions, airstrike siren, card
deal/play/expire, collection, construction, upgrades, victory/defeat, alarms,
UI ticks — with per-sound throttling and pitch variance. `M` (or the 🔊 button)
mutes.

Prefer real recordings? Drop CC0 files at `public/sfx/<id>.ogg` (or .mp3/.wav)
and they replace the synth versions automatically — ids are listed in
`src/audio/sfx.ts` (`SfxId`). Recommended CC0 sources: kenney.nl audio packs,
the Sonniss GDC bundles.

## Tuning & content

- Every balance number lives in `src/sim/stats.ts`.
- New cards: add a def in `src/sim/cards.ts`, stats in `stats.ts`; behavior reuses
  the stance system.
- Art: meshes are procedural placeholders in `src/render/meshes.ts`, built to be
  swapped for GLTF assets without touching the sim.

See `steam.md` for the Steam shipping checklist.
