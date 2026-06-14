import { CARDS } from '../sim/cards';
import { iconPath } from './icons';

/**
 * Card art plates (DESIGN_GUIDEBOOK.md §8) — procedural screen-print
 * illustrations, one per card subject. ViewBox 120×88, fixed composition:
 * sky wash → far band → chunky hero (lit upper-left, ≤3 tones per family,
 * one cobalt team panel) → near-black ground strip → halftone + vignette.
 * Flat fills only; separation by value, never by outline. Deterministic.
 *
 * Tones mirror src/render/art/palette.ts so the cards are printed with the
 * same inks the miniatures are painted with.
 */

// ── inks (lit / base / shade) ────────────────────────────────────────────────
const OLIVE = ['#77804e', '#636c41', '#4d5434'];
const STEEL = ['#707a85', '#596069', '#444a52'];
const GUN = ['#42464d', '#33373d', '#26292e'];
const TRACK = ['#3b3c37', '#2f302c', '#242521'];
const TIMBER = ['#a97e4f', '#8d6840', '#6e5032'];
const CONC = ['#9b958a', '#847f74', '#67635a'];
const SAND = ['#ddcda4', '#c7b68c', '#ab9a73'];
const ORE = ['#e8b83f', '#cc9b30', '#a37a26'];
const TEAM = ['#4b7fdd', '#2f63c8', '#244a96'];
const CLOTH = ['#b5a884', '#9c9070', '#7e7458'];
const OILK = ['#2c2a26', '#201f1c', '#161513'];
const GLASS = '#39565e';
const BONE = '#eae0c2';
const SKIN = '#b08a64';
const BRASS = '#d8a93c';

// ── atmospheres per card kind (day, night = B-side) ─────────────────────────
interface SkySpec { top: string; bot: string; field: string; sun?: { x: number; y: number; r: number; c: string } }
const SKIES: Record<string, { day: SkySpec; night: SkySpec }> = {
  building: {
    day: { top: '#2b241c', bot: '#54422c', field: '#665a44', sun: { x: 92, y: 46, r: 9, c: '#d8a93c' } },
    night: { top: '#1c1a20', bot: '#34303a', field: '#46424a' }
  },
  unit: {
    day: { top: '#272b1f', bot: '#4d4e33', field: '#6b604a', sun: { x: 26, y: 44, r: 8, c: '#e3d49a' } },
    night: { top: '#1c2026', bot: '#323844', field: '#454a52' }
  },
  tactic: {
    day: { top: '#2d1714', bot: '#5e2f1f', field: '#5c4533', sun: { x: 88, y: 48, r: 10, c: '#e07a4a' } },
    night: { top: '#221216', bot: '#46222a', field: '#4a3833' }
  },
  upgrade: { // unused (upgrades use the medal layout) but keeps lookups total
    day: { top: '#2a231a', bot: '#473827', field: '#5a4c38' },
    night: { top: '#2a231a', bot: '#473827', field: '#5a4c38' }
  }
};

