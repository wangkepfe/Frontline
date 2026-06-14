import { CARDS, flipSide } from '../sim/cards';
import {
  BattleIntel, CampaignEvent, RunState, NODE_LABELS, addCard, battleIntel,
  battleRewards, flipCard, lootRoll, nodeById, pickEvent, removeCard, selectableNodes,
  shopStock, upgradeCard
} from '../campaign/run';
import { Rng } from '../sim/rng';
import { GameMap } from '../sim/map';
import { cardFaceHtml } from './cardFace';
import { NODE_ICON_NAMES, cardIcon, icon } from './icons';

/** DOM layer for the campaign: node map, deck overlay, sites, rewards, preview. */

/** minimap inks — the exact world-palette base tones (palette.ts) */
const TERRAIN_COLORS: Record<string, string> = {
  land: '#c7b68c', forest: '#55703f', mountain: '#8d8374', water: '#2e6470',
  bridge: '#8d6840', gold: '#cc9b30', oil: '#201f1c'
};

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export function cardFace(id: string, up: boolean, cls = ''): string {
  return cardFaceHtml(id, up, cls);
}

/** deck/list row icon plate, tinted by card kind */
function rowIcon(id: string): string {
  return `<span class="row-icon" data-kind="${CARDS[id].kind}">${icon(cardIcon(id))}</span>`;
}

/** cost chips for a deck/list row */
function rowCost(id: string): string {
  const def = CARDS[id];
  return `<span class="row-cost"><span class="chip gold">${def.gold}</span>${def.oil > 0 ? `<span class="chip oil">${def.oil}</span>` : ''}</span>`;
}

/** post-upgrade confirmation: show WHICH card was refitted */
function showUpgradeResult(cardId: string, onDone: () => void, title = 'REFIT COMPLETE'): void {
  const body = openModal(`
    <h2>${icon('forge')} ${title}</h2>
    <p class="dim small">Permanently refitted for this run — tougher, harder-hitting hardware:</p>
    <div class="reward-row">${cardFace(cardId, true)}</div>
    <div class="modal-actions"><button id="m-ok" class="primary">CONTINUE</button></div>
  `);
  body.querySelector('#m-ok')!.addEventListener('click', () => {
    closeModal();
    onDone();
  });
}

// ── generic modal ────────────────────────────────────────────────────────────

export function openModal(html: string): HTMLElement {
  const modal = el('modal');
  el('modal-body').innerHTML = html;
  modal.classList.remove('hidden');
  return el('modal-body');
}

export function closeModal(): void {
  el('modal').classList.add('hidden');
  el('modal-body').innerHTML = '';
}

// ── campaign map ─────────────────────────────────────────────────────────────

export interface MapCallbacks {
  onNode: (id: number) => void;
  onDeck: () => void;
  onAbandon: () => void;
}

