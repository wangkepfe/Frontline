import { CARDS, tierLabel, tierRequirement } from '../sim/cards';
import type { CardDef, CardKind } from '../sim/cards';
import {
  AIRSTRIKE, BUILDING_STATS, DERRICK_INCOME, EXTRACTOR_INCOME, FORGE_BUILDING, FORGE_STRIKE,
  FORGE_UNIT, UNIT_STATS
} from '../sim/stats';
import { cardArt } from './cardArt';
import { cardIcon, icon } from './icons';
import { glossify } from './tooltips';

/**
 * The one card-anatomy builder (DESIGN_GUIDEBOOK.md §7) — hand cards, reward
 * cards, and the gallery all print the same face so the anatomy can never
 * drift between contexts.
 *
 * A card is a STAFF PROPOSAL DOCUMENT: a classified requisition slip typed by
 * one of the corner-post officers — paper plate, classification band, printer
 * headline, the field illustration, and a typed expiry countdown. Why cards
 * are timed at all: a proposal not acted on is withdrawn.
 */

export interface FaceOpts {
  /** include the expiry stamp + lock overlay (battle hand context) */
  hand?: boolean;
  /** hotkey digit for the keycap */
  hotkey?: string;
}

/**
 * Classification climbs the tech ladder — the band is the tier retold in
 * paper voice (the tier tag stays mechanical): mundane works papers at the
 * base, TOP SECRET armor at tier 2. The nuke outranks the ladder entirely.
 * `ink` stamps the low rungs in printer ink; SECRET and up stay red.
 */
function classification(def: CardDef): { text: string; ink: boolean } {
  if (def.nuke) return { text: 'EYES ONLY', ink: false };
  switch (def.tier) {
    case 'base': return { text: 'RESTRICTED', ink: true };
    case 0: return { text: 'CONFIDENTIAL', ink: true };
    case 1: return { text: 'SECRET', ink: false };
    case 2: return { text: 'TOP SECRET', ink: false };
  }
}

/**
 * Each desk types its own form: the band's centered title + serial ledger.
 * Longest band (CONFIDENTIAL + BUILDING PROPOSAL — the extractor slip) must
 * fit the 254px band; lengthen titles only after checking that card.
 */
const DOC_FORM: Record<CardKind, { title: string; ledger: string }> = {
  building: { title: 'BUILDING PROPOSAL', ledger: 'RQ' },
  unit: { title: 'TRAINING PROPOSAL', ledger: 'PN' },
  upgrade: { title: 'R&amp;D PROPOSAL', ledger: 'RD' },
  tactic: { title: 'STRATEGY PROPOSAL', ledger: 'OP' }
};

/** stable per-card document serial — flavor, deterministic, never random */
function serial(def: CardDef): string {
  let h = 0;
  for (let i = 0; i < def.id.length; i++) h = (h * 31 + def.id.charCodeAt(i)) | 0;
  return `${DOC_FORM[def.kind].ledger}-${(Math.abs(h) % 900) + 100}`;
}

