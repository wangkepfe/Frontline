import { CARDS, tierLabel, tierRequirement } from '../sim/cards';
import type { CardDef, CardKind } from '../sim/cards';
import { cardArt } from './cardArt';
import { cardIcon, icon } from './icons';

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
  const upBadge = upgraded ? `<span class="upbadge">${icon('star')}</span>` : '';
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
      <div class="cname">${def.name}${upBadge}${sideBadge}</div>
      <div class="ckind">${def.kind}</div>
      <div class="cdesc">${def.desc}</div>
    </div>
    ${opts.hand ? `<div class="ttl">EXP <b>0:00</b></div>` : ''}
    ${opts.hotkey ? `<div class="key">${opts.hotkey}</div>` : ''}
    ${lock}`;
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