// ── tiny svg authoring kit ───────────────────────────────────────────────────
function pg(pts: Array<[number, number]>, fill: string, op?: number): string {
  return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}"${op !== undefined ? ` opacity="${op}"` : ''}/>`;
}
function rc(x: number, y: number, w: number, h: number, fill: string, rx = 0, op?: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${rx ? ` rx="${rx}"` : ''}${op !== undefined ? ` opacity="${op}"` : ''}/>`;
}
function ci(cx: number, cy: number, r: number, fill: string, op?: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${op !== undefined ? ` opacity="${op}"` : ''}/>`;
}
function elp(cx: number, cy: number, rx: number, ry: number, fill: string, op?: number): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${op !== undefined ? ` opacity="${op}"` : ''}/>`;
}
function ph(d: string, fill: string, op?: number): string {
  return `<path d="${d}" fill="${fill}"${op !== undefined ? ` opacity="${op}"` : ''}/>`;
}
/** hero contact shadow pooled on the ground strip */
function shadow(cx: number, rx: number, y = 76): string {
  return elp(cx, y, rx, 3.4, '#15140f', 0.5);
}

// ── shared scene furniture ───────────────────────────────────────────────────
function skyAndField(s: SkySpec, uid: string, night: boolean): string {
  let out = `<defs><linearGradient id="sky${uid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${s.top}"/><stop offset="1" stop-color="${s.bot}"/>
  </linearGradient></defs>
  <rect width="120" height="60" fill="url(#sky${uid})"/>`;
  if (s.sun) out += ci(s.sun.x, s.sun.y, s.sun.r, s.sun.c, 0.5) + ci(s.sun.x, s.sun.y, s.sun.r * 0.62, s.sun.c, 0.75);
  if (night) out += ci(20, 12, 0.9, BONE, 0.6) + ci(34, 22, 0.7, BONE, 0.4) + ci(98, 10, 0.8, BONE, 0.5);
  out += rc(0, 58, 120, 30, s.field); // earth
  out += rc(0, 77, 120, 11, '#1d1b15'); // near strip
  // sparse scrub ticks on the strip — fixed, printed
  for (const [x, w] of [[9, 4], [27, 3], [52, 5], [74, 3], [101, 4]] as const) {
    out += rc(x, 78.6, w, 1.1, '#2e2b20');
  }
  return out;
}
function farRidge(uid: string, c: string, pts: Array<[number, number]>): string {
  void uid;
  return pg(pts, c);
}
/** print finish: 4% halftone + corner vignette */
function finish(uid: string): string {
  return `<defs>
    <pattern id="ht${uid}" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.55" fill="#0c0c0a"/>
    </pattern>
    <radialGradient id="vg${uid}" cx="0.5" cy="0.42" r="0.78">
      <stop offset="0.62" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.34"/>
    </radialGradient>
  </defs>
  <rect width="120" height="88" fill="url(#ht${uid})" opacity="0.1"/>
  <rect width="120" height="88" fill="url(#vg${uid})"/>`;
}
/** B-side stamp: twin chevrons, lower-left of the plate */
function bMark(): string {
  return pg([[8, 70], [13, 65], [18, 70], [18, 73.4], [13, 68.4], [8, 73.4]], BRASS, 0.85) +
    pg([[8, 63.4], [13, 58.4], [18, 63.4], [18, 66.8], [13, 61.8], [8, 66.8]], BRASS, 0.55);
}

// ── heroes ───────────────────────────────────────────────────────────────────

function heroTank(v: boolean): string {
  const barrel = v
    ? rc(74, 41, 30, 4.6, GUN[1]) + rc(98, 39.4, 8, 7.8, GUN[0]) + rc(101, 39.4, 1.6, 7.8, GUN[2]) // siege: squat heavy gun + brake
    : rc(74, 41.6, 40, 3.2, GUN[1]) + rc(74, 41.6, 40, 1.1, GUN[0]) + rc(108, 40.2, 6, 6, GUN[0]); // long rifle + muzzle
  return [
    shadow(62, 40),
    // tracks: skirted run
    rc(27, 65, 70, 11, TRACK[2], 5.5),
    ci(36, 70.5, 3, TRACK[0]), ci(48.5, 70.5, 3, TRACK[0]), ci(61, 70.5, 3, TRACK[0]), ci(73.5, 70.5, 3, TRACK[0]), ci(86, 70.5, 3, TRACK[0]),
    // skirt + hull
    pg([[26, 66], [98, 66], [94, 60], [30, 60]], STEEL[2]),
    pg([[24, 60], [34, 52.5], [90, 52.5], [98, 60]], STEEL[1]),
    pg([[36, 52.5], [88, 52.5], [84, 49.5], [41, 49.5]], STEEL[0]),
    // turret
    pg([[47, 49.5], [78, 49.5], [73, 38.5], [54, 38.5]], STEEL[1]),
    pg([[54, 38.5], [73, 38.5], [70.5, 36], [56.5, 36]], STEEL[0]),
    // mantlet + gun
    rc(72, 39.5, 5, 8, GUN[2]),
    barrel,
    // team panel on the turret flank, lit edge on top
    rc(53, 42, 14, 6, TEAM[1]), rc(53, 42, 14, 1.6, TEAM[0]),
    // cupola + glints
    rc(58, 33.4, 8, 3.4, STEEL[2]), rc(58, 33.4, 8, 1.1, STEEL[0]),
    ci(106, 43.2, 0.9, BONE, 0.85), ci(60, 34.4, 0.8, BONE, 0.7)
  ].join('');
}

function heroRifle(v: boolean): string {
  // one chunky rifleman, printed thrice in a staggered wedge
  const man = (x: number, y: number, s: number): string => `<g transform="translate(${x},${y}) scale(${s})">${[
    pg([[-4.4, -5], [-1.6, -5], [-2.2, 1.8], [-4.8, 1.8]], OLIVE[2]),            // rear leg
    pg([[0.6, -5], [3.4, -5], [3.8, 1.8], [1.2, 1.8]], OLIVE[1]),                // front leg
    rc(-5.2, 1.4, 3.4, 1.6, GUN[2]), rc(1.2, 1.4, 3.6, 1.6, GUN[2]),             // boots
    pg([[-4.6, -14], [4.2, -14], [3.6, -4.6], [-4.2, -4.6]], OLIVE[1]),          // torso
    pg([[-4.6, -14], [4.2, -14], [4.0, -11.8], [-4.5, -11.8]], OLIVE[0]),        // lit shoulders
    rc(-1.6, -17.2, 3.6, 3.2, SKIN),                                             // face
    ph('M-3.4 -16.6a3.9 3.2 0 0 1 7.8 0l0.3 1h-8.4Z', OLIVE[0]),                 // helmet
    pg([[-2.4, -11], [10.4, -13.6], [10.6, -11.9], [-2.2, -9.3]], GUN[1]),       // rifle
    rc(6.2, -13.7, 1.6, 2.4, GUN[2])                                             // grip block
  ].join('')}</g>`;
  const bags = v
    ? [0, 1, 2, 3, 4, 5].map((i) => elp(26 + i * 13.4, 73.6, 6.4, 2.8, SAND[1]) + ph(`M${19.6 + i * 13.4} 73.6a6.4 2.8 0 0 1 12.8 0Z`, SAND[0])).join('') +
      rc(18, 75.4, 86, 1.2, SAND[2])
    : '';
  return [
    farRidge('', '#3a3d2b', [[0, 60], [26, 50], [54, 57], [82, 48], [120, 58], [120, 60], [0, 60]]),
    shadow(44, 16, 75), shadow(62, 16, 76.5), shadow(80, 16, 75.5),
    man(44, 70, 1.06), man(80, 70.5, 1.06), man(62, 73, 1.18),
    bags
  ].join('');
}

function heroRocket(v: boolean): string {
  // hunter team: a tank carcass burning on the ridge — the prey it advances on
  const kill = v
    ? [
        pg([[93, 56.5], [113, 56.5], [110, 52.8], [96, 52.8]], TRACK[2]),
        pg([[99, 52.8], [107, 52.8], [105.4, 50.6], [100.6, 50.6]], GUN[2]),
        pg([[105, 51.6], [112.6, 48.2], [113.4, 49.6], [105.8, 53]], GUN[2]),
        ci(102, 51.4, 1.5, ORE[0], 0.95), ci(102.8, 50, 0.9, BONE, 0.8),
        ci(104, 45.8, 2.6, '#cfc6ad', 0.2), ci(106.5, 41.6, 2, '#cfc6ad', 0.13)
      ].join('')
    : '';
  return [
    farRidge('', '#3a3d2b', [[0, 60], [30, 52], [62, 58], [96, 50], [120, 57], [120, 60], [0, 60]]),
    kill,
    shadow(60, 22),
    // backblast wash
    pg([[34, 50], [16, 42], [14, 52], [30, 55]], BONE, 0.16),
    pg([[34, 51], [22, 45.5], [21, 52], [32, 54]], BONE, 0.22),
    `<g transform="translate(60,74)">${[
      // kneeling: shin + thigh + rear foot
      pg([[-2, 0], [1.4, 0], [1.4, -7], [-2, -7]], OLIVE[2]),
      pg([[-2, -7], [6.4, -7], [7.4, -3.4], [-1, -3.2]], OLIVE[1]),
      rc(5.2, -1.6, 4.4, 1.6, GUN[2]), rc(-3.4, -1.6, 4, 1.6, GUN[2]),
      // torso leaning into the tube
      pg([[-3.6, -16.4], [4.6, -15], [3.6, -6.6], [-3.4, -7.4]], OLIVE[1]),
      pg([[-3.6, -16.4], [4.6, -15], [4.3, -13], [-3.7, -14.3]], OLIVE[0]),
      rc(-0.8, -19.6, 3.4, 3.2, SKIN),
      ph('M-2.6 -19a3.8 3.1 0 0 1 7.6 0l0.3 1h-8.2Z', OLIVE[0]),
      // launch tube over the shoulder, up-right
      pg([[-12, -10.5], [13, -22.5], [14.6, -19.3], [-10.4, -7.3]], GUN[1]),
      pg([[-12, -10.5], [13, -22.5], [12.6, -21.4], [-11.7, -9.5]], GUN[0]),
      pg([[13, -22.5], [18.6, -25.2], [20.2, -22], [14.6, -19.3]], TEAM[1]),     // warhead — team paint
      pg([[-12, -10.5], [-14.8, -9.2], [-13.6, -6.6], [-10.4, -7.3]], GUN[2])    // venturi
    ].join('')}</g>`
  ].join('');
}

function heroHowitzer(v: boolean): string {
  // creeping barrage: shell bursts walking the far crest, brightening toward the advance
  const burst = (x: number, y: number, s: number, op: number) =>
    pg([[x, y - 4.6 * s], [x + 1.7 * s, y], [x, y + 4.6 * s], [x - 1.7 * s, y]], ORE[0], op) +
    pg([[x - 4.6 * s, y], [x, y - 1.7 * s], [x + 4.6 * s, y], [x, y + 1.7 * s]], ORE[1], op) +
    ci(x, y, 1.1 * s, BONE, op);
  const barrage = v ? burst(13, 54.4, 0.8, 0.6) + burst(26, 52.2, 0.95, 0.78) + burst(39, 53.4, 1.1, 0.95) : '';
  return [
    farRidge('', '#3a3d2b', [[0, 60], [34, 51], [70, 58], [120, 49], [120, 60], [0, 60]]),
    barrage,
    shadow(52, 26),
    // split trails to the rear-left, spade dug in
    pg([[40, 62], [16, 73], [20, 76], [44, 66]], OLIVE[2]),
    pg([[14, 71], [22, 71], [22, 77], [14, 77]], GUN[2]),
    // barrel — the absurd arc (readability law)
    pg([[44, 56], [102, 13], [106.4, 17], [48.6, 60]], GUN[1]),
    pg([[44, 56], [102, 13], [100.6, 11.4], [42.8, 54.6]], GUN[0]),
    rc(96, 12, 9, 6, GUN[2], 0, 1).replace('rect', 'rect transform="rotate(-36 100 15)"'),  // muzzle brake
    // recuperator + cradle
    pg([[42, 60], [62, 46], [65, 49.4], [45.6, 63]], OLIVE[0]),
    // carriage body + team panel
    pg([[34, 67], [62, 67], [58, 57], [40, 57]], OLIVE[1]),
    rc(42, 60.5, 10, 4.6, TEAM[1]), rc(42, 60.5, 10, 1.3, TEAM[0]),
    // wheel
    ci(46, 67, 8.4, TRACK[1]), ci(46, 67, 5.4, TRACK[0]), ci(46, 67, 2.1, GUN[2]),
    ci(104.5, 15.5, 0.9, BONE, 0.8)
  ].join('');
}

function heroHarvester(v: boolean): string {
  // armored hauler: nose plow + bolted slab skirts over the wheel runs
  const armor = v
    ? [
        pg([[16, 60], [23, 57], [23, 74], [16, 70.5]], STEEL[1]),
        pg([[16, 60], [23, 57], [23, 59.2], [16, 62.2]], STEEL[0]),
        rc(23, 62, 44, 9.6, STEEL[2]), rc(23, 62, 44, 1.5, STEEL[0]),
        rc(71, 64, 22, 7.6, STEEL[2]), rc(71, 64, 22, 1.5, STEEL[0]),
        ci(28, 66.8, 0.7, BONE, 0.5), ci(41, 66.8, 0.7, BONE, 0.5), ci(54, 66.8, 0.7, BONE, 0.5),
        ci(76, 67.6, 0.7, BONE, 0.5), ci(88, 67.6, 0.7, BONE, 0.5)
      ].join('')
    : '';
  return [
    farRidge('', '#43402e', [[0, 60], [40, 53], [78, 58], [120, 52], [120, 60], [0, 60]]),
    shadow(60, 38),
    // flatbed chassis + side boards
    rc(18, 62, 78, 6, GUN[2]),
    pg([[20, 58], [70, 58], [70, 64], [20, 64]], STEEL[1]),
    pg([[20, 58], [70, 58], [69.4, 59.8], [20.6, 59.8]], STEEL[0]),
    // the haul: strapped supply crates + one ore bin
    rc(24, 47, 13, 11, TIMBER[1]), rc(24, 47, 13, 2, TIMBER[0]), rc(29.5, 47, 2, 11, GUN[2], 0, 0.55),
    rc(38, 42.5, 15, 15.5, TIMBER[2]), rc(38, 42.5, 15, 2, TIMBER[1]), rc(44.5, 42.5, 2, 15.5, GUN[2], 0, 0.55),
    pg([[54, 50], [68, 50], [66.5, 58], [55.5, 58]], STEEL[2]),
    ci(58, 49, 2.6, ORE[1]), ci(63, 48.4, 3, ORE[0]), ci(61, 46.4, 0.9, BONE, 0.8),
    // forward cab + glass + exhaust
    pg([[70, 50], [86, 50], [93, 58], [93, 68], [70, 68]], OLIVE[1]),
    pg([[70, 50], [86, 50], [87.5, 52.2], [70, 52.2]], OLIVE[0]),
    pg([[82, 52.8], [87, 52.8], [91.2, 58.5], [82, 58.5]], GLASS),
    rc(71.5, 44, 2.6, 6, GUN[2]),
    rc(72, 60, 12, 5, TEAM[1]), rc(72, 60, 12, 1.4, TEAM[0]),
    // wheels
    ci(30, 70, 6, TRACK[1]), ci(30, 70, 2.4, TRACK[0]),
    ci(52, 70, 6, TRACK[1]), ci(52, 70, 2.4, TRACK[0]),
    ci(84, 70, 6, TRACK[1]), ci(84, 70, 2.4, TRACK[0]),
    armor
  ].join('');
}

// ── order plates: NATO-sketch directives on the red-alert field ─────────────

/** dashed brass reticle (shared with the airstrike plate language) */
function reticle(x: number, y: number, r: number, op: number): string {
  return `<g opacity="${op}"><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${BRASS}" stroke-width="1.4" stroke-dasharray="3.4 2.6"/>${ci(x, y, 1.4, BRASS)}</g>`;
}
function natoArrow(x: number, y: number, len: number, c: string, op = 1): string {
  const h = 5.2;
  return pg(
    [[x, y - h / 2], [x + len - 9, y - h / 2], [x + len - 9, y - h * 1.25], [x + len, y],
     [x + len - 9, y + h * 1.25], [x + len - 9, y + h / 2], [x, y + h / 2]],
    c, op
  );
}
function unitDot(x: number, y: number): string {
  return rc(x - 2.6, y - 2.6, 5.2, 5.2, OLIVE[1]) + rc(x - 2.6, y - 2.6, 5.2, 1.4, OLIVE[0]);
}

