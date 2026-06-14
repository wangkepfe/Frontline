# FRONTLINE — 2D Design Guidebook

**Concept: THE OPERATIONS ROOM.** The battlefield is a commander's war table
(see `ART_DIRECTION.md` — the 3D bible). Everything 2D is *the rest of the
room*: the requisition cards in your hand, the briefing documents, the brass
console instruments at the table's edge, the acetate map on the far wall.
The player never looks at "a UI" — they handle the physical artifacts of a
mid-century field command, lit by the same lamp that lights the table.

This document governs every 2D surface: HUD, cards, card art, screens,
modals, iconography, type, and motion. It is the sibling of
`ART_DIRECTION.md` and shares its law: **nothing decorative, everything
manufactured.** When in doubt, an element should look like it was milled,
stamped, stenciled, or printed by a military contractor — never "designed
by a website".

---

## 1. Pillars

1. **One room, one light.** The UI inherits the table's materials and its
   golden-hour key light. Every plate carries a warm catch-light on its top
   edge and falls to shadow at the bottom — the same chamfer-highlight rule
   that makes the 3D miniatures read as manufactured objects.
2. **Chamfer is the signature.** No rounded rectangles. Every panel, card,
   button, and chip is an octagonal *cut plate* — 45° corner cuts, exactly
   like the chamfered boxes of the miniature kit. Circles are reserved for
   instruments (the TTL dial, campaign pins, emblems).
3. **Print, don't render.** Card art and emblems are *flat screen-print
   plates*: 2–3 tones per material family, hard shapes, zero gradients on
   the subject, light always from the upper-left. The look is a field-manual
   plate or a propaganda poster, not a 3D render and not clip-art. Emoji are
   banned from the product surface.
4. **Hierarchy by value, identity by hue.** Layout reads through a strict
   value ladder of warm charcoals and bone inks. Hue is *meaning only*:
   brass = action/value, olive = ready/own army, signal red = danger,
   cobalt vs vermilion = the two armies, slate = oil. If everything is
   colorful, nothing is.
5. **Motion is information** (same law as the 3D rig). A card animates when
   it is dealt, armed, expiring, or spent — states the sim caused. Panels
   never idle-pulse. The only always-on motions are the TTL dials (time is
   really passing) and warning blinks (the sim is really escalating).

---

## 2. Color system

All UI color derives from the world palette (`src/render/art/palette.ts`)
so the room and the table agree. Tokens live once, in `src/style.css :root`.
Never hex outside the token block.

### 2.1 Surfaces — "blackened steel" ladder (warm charcoal)

| Token        | Hex       | Use |
|--------------|-----------|-----|
| `--void`     | `#0c0c0a` | screen-dim scrims, the room beyond everything |
| `--s0`       | `#141412` | screen backdrops |
| `--s1`       | `#1b1b18` | recessed wells (map field, bars, art shadow) |
| `--s2`       | `#232420` | standard plate body (panels, cards, rows) |
| `--s3`       | `#2d2e29` | raised/hover plate |
| `--line`     | `#3a3c33` | hairline borders |
| `--line-hi`  | `#4d5042` | emphasized borders |
| `--edge-lit` | `rgba(236,228,196,0.16)` | top-edge catch light on plates |

### 2.2 Ink — "bone on charcoal"

| Token         | Hex       | Use |
|---------------|-----------|-----|
| `--ink-hi`    | `#efe9d3` | titles, values, anything the eye must land on |
| `--ink`       | `#cfc9b2` | primary text |
| `--ink-dim`   | `#8f8b76` | secondary text, labels |
| `--ink-faint` | `#5e5c4d` | disabled, keycaps, ghost marks |
| `--paper`     | `#d8cfae` | document surfaces (briefing headers, map paper) |
| `--paper-ink` | `#2b291f` | text printed on paper |

### 2.3 Accents — meaning, not decoration