export function cardFaceInner(cardId: string, upgraded: boolean, opts: FaceOpts = {}): string {
  const def = CARDS[cardId];
  const req = tierRequirement(def);
  const cls = classification(def);
  // glossary keyword links are inert (and could fight click-to-play) in the live
  // battle hand — wire them only on inspectable faces (deck, rewards, shop, …)
  const showKw = !opts.hand;
  const nameHtml = showKw ? glossify(def.name) : def.name;
  const descHtml = showKw ? glossify(def.desc) : def.desc;
  const upBadge = upgraded ? `<span class="upbadge">${icon('star')}</span>` : '';
  // an upgraded card reads as a PROMOTION, not just a starred copy
  const vetTag = upgraded ? '<span class="vettag" data-kw="veteran">VETERAN</span>' : '';
  const sideBadge = def.side === 'B' ? '<span class="sidebadge">B</span>' : '';
  const lock = opts.hand
    ? `<div class="lock">${icon('lock')}<span class="lockreq">${
        req ? `${icon(cardIcon(req))} requires ${CARDS[req].name}` : ''
      }</span></div>`
    : '';
  return `
    <div class="doc-head"><i class="cls${cls.ink ? ' ink' : ''}">${cls.text}</i><b>${DOC_FORM[def.kind].title}</b><i class="serial">${serial(def)}</i></div>
    <div class="art">${cardArt(cardId)}</div>
    <i class="kstripe"></i>
    <div class="cost-col"><span class="cchip gold">${def.gold}</span>${
      def.oil > 0 ? `<span class="cchip oil">${def.oil}</span>` : ''
    }</div>
    <div class="tiertag">${tierLabel(def.tier)}</div>
    <div class="cbody">
      <div class="cname">${nameHtml}${upBadge}${sideBadge}</div>
      <div class="ckind">${vetTag}${def.kind}</div>
      <div class="cdesc">${descHtml}</div>
    </div>
    ${opts.hand ? `<div class="ttl">EXP <b>0:00</b></div><div class="ttlbar"><i></i></div>` : ''}
    ${opts.hotkey ? `<div class="key">${opts.hotkey}</div>` : ''}
    ${lock}`;
}

export interface ForgeDelta { label: string; from: string; to: string }

const r1 = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Before→after stats a Veteran (forge) refit grants a card, so the workshop /
 * reward UI can show exactly WHAT improves and by how much. Pulls live numbers
 * from the balance tables × the card's own A/B mods × the FORGE multipliers.
 */
export function forgeDeltas(cardId: string): ForgeDelta[] {
  const def = CARDS[cardId];
  const out: ForgeDelta[] = [];
  const d = (label: string, base: number, mult: number) =>
    out.push({ label, from: r1(base), to: r1(base * mult) });
  if (def.unit) {
    const st = UNIT_STATS[def.unit];
    d('HP', st.hp * (def.unitMods?.hpMult ?? 1), FORGE_UNIT.hp);
    const dmg = st.damage * (def.unitMods?.dmgMult ?? 1);
    if (dmg > 0) d('Damage', dmg, FORGE_UNIT.dmg);
  } else if (def.building) {
    const st = BUILDING_STATS[def.building];
    d('HP', st.hp * (def.buildingMods?.hpMult ?? 1), FORGE_BUILDING.hp);
    if (def.building === 'extractor') d('Gold / s', EXTRACTOR_INCOME, FORGE_BUILDING.rate);
    else if (def.building === 'derrick') d('Oil / s', DERRICK_INCOME, FORGE_BUILDING.rate);
    else if (st.prodInterval > 0) {
      // shorter is better — show the faster cadence
      const base = st.prodInterval * (def.buildingMods?.prodMult ?? 1);
      out.push({ label: 'Build time', from: `${r1(base)}s`, to: `${r1(base * FORGE_BUILDING.prod)}s` });
    } else if (st.damage > 0) d('Damage', st.damage * (def.buildingMods?.dmgMult ?? 1), FORGE_UNIT.dmg);
  } else if (def.kind === 'tactic' && !def.order && !def.nuke) {
    d('Blast damage', AIRSTRIKE.damage, FORGE_STRIKE);
  }
  return out;
}

/** render a battle-hand face into an existing slot element */
export function renderCardFaceInto(el: HTMLElement, cardId: string, upgraded: boolean, slot: number): void {
  el.dataset.kind = CARDS[cardId].kind;
  el.innerHTML = cardFaceInner(cardId, upgraded, { hand: true, hotkey: '123456'[slot] ?? '' });
}

/** a standalone mini card (rewards, shop, gallery) */
export function cardFaceHtml(cardId: string, upgraded: boolean, cls = ''): string {
  const def = CARDS[cardId];
  return `<div class="ccard ${upgraded ? 'up ' : ''}${cls}" data-card="${cardId}" data-kind="${def.kind}">${
    cardFaceInner(cardId, upgraded)
  }</div>`;
}