function heroAttackOrder(): string {
  return [
    farRidge('', '#3c241c', [[0, 60], [34, 52], [70, 58], [120, 50], [120, 60], [0, 60]]),
    natoArrow(22, 38, 76, BRASS, 0.95),
    natoArrow(14, 52, 56, BRASS, 0.5),
    unitDot(26, 66), unitDot(40, 70), unitDot(54, 66), unitDot(68, 70), unitDot(82, 66),
    shadow(54, 34)
  ].join('');
}

function heroDefendOrder(): string {
  // arrows fold back onto the keep; a sandbag arc holds the line
  const bag = (x: number, y: number) =>
    elp(x, y, 6, 2.7, SAND[1]) + ph(`M${x - 6} ${y}a6 2.7 0 0 1 12 0Z`, SAND[0]);
  return [
    farRidge('', '#3c241c', [[0, 60], [40, 53], [82, 58], [120, 51], [120, 60], [0, 60]]),
    `<g transform="rotate(180 36 40)">${natoArrow(8, 0, 48, BRASS, 0.85)}</g>`,
    `<g transform="rotate(180 92 40)">${natoArrow(64, 0, 48, BRASS, 0.85)}</g>`,
    bag(38, 70), bag(50, 72), bag(62, 72), bag(74, 70),
    pg([[52, 50], [68, 50], [66, 64], [54, 64]], STEEL[1]),
    pg([[52, 50], [68, 50], [67, 53], [53, 53]], STEEL[0]),
    pg([[57, 55], [63, 55], [62.4, 59], [57.6, 59]], TEAM[1]),
    shadow(58, 30)
  ].join('');
}