export function renderCampaignMap(run: RunState, cb: MapCallbacks): void {
  const screen = el('campaign');
  screen.classList.remove('hidden');
  el('camp-req').textContent = `⛁ ${run.req}`;
  el('camp-deck-count').textContent = `${run.deck.length}`;

  const wrap = el('cmap');
  const W = wrap.clientWidth || 980;
  const H = wrap.clientHeight || 470;
  const selectable = new Set(selectableNodes(run));
  const colX = (col: number) => 50 + (col * (W - 110)) / 8;
  const rowY = (n: { row: number; id: number }) => 60 + n.row * ((H - 120) / 2) + (((n.id * 37) % 26) - 13);

  let svg = `<svg width="${W}" height="${H}">`;
  for (const n of run.nodes) {
    for (const m of n.next) {
      const t = nodeById(run, m);
      const onPath = n.id === run.at && selectable.has(m);
      svg += `<line x1="${colX(n.col)}" y1="${rowY(n)}" x2="${colX(t.col)}" y2="${rowY(t)}" class="cedge${onPath ? ' active' : ''}"/>`;
    }
  }
  svg += '</svg>';

  let html = svg;
  for (const n of run.nodes) {
    const state = n.id === run.at ? 'here' : selectable.has(n.id) ? 'open' : 'locked';
    const half = n.type === 'boss' ? 32 : 25;
    html += `
      <button class="cnode ${n.type} ${state}" data-node="${n.id}"
        style="left:${colX(n.col) - half}px; top:${rowY(n) - half}px"
        title="${NODE_LABELS[n.type]}">${icon(NODE_ICON_NAMES[n.type])}</button>`;
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll<HTMLButtonElement>('.cnode.open').forEach((b) => {
    b.addEventListener('click', () => cb.onNode(parseInt(b.dataset.node!, 10)));
  });
  el('btn-camp-deck').onclick = cb.onDeck;
  el('btn-camp-abandon').onclick = cb.onAbandon;
  el('camp-legend').innerHTML = (Object.keys(NODE_LABELS) as Array<keyof typeof NODE_LABELS>)
    .map((t) => `<span>${icon(NODE_ICON_NAMES[t])} ${NODE_LABELS[t].toUpperCase()}</span>`)
    .join('');
}

export function hideCampaignMap(): void {
  el('campaign').classList.add('hidden');
}

// ── deck overlay (loadout phase: A/B flips live here) ───────────────────────

export function showDeckOverlay(run: RunState, onChange: () => void, onClose: () => void): void {
  // sorted once per open — a flip repaints only its own cell, so the grid never
  // reshuffles under the cursor; reopening the overlay sorts afresh
  const order = [...run.deck]
    .sort((a, b) => (CARDS[a.id].kind + a.id).localeCompare(CARDS[b.id].kind + b.id))
    .map((c) => c.uid);
  const flipLabel = (id: string) => `${icon('flip')} ${CARDS[flipSide(id)!].name}`;
  const cells = order
    .flatMap((uid) => run.deck.filter((c) => c.uid === uid))
    .map((c) => `
      <div class="deck-cell">
        ${cardFace(c.id, c.up)}
        ${flipSide(c.id)
          ? `<button class="mini flipbtn" data-uid="${c.uid}">${flipLabel(c.id)}</button>`
          : '<span class="mini-ghost">—</span>'}
      </div>`)
    .join('');
  const body = openModal(`
    <h2>YOUR FORCE <span class="dim">(${run.deck.length} cards — you carry them all into battle)</span></h2>
    <p class="dim small">⇄ flips a card to its other side. Sides can only be changed here, between battles.</p>
    <div class="deck-grid">${cells}</div>
    <div class="modal-actions"><button id="m-close" class="primary">DONE</button></div>
  `);
  body.querySelectorAll<HTMLButtonElement>('.flipbtn').forEach((b) => {
    b.addEventListener('click', () => {
      const uid = parseInt(b.dataset.uid!, 10);
      if (!flipCard(run, uid)) return;
      onChange();
      const card = run.deck.find((c) => c.uid === uid)!;
      b.closest('.deck-cell')!.querySelector('.ccard')!.outerHTML = cardFace(card.id, card.up);
      b.innerHTML = flipLabel(card.id);
    });
  });
  body.querySelector('#m-close')!.addEventListener('click', () => {
    closeModal();
    onClose();
  });
}

// ── battle preview ───────────────────────────────────────────────────────────

function paintMinimap(canvas: HTMLCanvasElement, intel: BattleIntel): void {
  const map = new GameMap(intel.layout);
  const s = canvas.width / 13;
  const g = canvas.getContext('2d')!;
  g.save();
  // match the battle camera (scene.ts: SW of center looking NE) — player HQ
  // at the bottom of the diamond, enemy at the top
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate(-Math.PI / 4);
  g.scale(0.68, 0.68);
  g.translate(-canvas.width / 2, -canvas.height / 2);
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      g.fillStyle = TERRAIN_COLORS[map.terrainAt(c, r)] ?? '#888';
      g.fillRect(c * s + 0.5, r * s + 0.5, s - 1, s - 1);
    }
  }
  for (const [team, color] of [[0, '#4585e8'], [1, '#e85d30']] as const) {
    const hq = map.hq[team];
    g.fillStyle = color;
    g.fillRect(hq.c * s - 2, hq.r * s - 2, s + 4, s + 4);
  }
  g.restore();
}

export function showBattlePreview(
  run: RunState,
  nodeId: number,
  cb: { onDeploy: () => void; onLoadout: () => void; onCancel: () => void }
): void {
  const node = nodeById(run, nodeId);
  const intel = battleIntel(run, nodeId);
  const deckSummary = intel.enemyDeck
    .reduce<Record<string, number>>((acc, id) => ((acc[id] = (acc[id] ?? 0) + 1), acc), {});
  const intelRows = Object.entries(deckSummary)
    .slice(0, 6)
    .map(([id, n]) => `<span class="intel-chip">${icon(cardIcon(id))} ${CARDS[id].name}${n > 1 ? ` ×${n}` : ''}</span>`)
    .join('');
  const body = openModal(`
    <h2>${icon(NODE_ICON_NAMES[node.type])} ${NODE_LABELS[node.type].toUpperCase()}</h2>
    <div class="preview-grid">
      <div>
        <canvas id="minimap" width="220" height="220"></canvas>
        <div class="dim small center">${intel.layoutName}</div>
      </div>
      <div class="intel">
        <div class="intel-name">${intel.enemyName}</div>
        <div class="intel-rows">${intelRows}</div>
        <div class="dim small">Enemy supply rate: ${Math.round(intel.incomeMult * 100)}%</div>
        <div class="dim small">Your force: ${run.deck.length} cards</div>
      </div>
    </div>
    <div class="modal-actions">
      <button id="m-cancel">BACK</button>
      <button id="m-loadout">LOADOUT</button>
      <button id="m-deploy" class="primary">${icon('chevR')} DEPLOY</button>
    </div>
  `);
  paintMinimap(body.querySelector('#minimap') as HTMLCanvasElement, intel);
  body.querySelector('#m-deploy')!.addEventListener('click', () => {
    closeModal();
    cb.onDeploy();
  });
  body.querySelector('#m-loadout')!.addEventListener('click', () => {
    closeModal();
    cb.onLoadout();
  });
  body.querySelector('#m-cancel')!.addEventListener('click', () => {
    closeModal();
    cb.onCancel();
  });
}