| Token          | Hex       | Meaning |
|----------------|-----------|---------|
| `--brass`      | `#d8a93c` | primary action, selection, value, refit foil |
| `--brass-hi`   | `#f2c860` | brass hover / glints |
| `--brass-deep` | `#8a6f24` | brass borders/shadow tone |
| `--olive`      | `#aebf72` | own army, ready, positive |
| `--olive-deep` | `#5d6c35` | olive borders |
| `--gold-res`   | `#e5b84e` | gold resource (¤) |
| `--oil-res`    | `#94bad6` | oil resource (◉) |
| `--power-res`  | `#f7d36b` | electricity (⚡) |
| `--danger`     | `#e0563f` | invalid, expiring, damage, defeat |
| `--team-own`   | `#4585e8` | player army (cobalt enamel) |
| `--team-foe`   | `#e85d30` | enemy army (vermilion enamel) |

### 2.4 Card-kind coding

Each card kind owns a stripe color and an art atmosphere. Kind is readable
from the stripe alone at hand distance.

| Kind     | Stripe      | Art sky mood |
|----------|-------------|--------------|
| building | `#9b958a` concrete | amber work-light dusk |
| unit     | `#8fa05c` olive    | field dawn |
| upgrade  | `#d8a93c` brass    | medal on radial burst |
| tactic   | `#d96a45` signal   | red-alert sky |

Rules:
- Max one accent hue per component besides ink. (A card = kind stripe +
  brass cost emblem; that is the budget.)
- Team hues appear **only** where the two armies are compared (HQ bars,
  minimap, card art accent panels) — never as decoration.
- No pure black, no pure white anywhere (matches the 3D palette law).

---

## 3. Typography