function heroSpreadOrder(): string {
  return [
    farRidge('', '#3c241c', [[0, 60], [36, 52], [74, 58], [120, 50], [120, 60], [0, 60]]),
    `<g transform="rotate(-24 30 44)">${natoArrow(30, 44, 44, BRASS, 0.9)}</g>`,
    natoArrow(32, 52, 50, BRASS, 0.55),
    `<g transform="rotate(24 30 60)">${natoArrow(30, 60, 44, BRASS, 0.9)}</g>`,
    unitDot(22, 50), unitDot(20, 60),
    unitDot(86, 34), unitDot(96, 52), unitDot(88, 70),
    shadow(56, 34)
  ].join('');
}

function heroHitPower(): string {
  return [
    farRidge('', '#3c241c', [[0, 60], [38, 53], [76, 58], [120, 51], [120, 60], [0, 60]]),
    // the target: a plant silhouette, stack + hall + fan
    rc(52, 38, 5, 14, CONC[2]),
    pg([[46, 52], [78, 52], [78, 70], [46, 70]], CONC[1]),
    pg([[46, 52], [78, 52], [80, 49.6], [48, 49.6]], CONC[0]),
    rc(50, 57, 6, 6, ORE[0], 0, 0.9), rc(59, 57, 6, 6, ORE[0], 0, 0.9),
    ci(72, 60, 4.2, GUN[2]),
    reticle(62, 58, 17, 0.95),
    // the strike bolt
    pg([[28, 16], [40, 16], [30, 34], [37, 34], [18, 56], [25, 37], [19, 37]], BRASS, 0.95),
    shadow(62, 30)
  ].join('');
}

