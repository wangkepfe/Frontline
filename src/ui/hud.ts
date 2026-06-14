import type { Sim } from '../sim/sim';
import { CARDS, CATEGORY_SLOTS, HandCategory, tierRequirement } from '../sim/cards';
import { BUILDING_STATS, ESCALATE_DRAW_T, HAND_SIZE, NUKE_UNLOCK_T, ORDER_DURATION, REFRESH_COST } from '../sim/stats';
import { renderCardFaceInto } from './cardFace';
import { icon } from './icons';
import { OfficerRole, officerPortrait } from './officers';
import type { OrderKind, TeamId } from '../sim/types';

const ORDER_LABELS: Record<OrderKind, string> = {
  defend: 'DEFENSIVE POSTURE',
  attack: 'GENERAL OFFENSIVE',
  spread: 'DISPERSAL ORDER',
  hitPower: 'TARGET: POWER GRID',
  hitEconomy: 'TARGET: ECONOMY'
};

/**
 * DOM HUD — the command center. Four corner posts around the diamond
 * battlefield: statistics console (TL), strategy desk (TR), infrastructure
 * desk (BL), frontline desk (BR). Each desk holds two proposal documents.
 */
export class Hud {
  onCardClick: (slot: number, ev?: PointerEvent) => void = () => {};
  onRefresh: (cat: HandCategory) => void = () => {};
  /** which side this client commands — the HUD always shows the local team's
   *  hand, resources and grid. 0 in single-player; 1 for the multiplayer joiner. */
  localTeam: TeamId = 0;

  private root: HTMLElement;
  private slots: HTMLElement[] = [];
  private slotUids: number[] = new Array(HAND_SIZE).fill(-1);
  private refreshBtns = new Map<HandCategory, HTMLButtonElement>();
  private refreshCosts = new Map<HandCategory, HTMLElement>();
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private armedSlot = -1;
  private hintEl: HTMLElement;
  private hintText: string | null = null;
  private warnShown: string | null = null;
  private orderShown = '';
  /** display offsets make the counters tick up while resource chips fly in */
  private displayOffset = { gold: 0, oil: 0 };

