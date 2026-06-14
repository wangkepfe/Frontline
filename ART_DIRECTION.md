# FRONTLINE — Art Direction Bible

**Concept: THE WAR TABLE.** The battlefield is a commander's miniature diorama
brought to life — a hand-built sand table in a lamp-lit operations room. Cards
are the orders; the table is where they play out. Every asset is a *crafted
miniature*, not a failed attempt at realism. The fixed orthographic camera is
not a limitation, it is the premise: you are leaning over the table.

This document governs every asset. When in doubt, an asset should look like it
was milled, chamfered, and hand-painted by a master modeler — chunky, confident,
readable from across the room.

---

## 1. Pillars

1. **Silhouette first.** Every unit must be identifiable at 64 px from the game
   camera (45° yaw / 50° pitch, orthographic). Exaggerate the one feature that
   names the unit: tank = long gun + wide skirted tracks; howitzer = absurdly
   long elevated barrel on split trails; supply truck = crate-stacked flatbed;
   buggy = oversized wheels + roll cage; rocket team = shoulder tube. If the
   silhouette doesn't say it, the detail never will.
2. **Chunky miniature proportions.** ~20 % oversized turrets, wheels, helmets,
   barrels. Nothing thinner than ~0.018 world units (it aliases). No greeble
   smaller than a rivet you could pick up with tweezers.
3. **Chamfer everything.** No raw `BoxGeometry` faces on hero assets. Every
   edge carries a 45° chamfer that catches the key light — that edge highlight
   is what reads as "manufactured object" instead of "programmer cube".
   Cylinders get lathed rim chamfers. Organic shapes (canopies, crags) are
   jittered icosahedra/cones — faceted, never smooth.
4. **One palette, three values.** All color comes from `palette.ts`. Each
   material family is a ramp (lit / base / shade) used as *painted tones on
   separate parts*, not per-face tricks. Terrain sits desaturated mid-value;
   units sit one value step darker and more saturated; **team accent is the
   most saturated thing on the board** and appears as deliberate painted
   panels (turret flank, hood, door frame) — never a whole-model tint.
5. **Motion is information.** An animation exists only if it tells the player
   sim-truth: locomotion is driven by *actual distance traveled* (zero foot
   slide, zero ghost glide), weapons recoil only on real shots, industry moves
   only while producing, harvest gear works only while loading. Idle units hold
   a miniature's stillness — the only always-on motions are command antennae
   and the HQ radar (the army is *thinking*). No decorative bobbing, ever.
   Every keyframe earns its place: a walk is contact–passing–contact, a recoil
   is kick–return. Nothing else.

## 2. Light & mood (scene level)

- **Golden-hour key** from the south-west (camera side) so chamfers facing the
  player catch warm edge light; shadows fall away to the north-east, giving
  every miniature a grounding contact shadow.
- **Cool sky fill** (hemisphere) so shadow sides go slate-blue, not black —
  warm/cool contrast is the diorama look.
- ACES filmic tone mapping + a neutral `RoomEnvironment` PMREM so painted
  metal reads as *enamel on tin*, with soft real reflections on gun steel.
- Background is a deep warm charcoal — the unlit operations room beyond the
  table edge. The board itself gets a beveled rim, like a real sand table.

## 3. Palette law

Defined once in `src/render/art/palette.ts`. Families (each lit/base/shade):

| Family    | Role                                 | Character                     |
|-----------|--------------------------------------|-------------------------------|
| `sand`    | open ground                          | warm bone-khaki, low chroma   |
| `sage`    | forest floor, scrub                  | grey-green, quiet             |
| `crag`    | mountains, cliffs                    | warm grey with ochre strata   |
| `water`   | river                                | deep teal, foam = bone        |
| `olive`   | fatigues, soft-skin vehicles         | rich olive drab               |
| `steel`   | hulls, hard metal                    | blue-leaning gunmetal         |
| `gun`     | barrels, weapons                     | near-black steel, oily        |
| `timber`  | derrick, bridge planks, crates       | warm sienna wood              |
| `concrete`| pads, bunkers, HQ mass               | warm grey                     |
| `ore`     | gold deposits, hauled loads          | saturated brass-gold          |
| `team0`   | player accent                        | cobalt blue enamel            |
| `team1`   | enemy accent                         | vermilion red-orange enamel   |