function heroHitEconomy(): string {
  return [
    farRidge('', '#3c241c', [[0, 60], [38, 53], [76, 58], [120, 51], [120, 60], [0, 60]]),
    // the target: an ingot pile at the seam
    pg([[44, 64], [82, 64], [88, 74], [38, 74]], OILK[1]),
    pg([[50, 58], [62, 58], [65, 64], [47, 64]], ORE[1]),
    pg([[62, 56], [73, 56], [76.5, 62], [58.5, 62]], ORE[0]),
    pg([[54, 51], [65, 51], [68, 57], [51, 57]], ORE[2]),
    ci(60, 53, 1, BONE, 0.85),
    reticle(62, 60, 17, 0.95),
    natoArrow(10, 30, 42, BRASS, 0.8),
    shadow(62, 30)
  ].join('');
}

function heroBuggy(v: boolean): string {
  const tube = (pts: Array<[number, number]>) => pg(pts, GUN[1]);
  // gun buggy: pintle MG mounted on the cage top
  const gun = v
    ? [
        rc(62.6, 34.2, 1.8, 4, GUN[2]),
        pg([[59.4, 31.2], [67.8, 30.2], [68, 33], [59.6, 34]], GUN[1]),
        pg([[59.4, 31.2], [67.8, 30.2], [67.9, 31.2], [59.5, 32.2]], GUN[0]),
        pg([[67.8, 30.6], [80.4, 28.2], [80.7, 29.8], [68, 32.2]], GUN[1]),
        rc(80.2, 27.6, 2.2, 2.6, GUN[0])
      ].join('')
    : '';
  return [
    farRidge('', '#43402e', [[0, 60], [36, 52], [72, 58], [120, 50], [120, 60], [0, 60]]),
    shadow(60, 34),
    // dust kicked behind
    elp(22, 66, 9, 5, SAND[0], 0.18), elp(30, 62, 6, 3.6, SAND[0], 0.14),
    // raked chassis
    pg([[26, 56], [56, 50], [92, 57], [94, 64], [28, 63]], OLIVE[1]),
    pg([[26, 56], [56, 50], [57.4, 52.6], [27.6, 58.4]], OLIVE[0]),
    // roll cage
    tube([[46, 51], [56, 33], [59, 33], [50, 51.6]]),
    tube([[56, 33], [74, 37], [73.4, 40], [57.5, 36]]),
    tube([[72, 38], [80, 56], [76.6, 56.8], [69.4, 39.4]]),
    // driver
    ci(63, 42, 4.2, OLIVE[0]), pg([[60.4, 42.4], [66.4, 41.2], [66.2, 43.6], [60.8, 44.4]], GLASS),
    gun,
    // team nose panel
    pg([[80, 56], [92, 58.4], [92.6, 62.6], [80, 61]], TEAM[1]),
    pg([[80, 56], [92, 58.4], [92.2, 59.8], [80, 57.4]], TEAM[0]),
    // oversized wheels
    ci(38, 66, 9.4, TRACK[1]), ci(38, 66, 6, TRACK[0]), ci(38, 66, 2.2, GUN[2]),
    ci(86, 66, 9.4, TRACK[1]), ci(86, 66, 6, TRACK[0]), ci(86, 66, 2.2, GUN[2]),
    ph('M29.4 62.4a9.4 9.4 0 0 1 5.4-8.2l1 2a7.2 7.2 0 0 0-4.2 6.3Z', SAND[0], 0.5) // rim glint
  ].join('');
}

function heroPowerplant(): string {
  return [
    shadow(60, 40),
    // stack + steam
    rc(28, 16, 11, 32, CONC[2]), rc(28, 16, 3.2, 32, CONC[1]), rc(27, 14, 13, 3.4, CONC[1]),
    ci(34, 9.6, 5, '#cfc6ad', 0.4), ci(41, 5.4, 3.8, '#cfc6ad', 0.28), ci(48, 3, 2.8, '#cfc6ad', 0.18),
    // hall: front + side + roof
    pg([[20, 46], [74, 46], [74, 74], [20, 74]], CONC[1]),
    pg([[74, 46], [92, 50], [92, 74], [74, 74]], CONC[2]),
    pg([[20, 46], [74, 46], [78, 42.6], [24, 42.6]], CONC[0]),
    pg([[74, 46], [92, 50], [94.6, 47.4], [78, 42.6]], CONC[1]),
    // amber windows — the only glow on the board
    rc(26, 54, 9, 9, ORE[0], 0, 0.9), rc(39, 54, 9, 9, ORE[0], 0, 0.9), rc(52, 54, 9, 9, ORE[0], 0, 0.9),
    rc(24.8, 52.8, 37.6, 11.4, ORE[0], 0, 0.14),
    // door + team frame
    rc(63, 60, 8, 14, GUN[2]), rc(62, 59, 10, 1.8, TEAM[1]),
    // side fan
    ci(83, 60, 6.6, GUN[2]), pg([[83, 55], [85, 60], [83, 65], [81, 60]], TEAM[0]), pg([[78, 60], [83, 58], [88, 60], [83, 62]], TEAM[1]), ci(83, 60, 1.4, BONE, 0.9),
    // cable run
    rc(92, 66, 22, 1.6, GUN[2]), rc(106, 58, 1.8, 9.6, GUN[2])
  ].join('');
}