  constructor() {
    this.root = document.getElementById('hud')!;
    this.toastEl = document.getElementById('toast')!;
    this.hintEl = document.getElementById('hint')!;

    // the staff officers take their posts
    for (const el of document.querySelectorAll<HTMLElement>('#hud [data-portrait]')) {
      el.innerHTML = officerPortrait(el.dataset.portrait as OfficerRole);
    }

    // the three desks: fixed global slot indices per category (cards.ts)
    const desks: Record<HandCategory, HTMLElement> = {
      building: document.getElementById('hand-building')!,
      unit: document.getElementById('hand-unit')!,
      action: document.getElementById('hand-action')!
    };
    this.slots = new Array(HAND_SIZE);
    for (const cat of ['building', 'unit', 'action'] as HandCategory[]) {
      desks[cat].innerHTML = '';
      for (const i of CATEGORY_SLOTS[cat]) {
        const el = document.createElement('div');
        el.className = 'card empty';
        el.dataset.key = String(i + 1); // ghost digit on the empty slot plate
        el.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          this.onCardClick(i, ev);
        });
        desks[cat].appendChild(el);
        this.slots[i] = el;
        this.slotUids[i] = -1;
      }
    }

    for (const [id, cat] of [
      ['refresh-building', 'building'],
      ['refresh-unit', 'unit'],
      ['refresh-action', 'action']
    ] as Array<[string, HandCategory]>) {
      const btn = document.getElementById(id) as HTMLButtonElement;
      btn.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.onRefresh(cat);
      });
      this.refreshBtns.set(cat, btn);
      this.refreshCosts.set(cat, btn.querySelector('.cost') as HTMLElement);
    }
  }

  /** Multiplayer link banner: stalled-on-peer notice, desync/disconnect alert. */
  netStatus(text: string | null): void {
    const el = document.getElementById('netwait');
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  showHint(text: string | null): void {
    if (text === this.hintText) return;
    this.hintText = text;
    if (text) {
      this.hintEl.textContent = text;
      this.hintEl.classList.remove('hidden');
    } else {
      this.hintEl.classList.add('hidden');
    }
  }

  /** chips fly from the collected building to the resource pill; counter ticks up on arrival */
  flyResources(which: 'gold' | 'oil', amount: number, fromRect: DOMRect | null): void {
    const to = document.getElementById(`res-${which}`)!.getBoundingClientRect();
    const from = fromRect ?? new DOMRect(to.left, to.top + 160, 40, 20);
    this.displayOffset[which] -= amount;
    const n = Math.min(9, Math.max(3, Math.round(amount / (which === 'gold' ? 12 : 8))));
    for (let i = 0; i < n; i++) {
      const chip = document.createElement('span');
      chip.className = `flychip ${which}`;
      chip.innerHTML = icon(which);
      document.body.appendChild(chip);
      const sx = from.left + from.width / 2 + (Math.random() - 0.5) * 26;
      const sy = from.top + from.height / 2 + (Math.random() - 0.5) * 16;
      const ex = to.left + to.width / 2;
      const ey = to.top + to.height / 2;
      chip.style.left = `${sx}px`;
      chip.style.top = `${sy}px`;
      const lift = 24 + Math.random() * 22;
      chip.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${(ex - sx) * 0.45}px, ${(ey - sy) * 0.3 - lift}px) scale(1.15)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${ex - sx}px, ${ey - sy}px) scale(0.6)`, opacity: 0.9 }
        ],
        { duration: 460 + i * 55, easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)' }
      ).onfinish = () => chip.remove();
    }
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setArmed(slot: number): void {
    this.armedSlot = slot;
    this.slots.forEach((el, i) => el.classList.toggle('armed', i === slot));
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    this.toastTimer = 1.6;
  }

  update(sim: Sim, dtFrame: number): void {
    const team = this.localTeam;
    const p = sim.players[team];
    const tech = sim.rules.tech;
    const live = {
      powerplant: tech && sim.hasLiveBuilding(team, 'powerplant'),
      extractor: tech && sim.hasLiveBuilding(team, 'extractor'),
      derrick: tech && sim.hasLiveBuilding(team, 'derrick')
    };

    // desks
    for (let i = 0; i < HAND_SIZE; i++) {
      const slot = p.hand[i];
      const el = this.slots[i];
      if (!slot) {
        if (this.slotUids[i] !== -1) {
          this.slotUids[i] = -1;
          el.className = 'card empty';
          el.innerHTML = '';
        }
        continue;
      }
      if (slot.uid !== this.slotUids[i]) {
        this.slotUids[i] = slot.uid;
        el.className = slot.card.up ? 'card up deal' : 'card deal';
        renderCardFaceInto(el, slot.card.id, slot.card.up, i);
        requestAnimationFrame(() => el.classList.remove('deal'));
      }
      const def = CARDS[slot.card.id];
      const req = tierRequirement(def);
      const locked = tech && req !== null && !live[req as keyof typeof live];
      const affordable =
        p.gold >= def.gold &&
        p.oil >= def.oil &&
        (def.kind !== 'upgrade' || !p.upgrades.has(def.upgrade!));
      el.classList.toggle('locked', locked);
      el.classList.toggle('unaffordable', !locked && !affordable);
      el.classList.toggle('expiring', slot.ttl < 6);
      el.classList.toggle('armed', i === this.armedSlot);
      // the proposal's expiry stamp — a typed countdown, not a dial
      const ttlEl = el.querySelector('.ttl b') as HTMLElement | null;
      if (ttlEl) {
        const t = Math.max(0, slot.ttl);
        const label = `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
        if (ttlEl.textContent !== label) ttlEl.textContent = label;
      }
    }

    // desk refresh buttons price in live: base cost plus every still-cooling
    // click surcharge; hot-priced while surged, disabled without the gold
    for (const [cat, btn] of this.refreshBtns) {
      const cost = sim.refreshCost(team, cat);
      btn.disabled = p.gold < cost;
      btn.classList.toggle('surged', cost > REFRESH_COST);
      const costEl = this.refreshCosts.get(cat);
      const label = cost.toString();
      if (costEl && costEl.textContent !== label) costEl.textContent = label;
    }

    // console counters tick up while collection chips fly
    for (const which of ['gold', 'oil'] as const) {
      const off = this.displayOffset[which];
      if (off !== 0) {
        const next = off * Math.max(0, 1 - dtFrame * 3.2);
        this.displayOffset[which] = Math.abs(next) < 1 ? 0 : next;
      }
    }
    setText('res-gold', Math.max(0, Math.floor(p.gold + this.displayOffset.gold)).toString());
    setText('res-oil', Math.max(0, Math.floor(p.oil + this.displayOffset.oil)).toString());
    setText('next-deal', `+${Math.max(0, p.drawTimer).toFixed(1)}s`);

    // power meter: demand / capacity, red when the grid is oversubscribed
    const powerPill = document.getElementById('pill-power');
    if (powerPill) {
      if (tech) {
        let cap = 0, demand = 0;
        for (const b of sim.buildings) {
          if (b.team !== team || b.hp <= 0) continue;
          const pw = BUILDING_STATS[b.kind].power;
          if (pw > 0) cap += pw;
          else if (!b.freePower) demand += -pw;
        }
        powerPill.classList.remove('hidden');
        powerPill.classList.toggle('deficit', demand > cap);
        setText('res-power', `${demand}/${cap}`);
      } else {
        powerPill.classList.add('hidden');
      }
    }
    const m = Math.floor(sim.time / 60);
    const s = Math.floor(sim.time % 60);
    setText('clock', `${m}:${s.toString().padStart(2, '0')}`);

    // the strategy desk reports the standing order and its time left
    const orderEl = document.getElementById('order-status');
    if (orderEl) {
      const order = p.order;
      if (order) {
        const left = Math.max(0, Math.ceil(order.until - sim.time));
        const label = `${ORDER_LABELS[order.kind]} — ${left}s`;
        if (this.orderShown !== label) {
          this.orderShown = label;
          orderEl.innerHTML = `${icon('alert')} ${label}`;
          orderEl.classList.remove('hidden');
        }
        orderEl.style.setProperty('--ofrac', `${(left / ORDER_DURATION) * 100}%`);
      } else if (this.orderShown) {
        this.orderShown = '';
        orderEl.classList.add('hidden');
      }
    }

    const warn = document.getElementById('warn')!;
    const warnText = !sim.rules.escalation
      ? null
      : sim.time >= NUKE_UNLOCK_T
        ? 'NUCLEAR WEAPONS UNLOCKED — ONE STRIKE ENDS IT'
        : sim.time >= ESCALATE_DRAW_T
          ? 'SUPPLY SURGE — CARDS ARRIVE FASTER'
          : null;
    if (warnText) {
      if (this.warnShown !== warnText) {
        this.warnShown = warnText;
        warn.innerHTML = `${icon('alert')} ${warnText}`;
        warn.classList.remove('hidden');
      }
    } else if (this.warnShown) {
      this.warnShown = null;
      warn.classList.add('hidden');
    }

    for (const side of ['own', 'enemy'] as const) {
      const t = side === 'own' ? team : (team === 0 ? 1 : 0);
      const hq = sim.hqOf(t);
      const bar = document.querySelector(`.hq-health.${side} .fill`) as HTMLElement | null;
      if (bar) bar.style.width = `${hq ? Math.max(0, (hq.hp / hq.maxHp) * 100) : 0}%`;
    }

    // toast fade
    if (this.toastTimer > 0) {
      this.toastTimer -= dtFrame;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
  }
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}