One superfamily, three voices — all OFL, shipped in `public/fonts/`
(licenses alongside). Fallback chain ends in `Bahnschrift` (Windows' DIN)
so the unbundled dev page still reads military.

| Voice | Family | Use |
|-------|--------|-----|
| **Stencil** | `Saira Stencil One` | logotype, VICTORY/DEFEAT, nothing else |
| **Condensed** | `Saira Condensed` 500/600/700 | headings, labels, buttons, all numerals |
| **Text** | `Saira` 400/500/600 | descriptions, body copy |
| **Printer** | `Courier Prime` 400/700 (`--font-doc`, bundled OFL) | everything typed ON paper: proposal headlines, rules text, expiry stamps, serials, dossier lines. Never on hardware. |

```css
--font-stencil: 'Saira Stencil One', 'Bahnschrift', sans-serif;
--font-cond:    'Saira Condensed', 'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif;
--font-text:    'Saira', 'Segoe UI', system-ui, sans-serif;
--font-doc:     'Courier Prime', 'Courier New', 'Consolas', monospace;
```

Printer-voice law: micro type on paper is set **bold (700)** — the
typewriter "re-strike". Courier New's hairline strokes failed readability
at card sizes; Courier Prime keeps the typed character with ink that
holds. Regular 400 is reserved for paper text ≥ 11px (there is none on
cards today).

### 3.1 Scale & rules

| Token | Size / weight / tracking | Use |
|-------|--------------------------|-----|
| display-xl | 68px / Stencil / 0.18em | VICTORY, DEFEAT |
| display-lg | 58px / Stencil / 0.22em | menu logotype |
| h1 | 26px / Cond 700 caps / 0.18em | screen titles |
| h2 | 19px / Cond 700 caps / 0.14em | modal titles |
| label | 10.5px / Cond 600 caps / 0.22em | section labels, HQ tags |
| button | 13.5px / Cond 700 caps / 0.14em | all buttons |
| card-name | 11.5px / Cond 700 caps / 0.04em | card title plates |
| num | Cond 600 + `tabular-nums` | every counter, cost, clock |
| body | 13px / Text 400 / 1.5 lh | paragraphs, event copy |
| caption | 10.5px / Text 400 | row descriptions |
| micro | 9.5px / Text 400 / 1.3 lh | card rules text |

Rules:
- ALL-CAPS belongs to the Condensed voice only; never letterspace the Text
  voice, never set body copy in caps.
- Numerals are always tabular — counters must not jitter.
- Stencil appears at most once per screen. It is the bugle, not the band.

---

## 4. Geometry — the cut-plate language

### 4.1 The chamfer

Standard plate = octagon via `clip-path`, cut size by element class:

| Token | Cut | Use |
|-------|-----|-----|
| `--cut-sm` | 5px | chips, pills, keycaps, steppers |
| `--cut-md` | 8px | buttons, rows, cards |
| `--cut-lg` | 14px | panels, modals, screens' hero plates |

Implementation pattern (border + fill + catch light, all clip-safe):

```css
.plate {                       /* element bg = the BORDER color   */
  position: relative;
  clip-path: polygon(/* 8-pt octagon from --cut */);
  background: var(--line);
}
.plate::before {               /* inset fill = the plate FACE     */
  content: ''; position: absolute; inset: 1px;
  clip-path: polygon(/* same octagon, --cut − 1px */);
  background: var(--plate-fill, var(--s2));
}
.plate::after {                /* the key light catches the top edge */
  content: ''; position: absolute; inset: 1px 1px auto 1px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--edge-lit), transparent);
}
```

- Outer shadows on cut plates use `filter: drop-shadow(...)` (follows the
  clip), never `box-shadow`.
- Circles are allowed only for: TTL dial, campaign node pins, upgrade
  medals, the mute instrument.

### 4.2 Hardware details (use sparingly)

- **Corner ticks**: 45° bracket marks on the armed card and modal headers —
  the "targeting" mark. Pseudo-elements, 2px stroke, brass.
- **Segment teeth**: HQ armor bars carry 10% segment notches — instrument
  graduation, not decoration (they make damage legible).
- **Stencil bridges**: the logotype keeps Saira Stencil's bridges; never
  fake stencil gaps elsewhere.

---

## 5. Layout

### 5.1 Battle screen — the four staff posts

The projected battlefield is a **diamond** whose vertices touch the screen
edge midpoints; its four corners are empty by construction. The HUD is a
**command center**: each corner holds a staff post manned by one officer,
and the hand is split across three desks of two proposal documents each.

| Corner | Post | Officer | Contents |
|--------|------|---------|----------|
| top-left | console | **Statistics Officer** | profile card + gold/oil/power pills, clock, next-dispatch timer, both HQ gauges, mute/deck/menu |
| top-right | desk | **Strategy Advisor** | profile card + action slots 5–6 (tactics, orders, upgrades) + standing-order readout |
| bottom-left | desk | **Infrastructure Officer** | profile card + building slots 1–2 |
| bottom-right | desk | **Frontline Commander** | profile card + unit slots 3–4 |

- Every post is anchored by its officer's **profile plate** (`.profile`,
  256×~140 landscape, the §14 personnel file): portrait 120×130 on the
  left, then the typed dossier — post title (condensed caps), rank-and-
  name nameplate, role line — and, on the three desks, the **REISSUE
  button** (base 10 gold: discard the desk, two fresh proposals of that
  category arrive instantly). Every click also opens its own **+10
  surcharge tab** on that desk's price, and each tab cools off at 1
  gold/s on its own clock — so a single reroll is cheap, spam compounds
  fast, and the price always settles back to 10. The live price renders
  in the button (`<b class="cost">`), turning `--danger` red while any
  surcharge is hot. All corner boxes are LANDSCAPE — wider than
  tall — and share the 256px width so the corner columns align.
- The desk's two proposals **arc around the profile plate**, hugging the
  diamond's sloped edge: the corner document sits at the screen corner,
  the inner document steps 40px toward the field. The desks are CSS grids
  (`style.css .post.tr/.bl/.br`; the `.desk` mount is `display: contents`
  so slots place into the post grid).
- Slot indices are fixed (`cards.ts CATEGORY_SLOTS`); a card is dealt only
  to its own desk, and hotkeys 1–6 follow the indices left→right.
- **The chrome scales with the window**: everything is authored at
  1920×1080 and `main.ts fitUiScale()` sets `--uiscale =
  clamp(0.75, min(w/1920, h/1080), 3)`; style.css applies it as CSS
  `zoom` on `.post / #warn / #hint / #toast / .pause-box / .deck-box /
  #modal-body`. World badges (`.wbadge/.pwrbadge`) and `.flychip` instead
  scale their `font-size` by the same factor with em paddings — game.ts
  anchors them in screen px, and zoom would re-map those coordinates.
- The camera reserves only thin bands (`src/render/scene.ts`): top 30px
  (warning ticker), bottom 56px (hint/toast slips + the player HQ's
  breathing room), sides 14px. **Posts may overlap the battlefield's
  empty corner slopes — sanctioned**; the bands only protect the ticker,
  slips, and the map's cardinal vertices.