function heroExtractor(): string {
  return [
    shadow(70, 36),
    // the seam: dark cut crowded with raw gold
    pg([[56, 64.5], [110, 64.5], [116, 76.5], [50, 76.5]], OILK[1]),
    pg([[60, 67.5], [68.5, 65.5], [71, 71], [62, 73.2]], ORE[1]),
    pg([[71, 69.5], [78, 67.5], [80, 72.5], [72.5, 74.2]], ORE[2]),
    pg([[83, 66.5], [91.5, 65], [93.5, 71], [84.5, 72.8]], ORE[0]),
    pg([[96, 68], [103, 66.5], [105, 71.5], [97.5, 73.2]], ORE[1]),
    ci(87, 67, 1.1, BONE, 0.9), ci(64.5, 68.4, 0.9, BONE, 0.7), ci(100, 68.4, 0.8, BONE, 0.6),
    // hoist shed
    pg([[18, 56], [48, 56], [48, 74], [18, 74]], TIMBER[1]),
    pg([[18, 56], [48, 56], [51, 51.6], [21, 51.6]], TIMBER[0]),
    rc(30, 62, 8, 12, OILK[1]), rc(29, 61, 10, 1.6, TEAM[1]),
    // headframe A-tower over the seam
    pg([[66, 70], [78.6, 26], [82, 26], [72, 70]], TIMBER[1]),
    pg([[94, 70], [81.4, 26], [78, 26], [88, 70]], TIMBER[2]),
    rc(71, 48, 18.4, 2.8, TIMBER[1]), rc(73.8, 38, 13, 2.6, TIMBER[2]),
    // sheave + cable into the pit
    ci(80, 24, 6.2, GUN[1]), ci(80, 24, 3.8, GUN[0]), ci(80, 24, 1.3, BONE, 0.9),
    rc(79.2, 24, 1.5, 45, GUN[2]),
    rc(74, 68, 12, 4.6, STEEL[1]) // skip bucket at the seam mouth
  ].join('');
}

function heroDerrick(): string {
  return [
    shadow(56, 36),
    // oil pool + pipe
    elp(34, 76, 17, 3.6, OILK[1]), ph('M22 75.2a12 2.2 0 0 1 14-1.4Z', BONE, 0.18),
    rc(84, 70, 30, 2, GUN[2]), rc(98, 64, 1.8, 8, GUN[2]),
    // pyramid stand
    pg([[52, 36], [38, 74], [46, 74], [54.5, 42]], TIMBER[1]),
    pg([[56, 36], [70, 74], [62, 74], [53.5, 42]], TIMBER[2]),
    rc(45, 58, 18, 2.6, TIMBER[2]),
    // walking beam + horsehead + counterweight crank
    pg([[28, 38.6], [80, 29], [80.8, 33.4], [28.8, 43]], STEEL[1]),
    pg([[28, 38.6], [80, 29], [79.7, 27.6], [27.7, 37.2]], STEEL[0]),
    ph('M21.6 36.2 30 34.6l1.8 9.4-6.4 1.2c-2.8-1.8-4-5.6-3.8-9Z', STEEL[2]),
    ci(80, 35, 6.8, GUN[1]), ci(80, 35, 4.2, GUN[0]), ci(80, 35, 1.4, BONE, 0.85),
    pg([[76, 35], [80, 35], [74, 56], [70, 56]], GUN[2]), // pitman arm
    // sucker rod down to the well + team band on the stand
    rc(25.6, 43, 1.6, 28, GUN[2]),
    rc(45.5, 64, 17, 4, TEAM[1]), rc(45.5, 64, 17, 1.2, TEAM[0])
  ].join('');
}

function heroBarracks(v: boolean): string {
  // commando school: launch tubes racked against the tent wall, brass warheads up
  const tube = (x: number) =>
    pg([[x, 70.6], [x + 7.6, 53.6], [x + 10, 54.6], [x + 2.4, 71.6]], GUN[1]) +
    pg([[x, 70.6], [x + 7.6, 53.6], [x + 8.4, 54], [x + 0.8, 71]], GUN[0]) +
    pg([[x + 7.6, 53.6], [x + 9.6, 49.2], [x + 12, 50.2], [x + 10, 54.6]], BRASS);
  const rack = v ? tube(62) + tube(70) + tube(78) : '';
  return [
    shadow(56, 40),
    // long tent hall
    pg([[14, 70], [22, 47], [86, 47], [98, 70]], CLOTH[1]),
    pg([[22, 47], [86, 47], [88.4, 51.6], [20, 51.6]], CLOTH[0]),
    pg([[14, 70], [20, 51.6], [24, 51.6], [19, 70]], CLOTH[2]),
    // ridge seams
    rc(34, 52, 1.4, 18, CLOTH[2]), rc(52, 52, 1.4, 18, CLOTH[2]), rc(70, 52, 1.4, 18, CLOTH[2]),
    // door + team frame
    ph('M50 70v-10a5 5 0 0 1 10 0v10Z', OILK[1]), ph('M48.6 70v-10.4a6.4 6.4 0 0 1 2-4.6l1.2 1.4a5 5 0 0 0-1.4 3.2V70Z', TEAM[1]),
    // flag
    rc(90, 28, 1.6, 22, GUN[2]), pg([[91.6, 28], [106, 31.4], [91.6, 35]], TEAM[1]), pg([[91.6, 28], [106, 31.4], [91.6, 30.4]], TEAM[0]),
    // sandbag line
    elp(26, 73.4, 6.2, 2.7, SAND[1]), elp(38, 73.4, 6.2, 2.7, SAND[2]), elp(50, 73.4, 6.2, 2.7, SAND[1]),
    ph('M19.8 73.4a6.2 2.7 0 0 1 12.4 0Z', SAND[0]), ph('M43.8 73.4a6.2 2.7 0 0 1 12.4 0Z', SAND[0]),
    rack
  ].join('');
}

