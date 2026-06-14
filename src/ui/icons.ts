/**
 * The icon system (DESIGN_GUIDEBOOK.md §6).
 *
 * Single-color filled silhouettes on a 24×24 grid, rendered as inline SVG
 * with `currentColor` so context tints them. Chunky military-contractor
 * shapes — exaggerate the one feature that names the thing, same law as
 * the 3D readability table. If a glyph is not in this registry it does
 * not exist; emoji are banned from the product surface.
 */

const P: Record<string, string> = {
  // ── resources ──────────────────────────────────────────────────────────
  // gold: three stacked ingots
  gold: 'M8.6 9.2h6.8L17 14H7ZM3.4 15.4h6.4l1.7 4.8H2ZM14.2 15.4h6.4L22 20.2h-9.5Z',
  // oil: heavy drop
  oil: 'M12 2.6c3.1 4 6.3 8.2 6.3 12A6.3 6.3 0 0 1 5.7 14.6c0-3.8 3.2-8 6.3-12Z',
  // power: bolt
  power: 'M13.8 1.8 4.6 13.4h5.5L8.4 22.2 19.4 9.8h-5.6Z',
  // pop: pennant on pole
  pop: 'M5.5 2.6h2.2v18.8H5.5ZM8.6 4.2 20 7.4 8.6 10.6Z',
  // clock: dial + hands
  clock: 'M12 2.8a9.2 9.2 0 1 0 .01 0ZM12 5a7 7 0 1 1-.01 0ZM11.1 6.8h1.8v5.4h4.4v1.9h-6.2Z',
  // requisition (campaign currency): banded supply coin
  req: 'M12 2.8a9.2 9.2 0 1 0 .01 0ZM12 5a7 7 0 1 1-.01 0ZM7.5 9.4h9v1.8h-9Zm0 3.4h9v1.8h-9Z',

  // ── card subjects ──────────────────────────────────────────────────────
  // power plant: hall + stack + bolt cut
  powerplant: 'M5 3.4h3.4v7H5ZM3 11.2h18v9.4H3Zm10.6 1.6-3.4 4.4h2.1l-1.4 3 4.9-4.7h-2.2l1.5-2.7Z',
  // extractor: A-headframe + sheave + seam
  extractor: 'M12 2.4a2.6 2.6 0 1 0 .01 0ZM11.2 6h1.6l5.6 13h-2.5l-1.2-3H9.3l-1.2 3H5.6Zm.8 3.6L10.1 14h3.8Z M4 19.4h16v2.2H4Z',
  // derrick: pumpjack — tilted beam, horsehead, pyramid, ground
  derrick: 'M3 5.4l4.2.9-.8 4.6-4.2-.9ZM6.4 8.2 19.6 6l.4 2.3-13.2 2.2ZM18.2 7.6a2.4 2.4 0 1 0 .01 0ZM12.6 8.6h1.6L19 19h-2.4l-2.9-7-1.6 7H9.7ZM3 19.2h18v2.2H3Z',
  // barracks: long tent + door cut
  barracks: 'M12 4.4 22 19.6H2Zm0 7.2a2 2 0 0 0-2 2v6h4v-6a2 2 0 0 0-2-2Z',
  // factory: sawtooth roofline + chimney
  factory: 'M4.6 3.6h3v6h-3ZM3 20.4V11.8l5.4-3v3.2l5.3-3.2v3.2l5.3-3.2v11.6Z',
  // bunker: dome + dark slit + apron
  bunker: 'M12 6.2c5 0 9 3.6 9 8.2v2.2H3v-2.2c0-4.6 4-8.2 9-8.2Zm-4.4 6.4v2.4h8.8v-2.4ZM2 17.8h20v2H2Z',
  // AT turret: shield carriage + long elevated gun
  atturret: 'M10.5 9.6 21.8 4l1 2.1-11.3 5.7ZM4 8.6h7v9H4Zm3.5 7.2a3.4 3.4 0 1 0 .01 0Z',
  // rifle: helmet dome + brim
  rifle: 'M12 5.2c4.4 0 8 2.9 8 7.4v1H4v-1c0-4.5 3.6-7.4 8-7.4ZM2.6 14.8h18.8v2.2H2.6Z',
  // rocket: shoulder tube, flared venturi, warhead cone
  rocket: 'M5.2 15 14.9 6.5l2.7 3.1-9.7 8.5ZM15.9 5.3l5.7-2.9-2.7 6.3ZM5.8 15.6l2.5 2.8-3.7 3.2-3-3.2Z',
  // tank: low hull + turret + long gun, track band with roadwheel cutouts
  tank: 'M9.8 8.2h4.6l1.1 2.6H23v2h-7.3l-.6 1.6H5.2l2.4-3.6h1.6ZM5.8 15.4h12.4a3.3 3.3 0 0 1 0 6.6H5.8a3.3 3.3 0 0 1 0-6.6Zm1.6 1.8a1.5 1.5 0 1 0 .01 0Zm5.1 0a1.5 1.5 0 1 0 .01 0Zm5.1 0a1.5 1.5 0 1 0 .01 0Z',
  // howitzer: steeply elevated barrel + wheel + trail
  howitzer: 'M6.4 13.2 18.6 2.6l1.9 2.2L8.3 15.4ZM7.6 13.6a3.6 3.6 0 1 0 .01 0ZM10.6 16.6l9.8 2.6v2l-10.6-2.8Z',
  // supply truck: flatbed + crate stack + forward cab
  harvester: 'M2.4 13.2h13.2v2.4H2.4ZM3.8 8.8h4.6v3.8H3.8Zm5.4-2.4h4.4v6.2H9.2ZM15.4 8.8h3.4l3.2 3.8v3h-6.6Zm1.2 1.6 1.6 0 1.5 1.8h-3.1ZM6.6 15.2a2.6 2.6 0 1 0 .01 0Zm10.6 0a2.6 2.6 0 1 0 .01 0Z',
  // buggy: oversized wheels + raked cage
  buggy: 'M12.4 4.6h2.2l4 4.6-1.6 1.4-3.6-4H9.2L7 9.2 5.2 8.4Zm-8 7h15.2l2 2.6v2H2.6v-2.2ZM6.4 15.2a3.4 3.4 0 1 0 .01 0Zm11.2 0a3.4 3.4 0 1 0 .01 0Z',
  // jet: top-view strike jet, nose up, swept delta wings
  jet: 'M12 1.6c.9 1.6 1.5 3.4 1.5 5.4v1.6l7.7 6.2v2.6l-7.7-2.3v3.5l2.7 2v2l-4.2-1-4.2 1v-2l2.7-2v-3.5l-7.7 2.3v-2.6l7.7-6.2V7c0-2 .6-3.8 1.5-5.4Z',

  // ── upgrades ───────────────────────────────────────────────────────────
  sabot: 'M3 11l13-4.6L21.4 11l-5.4 4.6Zm14.8-6.2 3.6-2.2-1 4.2Zm.4 8.2 3 3.2-4.2-.6Z',
  apammo: 'M9.4 3.4h5.2l1.2 7H8.2Zm-1.2 8.6h7.6v8.6H8.2Zm9.6-6.4h3.6v2H19v4h-1.2Z',
  reactive: 'M12 2.6l8.4 3v6.2c0 5-3.4 8.4-8.4 9.6-5-1.2-8.4-4.6-8.4-9.6V5.6Zm0 3.2L6 8v4c0 3.4 2.2 5.8 6 6.9 3.8-1.1 6-3.5 6-6.9V8Z',
  smoke: 'M5 16.4a4.4 4.4 0 0 1 .8-8.7 5.4 5.4 0 0 1 10.4-1.2 4.7 4.7 0 0 1 2.6 8.7 4.3 4.3 0 0 1-2 1.2ZM4.6 18.6h14.8v2H4.6Z',
  barrels: 'M2.6 12.6 19 8l1.4 2.2-15.8 5.2Zm17.6-6 2.2 3.4-1.6 1-2.2-3.4ZM4.4 16.6l4.4 2.6-1 2-4.6-2.4Z',

  // ── campaign nodes ─────────────────────────────────────────────────────
  // battle: crossed swords — left sword (blade+guard+pommel) laid over the
  // right one, whose blade is split into two pieces where it passes beneath
  battle: 'M2.7 3.6 5.4 4.3 15 13.9 16.4 12.6 17.6 13.9 16 15.5 17.7 17.2 18.3 16.6 19.6 17.9 17 20.5 15.7 19.2 16.3 18.6 14.6 16.9 13 18.5 11.7 17.3 13 15.9 3.4 6.3ZM21.3 3.6 20.6 6.3 14.7 12.2 12.7 10.2 18.6 4.3ZM9.3 13.6 9 13.9 7.7 12.6 6.4 13.9 8 15.5 6.3 17.2 5.7 16.6 4.4 17.9 7 20.5 8.3 19.2 7.7 18.6 9.4 16.9 11 18.5 12.3 17.3 11 15.9 11.3 15.6Z',
  elite: 'M12 2.6c4.6 0 8.2 3.4 8.2 7.8 0 2.6-1.2 4.6-3 6v3.4l-2.6-.8-.8 2.4h-3.6l-.8-2.4-2.6.8v-3.4c-1.8-1.4-3-3.4-3-6 0-4.4 3.6-7.8 8.2-7.8ZM8.6 9.2a1.9 1.9 0 1 0 .01 0Zm6.8 0a1.9 1.9 0 1 0 .01 0ZM12 13l1.2 2.6h-2.4Z',
  shop: 'M3.4 13h7.8v7.6H3.4Zm9.4 0h7.8v7.6h-7.8ZM8.2 4.4h7.6V12H8.2Zm2.2 1.6v1.6h3.2V6Zm-4.8 8.6v1.6h3.2v-1.6Zm9.4 0v1.6h3.2v-1.6Z',
  forge: 'M20.8 7.2a5.4 5.4 0 0 1-7.4 6.4l-7 7-2.4-2.4 7-7a5.4 5.4 0 0 1 6.4-7.4L14 7.2l2.8 2.8Z',
  loot: 'M3.4 9.4h17.2V20H3.4Zm0-1.8 2-3.8h13.2l2 3.8Zm6.4 4v2.6h4.4v-2.6Z',
  event: 'M12 2.8a9.2 9.2 0 1 0 .01 0ZM12 5a7 7 0 1 1-.01 0Zm-.1 2.2c1.9 0 3.3 1.2 3.3 2.9 0 2-2.3 2.3-2.3 3.8h-2c0-2.3 2.2-2.4 2.2-3.7 0-.7-.5-1.1-1.3-1.1s-1.3.5-1.4 1.3l-2-.3c.2-1.8 1.6-2.9 3.5-2.9ZM11 16h2v2h-2Z',
  boss: 'M5 2.6h2.2v18.8H5ZM8.2 4.2H20l-2.6 3.6L20 11.4H8.2ZM10.8 6v3.6h2V6Zm3.8 0v3.6h2V6Z',

  // ── system ─────────────────────────────────────────────────────────────
  lock: 'M12 2.6a4.8 4.8 0 0 1 4.8 4.8v3H18a1.8 1.8 0 0 1 1.8 1.8v7.2A1.8 1.8 0 0 1 18 21.2H6a1.8 1.8 0 0 1-1.8-1.8v-7.2A1.8 1.8 0 0 1 6 10.4h1.2v-3A4.8 4.8 0 0 1 12 2.6Zm0 2.2a2.6 2.6 0 0 0-2.6 2.6v3h5.2v-3A2.6 2.6 0 0 0 12 4.8Zm0 9a1.6 1.6 0 0 0-.9 2.9v2h1.8v-2a1.6 1.6 0 0 0-.9-2.9Z',
  soundOn: 'M4 9h3.6L13 4.4v15.2L7.6 15H4Zm12.2-1.4a6 6 0 0 1 0 8.8l-1.4-1.5a4 4 0 0 0 0-5.8Zm2.4-2.8a9.8 9.8 0 0 1 0 14.4l-1.4-1.5a7.8 7.8 0 0 0 0-11.4Z',
  soundOff: 'M4 9h3.6L13 4.4v15.2L7.6 15H4Zm17.4-.4-2.4 2.4 2.4 2.4-1.5 1.5-2.4-2.4-2.4 2.4-1.5-1.5 2.4-2.4-2.4-2.4 1.5-1.5 2.4 2.4 2.4-2.4Z',
  flip: 'M8.4 3.2 12 6.8l-3.6 3.6-1.5-1.5 1-1.1H7a3.4 3.4 0 0 0-3.4 3.4H1.4A5.6 5.6 0 0 1 7 5.6h.9l-1-1ZM22.6 12.8A5.6 5.6 0 0 1 17 18.4h-.9l1 1-1.5 1.4L12 17.2l3.6-3.6 1.5 1.5-1 1.1h.9a3.4 3.4 0 0 0 3.4-3.4Z',
  check: 'M9.4 16.2 4.8 11.6 2.6 13.8l6.8 6.8L21.4 8.6l-2.2-2.2Z',
  play: 'M7 4.4l11.4 7.6L7 19.6Z',
  star: 'M12 2.4l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.3l-5.8 3.4 1.5-6.4L2.8 9l6.5-.6Z',
  x: 'M6.2 4.6 12 10.4l5.8-5.8 1.6 1.6L13.6 12l5.8 5.8-1.6 1.6L12 13.6l-5.8 5.8-1.6-1.6L10.4 12 4.6 6.2Z',
  chevR: 'M9 4.6 16.4 12 9 19.4 7.2 17.6 12.8 12 7.2 6.4Z',
  alert: 'M12 3 22.4 21H1.6Zm-1 7h2v5h-2Zm0 6.4h2v2h-2Z',
  boltOff: 'M13.8 1.8 9.4 7.4l4.7 4.7 5.3-2.3h-5.6ZM4.6 13.4h5.5L8.4 22.2l6-6.8ZM3.6 3.2l17.2 17.2-1.5 1.5L2.1 4.7Z',
};

