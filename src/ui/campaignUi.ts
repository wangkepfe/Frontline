import { CARDS, flipSide } from '../sim/cards';
import {
  BattleIntel, CampaignEvent, NodeType, RunState, NODE_LABELS, actBiome, actConfig, addCard,
  battleIntel, flipCard, lootRoll, nodeById, pickEvent, removeCard,
  selectableNodes, shopStock, upgradeCard, victoryRewards
} from '../campaign/run';
import { TUNING } from '../campaign/tuning';
import { Rng } from '../sim/rng';
import type { Sim } from '../sim/sim';
import { GameMap } from '../sim/map';
import { CampaignMapScene } from '../render/campaignMap';
import { cardFaceHtml, forgeDeltas } from './cardFace';
import { NODE_ICON_NAMES, cardIcon, icon } from './icons';

/** DOM + 3D layer for the campaign: war-table node map, deck overlay, sites,
 *  rewards, battle preview. The map is a real 3D diorama (CampaignMapScene)
 *  with transparent DOM hotspots over each node prop. */

/** short front name per biome, shown on the act pill + battle preview + splash */
export const BIOME_FRONT: Record<string, string> = {
  temperate: 'THE GREEN FRONT', desert: 'THE DUST FRONT', winter: 'THE IRON WINTER'
};

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

/** before→after stat chips for a forge refit (the "why it's better") */
function forgeDeltaHtml(cardId: string): string {
  const ds = forgeDeltas(cardId);
  if (!ds.length) return '';
  return `<div class="forge-deltas">${ds
    .map((d) => `<span class="fd"><i>${d.label}</i><b>${d.from}</b><em>→</em><b class="up">${d.to}</b></span>`)
    .join('')}</div>`;
}

/** a card can only be meaningfully forged if it has stats a refit improves */
function forgeable(cardId: string): boolean {
  return forgeDeltas(cardId).length > 0;
}