function heroFactory(v: boolean): string {
  const tooth = (x: number) => pg([[x, 50], [x + 17, 37.6], [x + 17, 50]], CONC[0]) + pg([[x + 17, 37.6], [x + 21, 37.6], [x + 21, 50], [x + 17, 50]], GLASS);
  // motor pool: a buggy on the line instead of a tank hull, spare tires by the hall
  const online = v
    ? ci(37, 70.4, 2.9, TRACK[0]) + ci(47, 70.4, 2.9, TRACK[0]) +
      pg([[31.6, 68], [40, 65.6], [50.4, 68], [49.6, 70.4], [32.4, 70.4]], OLIVE[1]) +
      pg([[38.6, 66], [41.6, 61.4], [43.2, 61.4], [40.4, 66]], GUN[1])
    : pg([[32, 70], [50, 70], [48, 66], [34, 66]], STEEL[2]) + rc(37, 63.4, 8, 2.6, STEEL[2]);
  const tires = v
    ? elp(11, 73.2, 5.2, 2.6, TRACK[1]) + elp(11, 68.4, 5.2, 2.6, TRACK[2]) +
      elp(12, 63.6, 5.2, 2.6, TRACK[1]) + elp(12, 63, 2, 1, TRACK[0])
    : '';
  return [
    shadow(58, 42),
    // chimney + smoke
    rc(84, 16, 9, 36, CONC[2]), rc(84, 16, 2.6, 36, CONC[1]), rc(83, 14, 11, 3, ORE[2]),
    ci(90, 9.6, 4.6, '#cfc6ad', 0.34), ci(96, 5.6, 3.4, '#cfc6ad', 0.22),
    // hall
    rc(20, 50, 76, 24, CONC[1]),
    tooth(20), tooth(45), tooth(70),
    // gantry + open bay with the line's product
    rc(24, 56, 50, 2.6, STEEL[1]), rc(46, 58.6, 1.4, 5, GUN[2]),
    rc(28, 60, 26, 14, OILK[1]),
    online,
    tires,
    // team door + spec stripe
    rc(62, 62, 9, 12, GUN[2]), rc(61, 61, 11, 1.8, TEAM[1]),
    rc(20, 52.4, 76, 1.6, TEAM[2], 0, 0.65)
  ].join('');
}

function heroBunker(v: boolean): string {
  // forward post: signal mast with team pennant — territory projected far afield
  const mast = v
    ? [
        pg([[69.4, 30], [58, 56], [59.4, 56.8], [70.4, 31]], GUN[2], 0.55),
        rc(69.2, 26, 1.7, 27, GUN[2]),
        rc(69.2, 26, 0.6, 27, GUN[0]),
        pg([[70.9, 27], [81, 29.4], [70.9, 31.8]], TEAM[1]),
        pg([[70.9, 27], [81, 29.4], [70.9, 28.6]], TEAM[0]),
        ci(70, 25, 1.3, ORE[0], 0.95), ci(70, 25, 0.6, BONE, 0.9)
      ].join('')
    : '';
  return [
    shadow(60, 36),
    // apron of sandbags
    elp(30, 74, 7, 3, SAND[2]), elp(44, 75, 7, 3, SAND[1]), elp(76, 75, 7, 3, SAND[1]), elp(90, 74, 7, 3, SAND[2]),
    ph('M23 74a7 3 0 0 1 14 0Z', SAND[0]), ph('M83 74a7 3 0 0 1 14 0Z', SAND[0]),
    // the dome
    ph('M26 72a34 21 0 0 1 68 0Z', CONC[1]),
    ph('M34 60a26 14 0 0 1 52 0l-4.4 1.6a22 11 0 0 0-43.2 0Z', CONC[0]),
    // firing slit — dark and wide
    pg([[40, 62], [80, 62], [78, 67], [42, 67]], OILK[2]),
    rc(40, 61, 40, 1.4, CONC[2]),
    // team keystone
    pg([[56, 51], [64, 51], [63, 56], [57, 56]], TEAM[1]),
    rc(20, 72, 80, 2.4, CONC[2]),
    mast
  ].join('');
}

function heroAtturret(): string {
  return [
    shadow(58, 32),
    // concrete pad
    pg([[30, 70], [90, 70], [86, 75], [34, 75]], CONC[2]),
    // cruciform mount
    pg([[52, 70], [68, 70], [64, 58], [56, 58]], STEEL[2]),
    // the long gun, high elevation
    pg([[50, 54], [108, 24], [110.4, 28], [52.4, 58]], GUN[1]),
    pg([[50, 54], [108, 24], [107, 22.4], [49, 52.4]], GUN[0]),
    rc(102, 22, 7, 6.4, GUN[2], 0, 1).replace('rect', 'rect transform="rotate(-27 105 25)"'),
    // recoil cradle + shield plate
    pg([[46, 60], [64, 50], [67, 53.6], [49, 63.6]], OLIVE[0]),
    pg([[38, 48], [56, 44], [58, 64], [42, 67]], STEEL[1]),
    pg([[38, 48], [56, 44], [56.6, 46.6], [38.6, 50.6]], STEEL[0]),
    rc(44, 52, 9, 5, TEAM[1]), rc(44, 52, 9, 1.3, TEAM[0]),
    ci(108.6, 26.2, 0.9, BONE, 0.8)
  ].join('');
}