Rules:
- Max ~5 families per asset. Accents ≤ 10 % of visible area.
- No pure black, no pure white. Darkest = `gun.shade`, lightest = `sand.lit`.
- Glass/visors = dark teal with a single specular-friendly tone.

## 4. Geometry language (the kit)

`src/render/art/kit.ts` provides the only allowed primitives:
- `cbox(w,h,d,ch)` — chamfered box (convex hull construction), the workhorse.
- `hull(points)` — arbitrary convex brush for glacis plates, wedges, turret
  frustums. Model vehicles the way Quake brushes built levels.
- `lathe(profile, seg)` — chamfered cylinders, wheels, domes, dishes, barrels
  (profile-driven so muzzles can flare and rims can step).
- `rock(r, seed)` / `blob(r, seed)` — seeded jittered solids for crags and
  canopies. Deterministic per seed: same board renders identically.
- All geometry flat-shaded, cached by parameter signature, disposed never
  (shared). All meshes cast/receive shadows unless ground-flat.

## 5. Animation law (the rig)

`src/render/art/rig.ts`:
- Named bone pivots placed at *mechanical joints* (hip, shoulder, trunnion,
  crank, sprocket). Rest pose captured once; every frame starts from rest, then
  layers apply — poses never accumulate drift.
- **Locomotion phase = traveled distance × stride.** Infantry legs swing only
  while displacement happens; wheels/sprockets rotate exactly v/r; tanks pitch
  ±2° on accel/brake (mass), buggies roll into turns (speed).
- **Action envelopes** are explicit keyframe tables `[(t, value, ease)...]` —
  e.g. cannon recoil: 0 ms → −0.09 axial @snap, 60 ms hold, 420 ms ease-out
  return. Two keys, both load-bearing.
- **State gates:** production buildings animate only while `producing`;
  the supply truck's cargo loads aboard only in `loading` and tips only in
  `unloading`; turrets track only with a live target and ease home after
  2.5 s without one.
- Nothing animates on a timer for decoration. If the sim didn't cause it, it
  doesn't move. (Sole exceptions: HQ radar sweep + antenna beacon = "command is
  alive", water drift + flag flutter = "the world breathes". These are quiet.)

## 6. Per-asset readability targets

| Asset     | One-word read | Exaggerate                          |
|-----------|---------------|--------------------------------------|
| rifle     | *squad*       | 3 helmets, staggered wedge           |
| rocket    | *tube*        | shoulder launcher length, kneel pose |
| tank      | *gun*         | barrel length, track width, low hull |
| howitzer  | *arc*         | barrel elevation + split trails      |
| harvester | *cargo*       | crate-stacked flatbed, military cab  |
| buggy     | *speed*       | wheel diameter, raked stance, cage   |
| hq        | *command*     | radar mast + bunkered mass + flag    |
| barracks  | *tents+drill* | long hall, team door, sandbags       |
| factory   | *industry*    | sawtooth roof, gantry crane, stack   |
| extractor | *mine-works*  | headframe wheel over the seam        |
| derrick   | *pumpjack*    | walking-beam horsehead linkage       |
| bunker    | *pillbox*     | low dome, dark firing slit           |
| atturret  | *overwatch*   | long AT gun on armored carriage      |

## 7. Technical constraints

- Tile = 1.0 world unit; `TILE_TOP = 0.1`; units author at ~0.3–0.5 tile and
  ship through `UNIT_SCALE = 1.45`. Building footprints ≤ 0.94.
- Camera never moves: author for 45°/50° — tops and south-west faces are the
  art; north faces are barely seen. Spend polygons accordingly.
- Static terrain merges into vertex-colored chunks (one material, few draw
  calls). Animated parts stay separate nodes.
- Sim stays untouched: art reads sim state, never writes it. No `Math.random`
  in anything deterministic-per-board (use seeded `hash`).
- Everything remains GLTF-swappable: builders return a root `Group` whose
  internals only the rig knows.