- Posts hug their corners at 10px insets.
- World badges (collect/power/boost) float in the playfield by design —
  they are *of the table*, not of the console.

### 5.2 Spacing

4px base grid: space tokens 4 / 8 / 12 / 16 / 24 / 32. Panel padding 24/32.
Buttons 10×22. Nothing sits on a half-pixel; transforms use whole px.

### 5.3 Screens

Full-screen states (menu, campaign, loadout, end) sit on `--s0` with the
**ops-map backdrop**: a faint engraved sector map (contours, grid, river,
sweep rings) at ≤6% ink, plus a heavy bottom vignette. The backdrop is one
shared SVG; screens must remain readable with it removed.

---

## 6. Iconography

Single-color inline SVG, drawn on a 24×24 grid, `currentColor`, filled
shapes (no strokes thinner than 2px), chunky silhouettes matching the
miniature language — exaggerate the identifying feature, exactly like the
3D readability table. One concept per glyph. Registry: `src/ui/icons.ts`.

Inventory (complete — if a glyph is not here, it does not exist):

| Group | Glyphs |
|-------|--------|
| resources | gold ingots, oil drop, power bolt, pop flag, clock |
| subjects | power plant, extractor headframe, derrick pumpjack, barracks tent, factory sawtooth, bunker dome, AT gun, rifle helmet, rocket tube, tank, howitzer, harvester hopper, buggy wheel, jet |
| upgrades | sabot dart, AP round, reactive plate, smoke shroud, long barrel |
| campaign | crossed sabers (battle), skull (elite), depot crate stack (shop), wrench (forge), cache box (loot), question seal (event), stronghold flag (boss) |
| system | padlock, mute on/off, flip arrows, check, play chevron, star, X, chevron-right |

Rules:
- Icons never carry their own color — the context tints them.
- In running text, resources keep their typographic marks: `¤` gold,
  `◉` oil, `⚡` power, `⛁` requisition. (These are glyphs, not emoji.)
- NATO-flavored abstraction is the ceiling: simplified, friendly, readable
  at 14px. No literal photorealism, no rounded-cute.

---

## 7. The card — a staff proposal document

The card is the franchise object — a **classified staff proposal**: a typed
requisition slip handed up by one of the corner-post officers, with a
printed field illustration. The fiction explains the mechanics: a proposal
is TYPED (printer voice), CLASSIFIED (red band), and TIMED (a proposal not
acted on is withdrawn — that is what the expiry stamp means). Paper is the
one bright surface in the operations room, which is exactly why the hand
reads at a glance.

### 7.1 Anatomy (256×158 — a LANDSCAPE requisition slip, wider than tall)

```
┌————————————————————————————————————┐  landscape sheet, 3px cut, --doc-paper fill
│▌TOP SECRET TRAINING PROPOSAL PN-290│  classification band (--doc-band, printer 700)
│ ┌─────────┐  BATTLE TANK         ★ │  headline — PRINTER VOICE (--font-doc 700 caps)
│ │⬡80      │  UNIT                  │  kind row (printer micro caps, kind-tinted)
│ │  [ART]  │  Spearhead armor.      │  rules text (printer 700 micro, ≤5 lines)
│ │     T2  │  Crushes infantry      │
│ └─────────┘  and buildings.        │
│ EXP 0:42                        ⑤ │  typed expiry countdown · hotkey keycap
└————————————————————————————————————┘
```

- **Paper**: `--doc-paper` gradient fill, 3px corner cut (a trimmed sheet,
  not a steel plate). The kind stripe survives on the left edge below the
  band; the `--kc` hue is darkened on paper for contrast.
- **Classification band** across the top — every element earns its ink:
  - **Classification chip** = the tech tier retold in paper voice:
    `RESTRICTED` (base) → `CONFIDENTIAL` (t0) → `SECRET` (t1) →
    `TOP SECRET` (t2); the nuke alone is `EYES ONLY`. Below SECRET the
    stamp is printer ink, not red — red is reserved for real secrets.
  - **Form title**, centered = the kind's paperwork: `BUILDING` /
    `TRAINING` / `R&D` / `STRATEGY` + `PROPOSAL`.
  - **Serial** in the kind's ledger: `RQ-` works requisition, `PN-`
    personnel, `RD-` research, `OP-` operations (deterministic hash —
    flavor only).
  - Width law: the longest band is the extractor slip (`CONFIDENTIAL` +
    `BUILDING PROPOSAL`) — check it before lengthening any title.