// ── battle rewards: 3 choose 1 ───────────────────────────────────────────────

export function showRewards(run: RunState, nodeId: number, onDone: () => void): void {
  const { cards, req } = battleRewards(run, nodeId);
  run.req += req;
  const body = openModal(`
    <h2 class="win">${icon('star')} VICTORY SPOILS ${req > 0 ? `<span class="reqgain">+${req} ⛁</span>` : ''}</h2>
    <p class="dim small">Add one card to your force.</p>
    <div class="reward-row">${cards.map((id) => cardFace(id, false, 'pickable')).join('')}</div>
    <div class="modal-actions"><button id="m-skip">SKIP</button></div>
  `);
  body.querySelectorAll<HTMLElement>('.ccard.pickable').forEach((c) => {
    c.addEventListener('click', () => {
      addCard(run, c.dataset.card!);
      closeModal();
      onDone();
    });
  });
  body.querySelector('#m-skip')!.addEventListener('click', () => {
    closeModal();
    onDone();
  });
}

// ── sites ────────────────────────────────────────────────────────────────────

export function showShop(run: RunState, nodeId: number, onChange: () => void, onLeave: () => void): void {
  const stock = shopStock(run, nodeId);
  const bought = new Set<number>();
  const render = () => {
    const offers = stock.offers
      .map((o, i) => {
        const afford = run.req >= o.price && !bought.has(i);
        return `<div class="shop-offer">${cardFace(o.id, false)}<button class="${afford ? 'primary' : ''}" data-buy="${i}" ${afford ? '' : 'disabled'}>${bought.has(i) ? 'SOLD' : `${o.price} ⛁`}</button></div>`;
      })
      .join('');
    const body = openModal(`
      <h2>${icon('shop')} SUPPLY DEPOT <span class="reqgain">${run.req} ⛁</span></h2>
      <div class="shop-row">${offers}</div>
      <div class="modal-actions">
        <button id="m-remove" ${run.req >= stock.removePrice && run.deck.length > 6 ? '' : 'disabled'}>DISCHARGE A CARD (${stock.removePrice} ⛁)</button>
        <button id="m-leave" class="primary">LEAVE</button>
      </div>
    `);
    body.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.buy!, 10);
        if (bought.has(i) || run.req < stock.offers[i].price) return;
        run.req -= stock.offers[i].price;
        addCard(run, stock.offers[i].id);
        bought.add(i);
        onChange();
        render();
      });
    });
    body.querySelector('#m-remove')!.addEventListener('click', () => {
      showRemovePicker(run, () => {
        run.req -= stock.removePrice;
        run.removesUsed++;
        onChange();
        render();
      }, render);
    });
    body.querySelector('#m-leave')!.addEventListener('click', () => {
      closeModal();
      onLeave();
    });
  };
  render();
}

function showRemovePicker(run: RunState, onRemoved: () => void, onCancel: () => void): void {
  const rows = run.deck
    .map((c) => `<div class="deck-row removable${c.up ? ' up' : ''}" data-uid="${c.uid}">${rowIcon(c.id)}<span class="deck-name">${CARDS[c.id].name}${c.up ? '<span class="refit-chip">★</span>' : ''}</span><span class="deck-desc">${CARDS[c.id].desc}</span>${rowCost(c.id)}</div>`)
    .join('');
  const body = openModal(`
    <h2>DISCHARGE WHICH CARD?</h2>
    <div class="deck-list">${rows}</div>
    <div class="modal-actions"><button id="m-cancel">CANCEL</button></div>
  `);
  body.querySelectorAll<HTMLElement>('.deck-row.removable').forEach((r) => {
    r.addEventListener('click', () => {
      removeCard(run, parseInt(r.dataset.uid!, 10));
      onRemoved();
    });
  });
  body.querySelector('#m-cancel')!.addEventListener('click', onCancel);
}