function heroAirstrike(v: boolean): string {
  const bombs = v
    ? [elp(56, 50, 2, 3.6, GUN[2]), elp(68, 44, 2, 3.6, GUN[2]), elp(80, 38, 2, 3.6, GUN[2])].join('')
    : [elp(62, 48, 2.2, 3.8, GUN[2]), elp(74, 40, 2.2, 3.8, GUN[2])].join('');
  const reticle = (x: number, y: number, r: number, op: number) =>
    `<g opacity="${op}"><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${BRASS}" stroke-width="1.4" stroke-dasharray="3.4 2.6"/>${ci(x, y, 1.4, BRASS)}</g>`;
  return [
    farRidge('', '#33231c', [[0, 60], [36, 53], [74, 58], [120, 51], [120, 60], [0, 60]]),
    // the strike zone
    v ? reticle(50, 70, 6, 0.7) + reticle(70, 70, 6, 0.9) + reticle(90, 70, 6, 0.7) : reticle(78, 69, 8.6, 0.9),
    bombs,
    // diving jet (authored level, rotated into the dive)
    `<g transform="rotate(22 52 26)">${[
      rc(8, 21.8, 24, 1.3, BONE, 0.28), rc(14, 24.8, 16, 1.1, BONE, 0.18),   // contrail
      pg([[28, 20.4], [74, 21.6], [83, 24], [74, 26.4], [28, 27.6], [33, 24]], GUN[1]),
      pg([[28, 20.4], [74, 21.6], [74, 22.4], [28, 21.4]], GUN[0]),
      pg([[34, 20.6], [40, 12], [44, 20.8]], GUN[2]),                         // tail fin
      pg([[48, 24], [68, 24], [56, 31.6]], GUN[2]),                           // swept wing
      pg([[56, 20.2], [64, 20.4], [61, 17.8], [57.6, 17.8]], GLASS),          // canopy
      pg([[74, 21.6], [83, 24], [74, 26.4]], TEAM[1])                         // nose cone — team paint
    ].join('')}</g>`
  ].join('');
}

function heroNuke(): string {
  return [
    farRidge('', '#33231c', [[0, 60], [40, 54], [80, 57], [120, 52], [120, 60], [0, 60]]),
    // white-hot ground flash
    elp(60, 60, 26, 5, BONE, 0.85),
    elp(60, 60, 14, 3.2, '#fff7da'),
    // column
    pg([[54, 60], [66, 60], [63, 34], [57, 34]], SAND[1]),
    pg([[54, 60], [60, 60], [60, 34], [57, 34]], SAND[0]),
    // roiling cap, lit upper-left
    elp(60, 26, 25, 11, SAND[1]),
    elp(48, 29, 12, 7, SAND[2]),
    elp(72, 28, 12, 7.5, SAND[2]),
    elp(56, 22, 14, 8, SAND[0]),
    ci(68, 21, 6, SAND[0]),
    // furnace glow where the stem feeds the cap
    elp(60, 33, 10, 4, BRASS, 0.85),
    elp(60, 34.5, 6, 2.4, '#f3e6b3'),
    // shockwave ring racing across the deck
    `<ellipse cx="60" cy="62" rx="38" ry="7.5" fill="none" stroke="${BONE}" stroke-width="1.6" opacity="0.5"/>`,
    shadow(60, 30)
  ].join('');
}

/** upgrades are decorations, not deployments: a brass medal on a ray burst */
function heroMedal(name: string, uid: string): string {
  let rays = '';
  for (let i = 0; i < 12; i++) {
    rays += `<g transform="rotate(${i * 30} 60 40)">${pg([[60, 40], [56, -8], [64, -8]], '#8a6f24', 0.16)}</g>`;
  }
  return [
    `<defs><radialGradient id="med${uid}" cx="0.5" cy="0.45" r="0.7">
      <stop offset="0" stop-color="#473827"/><stop offset="1" stop-color="#26201a"/>
    </radialGradient></defs>`,
    `<rect width="120" height="88" fill="url(#med${uid})"/>`,
    rays,
    // ribbon
    pg([[46, 56], [60, 63], [74, 56], [74, 78], [60, 70], [46, 78]], TEAM[1]),
    pg([[46, 56], [60, 63], [74, 56], [74, 60], [60, 67], [46, 60]], TEAM[0]),
    // medal
    ci(60, 38, 23, ORE[2]), ci(60, 38, 21, ORE[1]),
    ph('M60 17a21 21 0 0 1 14.8 6.1l-2.4 2.4A17.6 17.6 0 0 0 60 20.4Z', ORE[0]),
    ci(60, 38, 16.4, GUN[2]),
    `<g transform="translate(43.2,21.2) scale(1.4)"><path fill-rule="evenodd" d="${iconPath(name)}" fill="${BONE}"/></g>`
  ].join('');
}

// ── assembly ─────────────────────────────────────────────────────────────────

const HEROES: Record<string, (variant: boolean) => string> = {
  tank: heroTank, rifle: heroRifle, rocket: heroRocket, howitzer: heroHowitzer,
  harvester: heroHarvester, buggy: heroBuggy, powerplant: () => heroPowerplant(),
  extractor: () => heroExtractor(), derrick: () => heroDerrick(), barracks: heroBarracks,
  factory: heroFactory, bunker: heroBunker, atturret: () => heroAtturret(),
  airstrike: heroAirstrike, nuke: () => heroNuke(),
  attackorder: () => heroAttackOrder(), defendorder: () => heroDefendOrder(),
  spreadorder: () => heroSpreadOrder(), hitpower: () => heroHitPower(),
  hiteconomy: () => heroHitEconomy()
};

let instance = 0;

/** The full art plate for a card id. Returns an <svg> string (120×88). */
export function cardArt(cardId: string): string {
  const def = CARDS[cardId];
  if (!def) return '';
  const uid = `c${(instance++).toString(36)}`;
  const baseId = def.pairId ?? cardId;
  const variant = def.side === 'B';

  let body: string;
  if (def.kind === 'upgrade') {
    body = heroMedal(cardId.replace(/_b$/, ''), uid);
  } else {
    const sky = SKIES[def.kind][variant ? 'night' : 'day'];
    const hero = HEROES[baseId];
    body = skyAndField(sky, uid, variant) + (hero ? hero(variant) : '') + (variant ? bMark() : '');
  }
  return `<svg class="cart" viewBox="0 0 120 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}${finish(uid)}</svg>`;
}