- **Print plate LEFT, typed copy RIGHT** — the landscape form's law. Art
  plate 112×98 at left (cost chips over its top-left corner, oil stacked
  below gold; tier tag on its bottom-right). Text column starts at
  x=127: headline (nowrap, must fit the longest name — GENERAL
  OFFENSIVE), kind row, then rules text.
- **Headline & body** are set in the printer voice (`--font-doc`,
  Courier Prime). The Saira voices remain the room's hardware; the paper
  is typewritten. This is the one surface allowed a second family. All
  card type is **700** (§3 re-strike law).
- **Expiry stamp** bottom-left under the art: `EXP 0:42`, typed, tabular.
  Under 6s it turns `--doc-red` and blinks — the only blinking element on
  a card. (The TTL dial is retired; circles stay for instruments.)
- **Rules text**: max 5 lines of micro text in the column. If it doesn't
  fit, the card text is wrong, not the type size.

### 7.2 States (all reachable, all designed)

| State | Treatment |
|-------|-----------|
| resting | paper sheet, plate shadow |
| hover | lift −8px, shadow deepens, art brightens 4% |
| **armed** | lift −12px, brass border, corner targeting ticks, soft brass halo pulse |
| **unaffordable** | 65% desaturate + 55% brightness; cost emblem tinted danger |
| **locked** (tier) | dark scrim + padlock + required-building icon + "REQUIRES POWER PLANT" microline |
| **expiring** | expiry stamp red blink + thin danger edge |
| **refit** | brass frame + foil star (campaign-permanent) |
| empty slot | dark chamfer ghost + hotkey digit (no paper — the desk is bare); the next-dispatch countdown lives in the statistics console |
| dealing | enters from below with −4° tilt, settles in 320ms |

### 7.3 Sizes

| Context | Size | Notes |
|---------|------|-------|
| hand | 256×158 | the spec above (× `--uiscale` in battle) |
| reward / shop (`.ccard`) | 256×158 | identical anatomy and size — one document everywhere |
| deck/editor rows | 40px row | icon plate + name + meta + cost chips |

---

## 8. Card art — the print grammar

Procedural SVG plates (`src/ui/cardArt.ts`), one per card subject.
ViewBox 120×88. **Composition is fixed** so the hand reads as a set:

1. **Sky** (top ~55%): two-stop vertical wash in the kind's atmosphere.
   One low sun/flare disc allowed. Nothing else in the sky except per-card
   signature props (smoke column, jet contrail, crane).
2. **Far band**: one terrain silhouette strip (ridge, treeline, dune) in a
   single deep tone.
3. **HERO** (center-low, ~70% width): the subject in chunky schematic
   profile — same silhouette exaggerations as the miniatures (tank = long
   gun + skirted tracks; howitzer = absurd elevated barrel; harvester =
   heaped hopper...). Built from 3 tones of its material family
   (lit top / base side / shade under) + near-black gun steel + **one
   cobalt team panel** + ≤3 bone glints. Units face RIGHT (toward the
   enemy); buildings sit in slight 3/4 elevation.
4. **Ground strip** (bottom ~12%): near-black soil band with sparse scrub
   ticks; the hero's contact shadow pools here.
5. **Print finish**: 4% halftone dot overlay + 8% corner vignette. These
   two filters are what make it "printed".

Rules:
- Zero outlines. Separation comes from value steps, exactly like the
  painted miniatures.
- Light from the upper-left, always. Lit tone on top faces only.
- Upgrades break the scheme deliberately: a brass **medal emblem** over a
  radial-burst field — they are decorations, not deployments.
- B-sides keep the base plate but shift the sky one step toward night,
  stamp twin brass chevrons lower-left, and add/remove one signature prop
  (Siege Tank: squat heavy barrel; Garrison Squad: sandbag parapet;
  Carpet Run: three bombs; Hunter Team: burning kill on the ridge;
  Creeping Barrage: bursts walking the crest; Gun Buggy: pintle MG;
  Armored Hauler: plow + slab skirts; Commando School: racked launch
  tubes; Motor Pool: buggy on the line + tire stack; Forward Post:
  signal mast with pennant).