export function showForge(run: RunState, onChange: () => void, onLeave: () => void): void {
  const candidates = run.deck.filter((c) => !c.up);
  const rows = candidates
    .map((c) => `<div class="deck-row removable" data-uid="${c.uid}">${rowIcon(c.id)}<span class="deck-name">${CARDS[c.id].name}</span><span class="deck-desc">${CARDS[c.id].desc}</span>${rowCost(c.id)}</div>`)
    .join('');
  const body = openModal(`
    <h2>${icon('forge')} FIELD WORKSHOP</h2>
    <p class="dim small">Refit one card: stronger, tougher, faster. Permanent for this run.</p>
    <div class="deck-list">${rows.length ? rows : '<p class="dim">Everything is already refitted.</p>'}</div>
    <div class="modal-actions"><button id="m-leave" class="primary">LEAVE</button></div>
  `);
  body.querySelectorAll<HTMLElement>('.deck-row.removable').forEach((r) => {
    r.addEventListener('click', () => {
      const uid = parseInt(r.dataset.uid!, 10);
      upgradeCard(run, uid);
      onChange();
      const card = run.deck.find((c) => c.uid === uid);
      showUpgradeResult(card ? card.id : '', onLeave);
    });
  });
  body.querySelector('#m-leave')!.addEventListener('click', () => {
    closeModal();
    onLeave();
  });
}

export function showLoot(run: RunState, nodeId: number, onChange: () => void, onLeave: () => void): void {
  const loot = lootRoll(run, nodeId);
  run.req += loot.req;
  onChange();
  const body = openModal(`
    <h2>${icon('loot')} CACHE RECOVERED <span class="reqgain">+${loot.req} ⛁</span></h2>
    <p class="dim small">There is hardware here too — take it?</p>
    <div class="reward-row">${cardFace(loot.card, false, 'pickable')}</div>
    <div class="modal-actions"><button id="m-skip">LEAVE IT</button></div>
  `);
  body.querySelector('.ccard.pickable')!.addEventListener('click', () => {
    addCard(run, loot.card);
    onChange();
    closeModal();
    onLeave();
  });
  body.querySelector('#m-skip')!.addEventListener('click', () => {
    closeModal();
    onLeave();
  });
}

export function showEvent(run: RunState, nodeId: number, onChange: () => void, onLeave: () => void): void {
  const ev = pickEvent(run, nodeId);
  run.usedEvents.push(ev.id);
  const rng = new Rng(run.seed * 13 + nodeId * 3);

  const finish = () => {
    onChange();
    closeModal();
    onLeave();
  };
  const applyChoice = (choice: CampaignEvent['a'] | CampaignEvent['b']) => {
    switch (choice.kind) {
      case 'req':
        run.req += choice.amount ?? 0;
        finish();
        break;
      case 'card': {
        const id = REWARDABLE[rng.int(REWARDABLE.length)];
        addCard(run, id);
        finish();
        break;
      }
      case 'twoCards': {
        addCard(run, REWARDABLE[rng.int(REWARDABLE.length)]);
        addCard(run, REWARDABLE[rng.int(REWARDABLE.length)]);
        finish();
        break;
      }
      case 'upgradeRandom': {
        const cands = run.deck.filter((c) => !c.up);
        if (cands.length === 0) {
          finish();
          break;
        }
        const pick = cands[rng.int(cands.length)];
        upgradeCard(run, pick.uid);
        onChange();
        showUpgradeResult(pick.id, onLeave, 'FIELD PROMOTION');
        break;
      }
      case 'upgradeChoice': {
        if (run.req < 60) {
          finish();
          break;
        }
        run.req -= 60;
        showForge(run, onChange, onLeave);
        break;
      }
      case 'removeChoice':
        showRemovePicker(run, finish, finish);
        break;
      case 'skip':
        finish();
        break;
    }
  };

  const body = openModal(`
    <h2>${icon('event')} ${ev.title.toUpperCase()}</h2>
    <p class="event-desc">${ev.desc}</p>
    <div class="modal-actions vertical">
      <button id="m-a" class="primary">${ev.a.label}</button>
      <button id="m-b">${ev.b.label}</button>
    </div>
  `);
  body.querySelector('#m-a')!.addEventListener('click', () => applyChoice(ev.a));
  body.querySelector('#m-b')!.addEventListener('click', () => applyChoice(ev.b));
}

const REWARDABLE = ['rifle', 'rocket', 'tank', 'buggy', 'bunker', 'atturret', 'extractor', 'barracks', 'howitzer', 'airstrike', 'harvester', 'powerplant'];