/** post-upgrade confirmation: show WHICH card was refitted and exactly what improved */
function showUpgradeResult(cardId: string, onDone: () => void, title = 'REFIT COMPLETE'): void {
  const def = CARDS[cardId];
  const body = openModal(`
    <h2>${icon('forge')} ${title}</h2>
    <p class="dim small">${def.name} is promoted to <b class="vet-word">VETERAN</b> — permanently upgraded for this run:</p>
    <div class="reward-row">${cardFace(cardId, true)}</div>
    ${forgeDeltaHtml(cardId)}
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

/** the live 3D map scene; reused across in-act re-renders, disposed on leave */
let mapScene: CampaignMapScene | null = null;

/** inner HTML for a node hotspot — an icon marker + a hover label */
function hotspotHtml(type: NodeType): string {
  return `<span class="cn-marker ${type}">${icon(NODE_ICON_NAMES[type])}</span><span class="cn-label">${NODE_LABELS[type]}</span>`;
}

/** ◆ per reserve left, ◇ per spent slot — one visual language for reserves across
 *  the map pill, the battle preview, and the FORCES REPELLED modal */
export function reservePips(reserves: number): string {
  const max = TUNING.reserves.max;
  const left = Math.max(0, Math.min(max, reserves));
  return '◆'.repeat(left) + '◇'.repeat(Math.max(0, max - left));
}

/** how prominently an enemy card reads as a THREAT (lower = show first in intel):
 *  army-wide upgrades and heavy armor lead; the economy backbone trails */
function threatRank(id: string): number {
  const d = CARDS[id];
  if (d.kind === 'upgrade') return 0;
  if (d.unit === 'harvester') return 6; // the supply truck is eco support, not a threat
  if (d.kind === 'unit') return d.tier === 2 ? 1 : 3;
  if (d.kind === 'tactic') return 2;
  if (d.building === 'powerplant' || d.building === 'extractor' || d.building === 'derrick') return 6; // eco backbone last
  return 4; // barracks / factory / bunker / atturret
}

export function renderCampaignMap(run: RunState, cb: MapCallbacks): void {
  const screen = el('campaign');
  screen.classList.remove('hidden');
  el('camp-req').textContent = `⛁ ${run.req}`;
  el('camp-deck-count').textContent = `${run.deck.length}`;
  // reserves ("lives"): filled pips for what's left, hollow for spent (up to max)
  const rsvEl = el('camp-reserves');
  rsvEl.textContent = `${reservePips(run.reserves)} RESERVES`;
  rsvEl.classList.toggle('depleted', run.reserves <= 0);

  // act banner: codename + ACT n/3 · front
  const cfg = actConfig(run);
  el('camp-title').textContent = cfg.name;
  el('camp-act').textContent = `ACT ${run.act + 1}/3 · ${BIOME_FRONT[cfg.biome] ?? ''}`;

  const wrap = el('cmap');
  if (!mapScene) mapScene = new CampaignMapScene(wrap);
  mapScene.render(
    {
      biome: actBiome(run),
      nodes: run.nodes.map((n) => ({ id: n.id, col: n.col, row: n.row, type: n.type, next: n.next })),
      at: run.at,
      selectable: selectableNodes(run),
      seed: run.seed
    },
    { onNode: cb.onNode, hotspot: (type) => hotspotHtml(type) }
  );

  el('btn-camp-deck').onclick = cb.onDeck;
  el('btn-camp-abandon').onclick = cb.onAbandon;
  el('camp-legend').innerHTML = (Object.keys(NODE_LABELS) as Array<keyof typeof NODE_LABELS>)
    .map((t) => `<span>${icon(NODE_ICON_NAMES[t])} ${NODE_LABELS[t].toUpperCase()}</span>`)
    .join('');
}

export function hideCampaignMap(): void {
  el('campaign').classList.add('hidden');
  mapScene?.dispose();
  mapScene = null;
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
    // lead with the standout threats (upgrades, heavy armor), trail the eco backbone
    .sort((a, b) => threatRank(a[0]) - threatRank(b[0]) || (CARDS[b[0]].gold + CARDS[b[0]].oil) - (CARDS[a[0]].gold + CARDS[a[0]].oil))
    .slice(0, 6)
    .map(([id, n]) => `<span class="intel-chip${CARDS[id].kind === 'upgrade' ? ' upgrade' : ''}">${icon(cardIcon(id))} ${CARDS[id].name}${n > 1 ? ` ×${n}` : ''}</span>`)
    .join('');
  const body = openModal(`
    <h2>${icon(NODE_ICON_NAMES[node.type])} ${NODE_LABELS[node.type].toUpperCase()}</h2>
    <div class="preview-grid">
      <div>
        <canvas id="minimap" width="220" height="220"></canvas>
        <div class="dim small center">${BIOME_FRONT[intel.biome] ?? ''} · ${intel.layoutName}</div>
      </div>
      <div class="intel">
        <div class="intel-name">${intel.enemyName}</div>
        <div class="intel-rows">${intelRows}</div>
        <div class="dim small">Enemy supply rate: ${Math.round(intel.incomeMult * 100)}%</div>
        <div class="dim small">Your force: ${run.deck.length} cards</div>
        <div class="dim small">Reserves: <b class="${run.reserves <= 0 ? 'rsv-last' : ''}">${reservePips(run.reserves)}</b>${run.reserves <= 0 ? ' — LAST STAND' : ''}</div>
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

// ── victory window: per-battle stats + choose-one spoils ─────────────────────

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * The victory window: a sitrep for the battle just won, then a CHOICE of one
 * reward — requisition (money), recruit a card (pick 1 of N), or a Veteran
 * promotion. Elite wins are richer; boss wins richer still (and let you aim the
 * promotion). All mutations land on `run`; onDone advances the campaign.
 */
export function showVictory(run: RunState, nodeId: number, sim: Sim, onDone: () => void): void {
  const rw = victoryRewards(run, nodeId);
  const heading =
    rw.tier === 'boss' ? `${icon('star')} STRONGHOLD TAKEN` :
    rw.tier === 'elite' ? `${icon('star')} ELITE BROKEN` :
    `${icon('star')} VICTORY`;
  const m = Math.floor(sim.time / 60), s = Math.floor(sim.time % 60);
  const stats = `
    <div class="vstats">
      <div><span>Duration</span><b>${m}:${pad2(s)}</b></div>
      <div><span>Damage dealt</span><b>${Math.round(sim.players[0].damageDealt)}</b></div>
      <div><span>Damage taken</span><b>${Math.round(sim.players[1].damageDealt)}</b></div>
      <div><span>Force size</span><b>${run.deck.length} cards</b></div>
      <div><span>Battles won</span><b>${run.battlesWon}</b></div>
    </div>`;
  const canPromote = run.deck.some((c) => !c.up && forgeable(c.id));

  const finish = () => {
    closeModal();
    onDone();
  };

  // ── reward step 2: recruit a card (pick one) ──
  const showRecruit = () => {
    const body = openModal(`
      <h2 class="win">${icon('battle')} RECRUIT</h2>
      <p class="dim small">Add one card to your force${rw.tier !== 'battle' ? ' — a richer pool for this win' : ''}.</p>
      <div class="reward-row">${rw.cards.map((id) => cardFace(id, false, 'pickable')).join('')}</div>
      <div class="modal-actions"><button id="m-back">BACK</button></div>
    `);
    body.querySelectorAll<HTMLElement>('.ccard.pickable').forEach((c) => {
      c.addEventListener('click', () => {
        addCard(run, c.dataset.card!);
        finish();
      });
    });
    body.querySelector('#m-back')!.addEventListener('click', renderChoice);
  };

  // ── reward step 2: Veteran promotion ──
  const promoteRandom = () => {
    const cands = run.deck.filter((c) => !c.up && forgeable(c.id));
    const rng = new Rng(run.seed * 53 + nodeId * 17 + 71 + (run.attempt ?? 0) * 101);
    const pick = cands[rng.int(cands.length)];
    upgradeCard(run, pick.uid);
    showUpgradeResult(pick.id, onDone, 'FIELD PROMOTION');
  };
  const showPromotePicker = () => {
    const cands = run.deck.filter((c) => !c.up && forgeable(c.id));
    const rows = cands
      .map((c) => {
        const preview = forgeDeltas(c.id).map((d) => `${d.label} ${d.from}→${d.to}`).join(' · ');
        return `<div class="deck-row removable forge-row" data-uid="${c.uid}">${rowIcon(c.id)}<span class="deck-name">${CARDS[c.id].name}<span class="vet-arrow">→ ${icon('star')}VETERAN</span></span><span class="deck-desc forge-preview">${preview}</span>${rowCost(c.id)}</div>`;
      })
      .join('');
    const body = openModal(`
      <h2>${icon('forge')} FIELD PROMOTION</h2>
      <p class="dim small">Boss spoils — choose any card to promote to <b>VETERAN</b>.</p>
      <div class="deck-list">${rows}</div>
      <div class="modal-actions"><button id="m-back">BACK</button></div>
    `);
    body.querySelectorAll<HTMLElement>('.deck-row.removable').forEach((r) => {
      r.addEventListener('click', () => {
        const uid = parseInt(r.dataset.uid!, 10);
        upgradeCard(run, uid);
        const card = run.deck.find((c) => c.uid === uid);
        showUpgradeResult(card ? card.id : '', onDone, 'FIELD PROMOTION');
      });
    });
    body.querySelector('#m-back')!.addEventListener('click', renderChoice);
  };

  // ── reward step 1: stats + the three choices ──
  function renderChoice(): void {
    const body = openModal(`
      <h2 class="win">${heading}</h2>
      ${stats}
      <p class="dim small">Claim your spoils — choose one:</p>
      <div class="reward-choices">
        <button class="reward-choice" id="rc-money">
          <span class="rc-icon">${icon('gold')}</span>
          <b>+${rw.money} ⛁</b><i>Requisition — spend at depots</i>
        </button>
        <button class="reward-choice" id="rc-card">
          <span class="rc-icon">${icon('battle')}</span>
          <b>Recruit a card</b><i>Pick 1 of ${rw.cards.length}</i>
        </button>
        <button class="reward-choice" id="rc-promote" ${canPromote ? '' : 'disabled'}>
          <span class="rc-icon">${icon('forge')}</span>
          <b>Field promotion</b><i>${canPromote ? (rw.promoteChoice ? 'Promote any card to Veteran' : 'Promote a card to Veteran') : 'No card to promote'}</i>
        </button>
      </div>
    `);
    body.querySelector('#rc-money')!.addEventListener('click', () => {
      run.req += rw.money;
      finish();
    });
    body.querySelector('#rc-card')!.addEventListener('click', showRecruit);
    const promoteBtn = body.querySelector('#rc-promote') as HTMLButtonElement;
    if (canPromote) {
      promoteBtn.addEventListener('click', rw.promoteChoice ? showPromotePicker : promoteRandom);
    }
  }

  renderChoice();
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
  const candidates = run.deck.filter((c) => !c.up && forgeable(c.id));
  const rows = candidates
    .map((c) => {
      const preview = forgeDeltas(c.id).map((d) => `${d.label} ${d.from}→${d.to}`).join(' · ');
      return `<div class="deck-row removable forge-row" data-uid="${c.uid}">${rowIcon(c.id)}<span class="deck-name">${CARDS[c.id].name}<span class="vet-arrow">→ ${icon('star')}VETERAN</span></span><span class="deck-desc forge-preview">${preview}</span>${rowCost(c.id)}</div>`;
    })
    .join('');
  const body = openModal(`
    <h2>${icon('forge')} FIELD WORKSHOP</h2>
    <p class="dim small">Refit one card to <b>VETERAN</b> — the upgrade is permanent for this run. Each row shows exactly what improves.</p>
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
        const cands = run.deck.filter((c) => !c.up && forgeable(c.id));
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