- Deterministic: no randomness anywhere (`Math.random` is banned in art).

---

## 9. Components

- **Buttons** — cut plates. Primary = brass fill, `--paper-ink` text;
  secondary = `--s3` fill, ink text, brass on hover; danger = signal
  border. Press = +1px translate. Disabled = 40% opacity, no transform.
- **Chips** (cost, intel, refit) — `--cut-sm` plates with icon + number;
  gold chips brass-on-dark, oil chips slate-on-dark.
- **Console pills** (top bar) — instrument plates: icon, value, optional
  cap (`12/16`). Power flips to danger styling when demand > capacity.
- **HQ bars** — segmented armor gauges, team-colored fill on `--s1` well,
  chevron emblem at the outer end, label above.
- **World badges** — collect: brass-plate button with resource icon +
  amount, gentle bob (it is calling you); full = brighter pulse + `MAX`.
  Power-out: danger plate with slashed bolt, slow blink. Both sit above
  their building, never overlapping the hand band.
- **Toast** — danger document slip, bottom-center above the hand; 1.6s.
- **Hint** (tutorial) — olive briefing slip with a pointing chevron, same
  position; pulses its border only.
- **Modal** — briefing document: `--cut-lg` plate, header band with corner
  ticks + h2, body, action row right-aligned. Scrim = `--void` at 78%.
- **Campaign map** — acetate overlay: faint grid + contours; supply routes
  as dashed lines (active route = brass, animated dash crawl); nodes =
  circular stamped pins with type icon, state ring (locked = ghost, open =
  brass pulse, current = bone ring, cleared = dim check), boss pin 1.3×.
- **Minimap** (battle preview) — terrain in the world palette's exact
  hexes, HQ squares in team colors, thin bone frame.
- **Loadout rows** — icon plate (kind-tinted), name + kind/tier meta,
  desc, cost chips, `− n +` stepper; counts >0 get an olive edge.
