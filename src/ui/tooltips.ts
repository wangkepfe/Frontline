import { UPGRADE_EFFECTS, FOREST_COVER, SMOKE_COVER, FORGE_UNIT, FORGE_BUILDING, FORGE_STRIKE } from '../sim/stats';

/**
 * Keyword glossary + a lightweight tooltip layer. Combat doctrine like "Sabot
 * Rounds" or "Reactive Armor" is jargon — wherever a known term appears on a
 * card (name or description, outside the live battle hand) it becomes a hover/
 * tap target that explains what it actually DOES, with the real numbers pulled
 * from the sim's balance tables so the help can never drift from the mechanics.
 *
 * Strictly a UI layer: nothing here touches the deterministic sim or the
 * network, so it can never cause a desync.
 */

export interface GlossEntry {
  id: string;
  term: string; // the exact phrase as it appears on cards
  body: string;
}

const pct = (mult: number, dir: 'more' | 'less'): string => {
  const d = dir === 'more' ? mult - 1 : 1 - mult;
  return `${Math.round(d * 100)}%`;
};

export const GLOSSARY: GlossEntry[] = [
  {
    id: 'sabot',
    term: 'Sabot Rounds',
    body: `Armour-piercing tank shells. Your Battle Tanks deal +${pct(UPGRADE_EFFECTS.sabot, 'more')} cannon damage against enemy ARMOUR (tanks). It swings an even tank-on-tank duel decisively your way. No effect against infantry or buildings.`
  },
  {
    id: 'apammo',
    term: 'AP Ammo',
    body: `Armour-piercing small-arms. Your Rifle Squads hit vehicles for ${UPGRADE_EFFECTS.apammo}× their normal (tiny) anti-armour damage — enough that a wall of infantry can actually threaten tanks instead of bouncing off them.`
  },
  {
    id: 'reactive',
    term: 'Reactive Armor',
    body: `Explosive reactive plating on your vehicles. Incoming anti-tank (AT) fire — rockets, AT turrets — does ${pct(UPGRADE_EFFECTS.reactive, 'less')} less damage to your tanks, so they survive the front far longer.`
  },
  {
    id: 'smoke',
    term: 'Smoke Doctrine',
    body: `Smoke screens. Your infantry in forest take ${Math.round(SMOKE_COVER * 100)}% less ranged damage (up from the base ${Math.round(FOREST_COVER * 100)}% forest cover) — troops in the treeline become very hard to dig out.`
  },
  {
    id: 'barrels',
    term: 'Extended Barrels',
    body: `Longer gun tubes. Your Mobile Howitzers gain +${UPGRADE_EFFECTS.barrels} range, letting them out-stick enemy artillery and shell a base from beyond its defences.`
  },
  {
    id: 'armor-class',
    term: 'vs armor',
    body: 'ARMOUR is the toughest class (tanks). Cannons and anti-tank weapons handle it well; rifle small-arms barely scratch it unless you have AP Ammo.'
  },
  {
    id: 'veteran',
    term: 'Veteran',
    body: `A refitted (Veteran) card is permanently upgraded for this run: units +${pct(FORGE_UNIT.hp, 'more')} HP and +${pct(FORGE_UNIT.dmg, 'more')} damage; buildings +${pct(FORGE_BUILDING.hp, 'more')} HP, +${pct(FORGE_BUILDING.rate, 'more')} output and faster production; air/artillery strikes +${pct(FORGE_STRIKE, 'more')} damage.`
  }
];

const BY_TERM = new Map(GLOSSARY.map((g) => [g.term.toLowerCase(), g]));
const BY_ID = new Map(GLOSSARY.map((g) => [g.id, g]));
// longest phrases first so "Reactive Armor" matches before a bare "armor"
const TERMS = [...GLOSSARY].map((g) => g.term).sort((a, b) => b.length - a.length);
const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERM_RE = new RegExp(`(${TERMS.map(escapeReg).join('|')})`, 'g');

/**
 * Wrap any glossary term found in a plain-text fragment (a card name or
 * description) in a hover/tap target. The input must be plain text, NOT markup
 * — call it on `def.name` / `def.desc` before they are placed into a face.
 */
export function glossify(text: string): string {
  return text.replace(TERM_RE, (m) => {
    const g = BY_TERM.get(m.toLowerCase());
    return g ? `<span class="kw" data-kw="${g.id}" tabindex="0">${m}</span>` : m;
  });
}

let tipEl: HTMLElement | null = null;
let pinned = false; // a tap/click pins the tip open until dismissed

function ensureTip(): HTMLElement {
  if (tipEl) return tipEl;
  const el = document.createElement('div');
  el.className = 'kw-tip hidden';
  document.body.appendChild(el);
  tipEl = el;
  return el;
}

function showTip(target: HTMLElement): void {
  const g = BY_ID.get(target.dataset.kw ?? '');
  if (!g) return;
  const tip = ensureTip();
  tip.innerHTML = `<b>${g.term}</b><span>${g.body}</span>`;
  tip.classList.remove('hidden');
  // measure, then clamp into the viewport above the term (below if no room)
  const r = target.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.top - th - 10;
  tip.classList.toggle('below', top < 8);
  if (top < 8) top = r.bottom + 10;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideTip(): void {
  pinned = false;
  tipEl?.classList.add('hidden');
}

/** Install the global tooltip handlers once at boot. Idempotent. */
let installed = false;
export function initTooltips(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerover', (ev) => {
    if (pinned) return;
    const t = (ev.target as HTMLElement | null)?.closest?.('[data-kw]') as HTMLElement | null;
    if (t) showTip(t);
  });
  document.addEventListener('pointerout', (ev) => {
    if (pinned) return;
    const t = (ev.target as HTMLElement | null)?.closest?.('[data-kw]');
    if (t) hideTip();
  });
  // tap/click pins (touch has no hover); a second tap or an outside tap closes
  document.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement | null)?.closest?.('[data-kw]') as HTMLElement | null;
    if (t) {
      if (pinned && tipEl && !tipEl.classList.contains('hidden')) {
        hideTip();
      } else {
        showTip(t);
        pinned = true;
      }
      return;
    }
    if (pinned) hideTip();
  });
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}