/** raw 24×24 path data — card art reuses these for the upgrade medals */
export function iconPath(name: string): string {
  return P[name] ?? '';
}

/** evenodd lets the cut-out shapes (clock cores, door openings) read */
export function icon(name: keyof typeof P | string, cls = ''): string {
  const d = P[name as string];
  if (!d) return '';
  return `<svg class="icn${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
}

/** card subject → icon name (B sides share the base subject's glyph) */
export function cardIcon(cardId: string): string {
  const base = cardId.replace(/_b$/, '');
  const byKind: Record<string, string> = {
    powerplant: 'powerplant', extractor: 'extractor', derrick: 'derrick',
    barracks: 'barracks', factory: 'factory', bunker: 'bunker', atturret: 'atturret',
    rifle: 'rifle', rocket: 'rocket', tank: 'tank', howitzer: 'howitzer',
    harvester: 'harvester', buggy: 'buggy', airstrike: 'jet',
    sabot: 'sabot', apammo: 'apammo', reactive: 'reactive', smoke: 'smoke', barrels: 'barrels',
    defendorder: 'reactive', attackorder: 'battle', spreadorder: 'flip',
    hitpower: 'power', hiteconomy: 'gold'
  };
  return byKind[base] ?? 'star';
}

export const NODE_ICON_NAMES: Record<string, string> = {
  battle: 'battle', elite: 'elite', shop: 'shop', forge: 'forge',
  loot: 'loot', event: 'event', boss: 'boss'
};