- **Force overlay** (campaign loadout) — the deck as a wrapping grid of
  printed card faces, flip button beneath each pair card (label = the
  other side's name). Sorted on open, never re-sorted while open: a flip
  repaints its own cell in place so the grid holds still under the
  cursor; the next open sorts afresh.
- **Scrollbars** — 8px, `--s3` thumb on `--s1` track, square.

---

## 10. Motion

| Token | Value | Use |
|-------|-------|-----|
| `--t-fast` | 120ms | hovers, presses |
| `--t-med` | 200ms | state toggles, fades |
| `--t-slow` | 320ms | deals, screen/modal entries |
| ease standard | `cubic-bezier(0.2, 0.7, 0.3, 1)` | everything |
| ease deal | `cubic-bezier(0.18, 0.9, 0.24, 1.08)` | card deal settle |

The motion inventory (complete): card deal / hover / arm / expire-blink /
spend; resource chips flying to the console + counter tick-up; toast and
hint fades; modal and screen entries; node pulse on the one place you can
go; warning blinks; dash-crawl on the active supply route. Nothing else
moves. `prefers-reduced-motion` collapses all of it to opacity changes.

---

## 11. Readability & accessibility

- Body text ≥ 4.5:1 contrast on its plate; labels ≥ 3:1 at their size.
  (`--ink` on `--s2` ≈ 9:1; `--ink-dim` on `--s2` ≈ 4.6:1 — keep it so.)
- The hand must read at glance distance: name + cost + TTL legible at
  arm's length on a 1080p living-room screen (the "couch test").
- Never encode state in hue alone: locked adds a padlock, unaffordable
  dims AND tints the cost, expiring blinks AND reddens, teams differ in
  value as well as hue.
- Hit targets ≥ 24px; world badges ≥ 28px.
- All caps text never exceeds one line; rules text is sentence case.

---

## 12. Implementation map

| File | Owns |
|------|------|
| `src/style.css` | every token (§2–§5, §10) + every component style |
| `src/ui/icons.ts` | the §6 glyph registry (`icon(name)`) |
| `src/ui/cardArt.ts` | the §8 plates (`cardArt(cardId)`) |
| `src/ui/cardFace.ts` | the §7 document anatomy (one builder for every context) |
| `src/ui/officers.ts` | the §14 staff portraits (placeholder busts + roles) |
| `src/ui/hud.ts` | post/desk wiring, console values |
| `src/ui/campaignUi.ts` | campaign faces/rows/map/minimap |
| `index.html` | screen skeletons, the four posts, logotype lockup |
| `src/render/scene.ts` | the §5.1 band constants — keep in sync |
| `src/fonts/` | Saira woff2 + OFL licenses |

## 13. Do / Don't

- **Do** cut corners; **don't** round them.
- **Do** print flat tones; **don't** gradient a subject.
- **Do** spend brass on the one thing that matters; **don't** gild ranks
  of buttons.
- **Do** let charcoal breathe; **don't** fill every pixel with texture.
- **Do** blink what is dying (the expiry stamp); **don't** pulse what is
  merely waiting.
- **Do** draw a glyph; **don't** paste an emoji.
- **Do** match the table's palette; **don't** invent a hex outside
  `style.css :root`.

## 14. The staff officers (corner-post characters)

Each corner post is manned by one officer; the desk's proposals are "their"
documents. The painted portraits live in `src/ui/officers/<role>.png`
(generated from the §14.1 prompts, prepped by `electron/prep-officers.cjs`:
background keyed, tight-cropped to the bust, 256², bundled via vite import so
the hashed URLs survive the Electron `file://` build). The mount is
`<span class="portrait" data-portrait="<role>">`; `officers.ts` fills it.

On the battle screen each officer presents as a **profile plate** (§5.1): the
landscape personnel file anchoring the post — portrait 120×130 on the left
(the 256² source is ample; `object-position 50% 22%` so headgear survives
the crop), typed dossier lines on the right, the desk's REISSUE control
under them. Nameplates (rank tracks seniority, characters per §14.1;
canonical record in `officers.ts OFFICERS`):

| Post | Nameplate |
|------|-----------|
| statistics | LT. E. VOSS |
| infrastructure | CPT. R. MASON |
| frontline | MAJ. D. KANE |
| strategy | COL. A. STERN |

Character rules: cartoon, but **of this room** — flat screen-print tones,
chunky-miniature proportions (slightly oversized headgear, same law as the
3D pillars), olive/bone/charcoal palette, ONE cobalt accent, small brass
details. Friendly, competent, mid-century. Never photoreal, never anime,
never gritty.

### 14.1 Image-generation prompts (one per officer)

Shared style preamble — prepend to each prompt:

> Flat screen-print cartoon bust portrait, mid-century military field-manual
> style, hard-edged shapes built from 2–4 flat tones per material, no
> outlines, no gradients, light from the upper left, warm charcoal
> background (#1b1b18), olive drab + bone-khaki palette, one cobalt blue
> uniform accent, small brass details, chunky friendly proportions with
> slightly oversized headgear, clean silhouette readable as a tiny 34px
> avatar, square 1:1. No photorealism, no anime, no soft painterly shading,
> no pure black or white, no text.

1. **Statistics Officer** (top-left console): *"A young bookish staff
   lieutenant, beret tilted, round brass-rimmed spectacles catching one
   square glint, pencil tucked behind ear, holding a clipboard ledger tight
   to the chest, faint proud smile — the one who knows every number on the
   board."*
2. **Infrastructure Officer** (bottom-left desk): *"A stocky veteran
   combat engineer, sand-khaki hard hat, magnificent walrus mustache,
   rolled blueprint under one arm and a stubby carpenter pencil in the
   breast pocket, sleeves rolled, calm builder's squint."*
3. **Frontline Commander** (bottom-right desk): *"A grizzled field
   commander, olive combat helmet with a worn cobalt band, square jaw with
   stubble, binoculars hanging at the collarbone, steady forward stare with
   one eyebrow set — the officer who signs every deployment."*
4. **Strategy Advisor** (top-right desk): *"An older silver-templed staff
   advisor, high peaked cap with a small brass emblem, sly knowing
   half-smile, briar pipe with one flat puff of smoke, monocle chain
   disappearing into the collar — the one who proposes the daring plays."*
