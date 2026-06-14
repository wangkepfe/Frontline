import './style.css';
import { Game } from './game';
import { Hud } from './ui/hud';
import { CARDS, DEFAULT_LOADOUT, AI_LOADOUTS, tierLabel, type CardTier } from './sim/cards';
import { AI_PROFILES } from './sim/ai';
import { LOADOUT_SIZE } from './sim/stats';
import type { Sim } from './sim/sim';
import { MISSIONS, completeTutorial, tutorialProgress, Mission } from './tutorial';
import { generateMap } from './sim/mapgen';
import { sfx } from './audio/sfx';
import {
  RunState, clearRun, loadRun, newRun, nodeById, saveRun, battleOptions
} from './campaign/run';
import {
  closeModal, hideCampaignMap, openModal, renderCampaignMap, showBattlePreview,
  showDeckOverlay, showEvent, showForge, showLoot, showRewards, showShop
} from './ui/campaignUi';
import { cardFaceHtml } from './ui/cardFace';
import { cardIcon, icon } from './ui/icons';

// declarative icon slots: <el data-icn="name"> gets its glyph at boot
for (const el of document.querySelectorAll<HTMLElement>('[data-icn]')) {
  el.insertAdjacentHTML('afterbegin', icon(el.dataset.icn!));
}

// HUD scale: the command-center chrome is authored at 1920×1080 and follows
// the window via --uiscale (style.css zooms the posts/slips/overlay boxes;
// world badges scale their font instead — their px anchors must stay true)
function fitUiScale(): void {
  const s = Math.min(3, Math.max(0.75, Math.min(window.innerWidth / 1920, window.innerHeight / 1080)));
  document.documentElement.style.setProperty('--uiscale', s.toFixed(3));
}
window.addEventListener('resize', fitUiScale);
fitUiScale();

const stage = document.getElementById('stage')!;
const menuEl = document.getElementById('menu')!;
const endEl = document.getElementById('end')!;
const editorEl = document.getElementById('loadout-editor')!;

const hud = new Hud();
let game: Game | null = null;

function freshSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

function killMatch(): void {
  hideBattleOverlays();
  game?.dispose();
  game = null;
  hud.hide();
}

// ── in-battle pause menu & deck inspector ───────────────────────────────────

const pauseEl = document.getElementById('pause')!;
const deckviewEl = document.getElementById('deckview')!;
let surrenderArmed = false;

function resetSurrender(): void {
  surrenderArmed = false;
  const b = document.getElementById('btn-pause-surrender')!;
  b.textContent = 'SURRENDER';
  b.classList.remove('danger');
}

function syncPause(): void {
  game?.setPaused(!pauseEl.classList.contains('hidden') || !deckviewEl.classList.contains('hidden'));
}

function hideBattleOverlays(): void {
  pauseEl.classList.add('hidden');
  deckviewEl.classList.add('hidden');
  resetSurrender();
  game?.setPaused(false);
}

function showPauseMenu(): void {
  if (!game || game.isEnded) return;
  deckviewEl.classList.add('hidden');
  resetSurrender();
  pauseEl.classList.remove('hidden');
  syncPause();
}

/** read-only mid-battle deck list — A/B sides flip only in the campaign loadout phase */
function renderDeckView(): void {
  const loadout = game!.sim.players[0].loadout;
  const tierRank = (t: CardTier): number => (t === 'base' ? -1 : t);
  const sorted = [...loadout].sort((a, b) => {
    const da = CARDS[a.id], db = CARDS[b.id];
    const ta = tierRank(da.tier), tb = tierRank(db.tier);
    if (ta !== tb) return ta - tb;
    if (da.gold !== db.gold) return da.gold - db.gold;
    return da.name.localeCompare(db.name);
  });
  document.getElementById('deckview-cards')!.innerHTML = sorted.map((c) => cardFaceHtml(c.id, c.up)).join('');
  document.getElementById('deckview-count')!.textContent = `${loadout.length} CARDS`;
}

function toggleDeckView(): void {
  if (!game || game.isEnded) return;
  if (!deckviewEl.classList.contains('hidden')) {
    hideBattleOverlays();
    return;
  }
  renderDeckView();
  pauseEl.classList.add('hidden');
  deckviewEl.classList.remove('hidden');
  syncPause();
}

/** Esc backs out: any open overlay closes (resume), otherwise the pause menu opens */
function onBattleEscape(): void {
  if (!game || game.isEnded) return;
  if (!pauseEl.classList.contains('hidden') || !deckviewEl.classList.contains('hidden')) {
    hideBattleOverlays();
  } else {
    showPauseMenu();
  }
}

/** shared Game options for every battle mode */
function battleUiOptions() {
  return { onEscape: onBattleEscape, onToggleDeck: toggleDeckView };
}

document.getElementById('btn-resume')!.addEventListener('click', hideBattleOverlays);
document.getElementById('btn-pause-deck')!.addEventListener('click', toggleDeckView);
document.getElementById('btn-deckview-close')!.addEventListener('click', hideBattleOverlays);
document.getElementById('btn-pausemenu')!.addEventListener('pointerdown', (ev) => {
  ev.stopPropagation();
  showPauseMenu();
});
document.getElementById('btn-deckview')!.addEventListener('pointerdown', (ev) => {
  ev.stopPropagation();
  toggleDeckView();
});
document.getElementById('btn-pause-surrender')!.addEventListener('click', () => {
  if (!game) return;
  if (!surrenderArmed) {
    surrenderArmed = true;
    const b = document.getElementById('btn-pause-surrender')!;
    b.textContent = 'CONFIRM SURRENDER?';
    b.classList.add('danger');
    return;
  }
  const g = game;
  hideBattleOverlays();
  g.surrender(); // runs the mode's normal defeat flow
});

function showMenu(): void {
  killMatch();
  closeModal();
  hideCampaignMap();
  endEl.classList.add('hidden');
  editorEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  const run = loadRun();
  const status = document.getElementById('campaign-status')!;
  status.textContent = run
    ? `run in progress — ${run.battlesWon} battles won, ${run.deck.length} cards, ⛁ ${run.req}`
    : 'start a new operation';
  const prog = tutorialProgress();
  document.getElementById('btn-tutorial')!.innerHTML =
    `${icon('play')} TUTORIAL ${prog >= MISSIONS.length ? '(COMPLETE)' : `(${prog}/${MISSIONS.length})`}`;
}

// ── skirmish ────────────────────────────────────────────────────────────────

const LS_KEY = 'frontline.loadout.v1';

function loadLoadout(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [...DEFAULT_LOADOUT];
    const arr = JSON.parse(raw) as string[];
    // a saved loadout without a power plant predates the tech tree — it would be unplayable
    if (Array.isArray(arr) && arr.length === LOADOUT_SIZE && arr.every((id) => CARDS[id]) && arr.includes('powerplant')) {
      return arr;
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_LOADOUT];
}

function saveLoadout(loadout: string[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(loadout));
}

const ENEMY_CONFIG: Record<string, { loadout: string[]; profile: keyof typeof AI_PROFILES }> = {
  standard: { loadout: AI_LOADOUTS.balanced, profile: 'standard' },
  aggressive: { loadout: AI_LOADOUTS.rush, profile: 'aggressive' },
  turtle: { loadout: AI_LOADOUTS.armor, profile: 'turtle' }
};

function selectedEnemy(): { loadout: string[]; profile: keyof typeof AI_PROFILES } {
  const checked = document.querySelector('input[name="enemy"]:checked') as HTMLInputElement | null;
  return ENEMY_CONFIG[checked?.value ?? 'standard'];
}

function startSkirmish(): void {
  killMatch();
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hud.show();
  const enemy = selectedEnemy();
  const seed = freshSeed();
  game = new Game(stage, hud, {
    seed,
    playerLoadout: loadLoadout(),
    aiLoadout: enemy.loadout,
    aiProfile: AI_PROFILES[enemy.profile],
    simOptions: { mapLayout: generateMap(seed), rules: { manualCollect: true } },
    onEnd: showSkirmishEnd,
    ...battleUiOptions()
  });
}

function showSkirmishEnd(winner: number, sim: Sim): void {
  const win = winner === 0;
  const title = document.getElementById('end-title')!;
  title.textContent = win ? 'VICTORY' : 'DEFEAT';
  title.className = win ? 'win' : 'loss';
  const m = Math.floor(sim.time / 60);
  const s = Math.floor(sim.time % 60);
  document.getElementById('end-stats')!.innerHTML = `
    <div><span>Battle length</span><b>${m}:${s.toString().padStart(2, '0')}</b></div>
    <div><span>Damage dealt</span><b>${Math.round(sim.players[0].damageDealt)}</b></div>
    <div><span>Damage taken</span><b>${Math.round(sim.players[1].damageDealt)}</b></div>
  `;
  endEl.classList.remove('hidden');
}

document.getElementById('btn-deploy')!.addEventListener('click', startSkirmish);
document.getElementById('btn-again')!.addEventListener('click', startSkirmish);
document.getElementById('btn-menu')!.addEventListener('click', showMenu);

// ── tutorial ────────────────────────────────────────────────────────────────

function showTutorialSelect(): void {
  const prog = tutorialProgress();
  const rows = MISSIONS.map((m) => {
    const locked = m.id > prog + 1;
    const done = m.id <= prog;
    return `<button class="tut-row ${locked ? 'locked' : done ? 'done' : ''}" data-mission="${m.id}" ${locked ? 'disabled' : ''}>
      <b>${icon(done ? 'check' : locked ? 'lock' : 'play')} ${m.id}. ${m.name}</b><i>${m.blurb}</i>
    </button>`;
  }).join('');
  const body = openModal(`
    <h2>${icon('play')} FIELD TRAINING</h2>
    <div class="modal-actions vertical">${rows}</div>
    <div class="modal-actions"><button id="m-close">BACK</button></div>
  `);
  body.querySelectorAll<HTMLButtonElement>('[data-mission]:not(.locked)').forEach((b) => {
    b.addEventListener('click', () => {
      closeModal();
      startTutorial(MISSIONS[parseInt(b.dataset.mission!, 10) - 1]);
    });
  });
  body.querySelector('#m-close')!.addEventListener('click', closeModal);
}

function startTutorial(mission: Mission): void {
  killMatch();
  menuEl.classList.add('hidden');
  hud.show();
  game = new Game(stage, hud, {
    ...mission.build(freshSeed()),
    ...battleUiOptions(),
    onEnd: (winner) => {
      killMatch();
      if (winner === 0) completeTutorial(mission.id);
      showMenu();
      const next = MISSIONS[mission.id]; // next mission (id is 1-based)
      const body = openModal(`
        <h2 class="${winner === 0 ? 'win' : 'loss'}">${winner === 0 ? `${icon('check')} MISSION COMPLETE` : `${icon('x')} MISSION FAILED`}</h2>
        <p class="event-desc">${winner === 0 ? `${mission.name} cleared.` : 'The HQ fell. Adjust and go again.'}</p>
        <div class="modal-actions">
          <button id="m-menu">MENU</button>
          <button id="m-retry">${winner === 0 ? 'REPLAY' : 'RETRY'}</button>
          ${winner === 0 && next ? '<button id="m-next" class="primary">NEXT MISSION</button>' : ''}
        </div>
      `);
      body.querySelector('#m-menu')!.addEventListener('click', closeModal);
      body.querySelector('#m-retry')!.addEventListener('click', () => {
        closeModal();
        startTutorial(mission);
      });
      body.querySelector('#m-next')?.addEventListener('click', () => {
        closeModal();
        startTutorial(next);
      });
    }
  });
}

document.getElementById('btn-tutorial')!.addEventListener('click', showTutorialSelect);

// ── campaign ────────────────────────────────────────────────────────────────

let run: RunState | null = null;

function campaignCallbacks() {
  return {
    onNode: onCampaignNode,
    onDeck: () => showDeckOverlay(run!, () => saveRun(run!), showCampaign),
    onAbandon: confirmAbandon
  };
}

function showCampaign(): void {
  killMatch();
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  renderCampaignMap(run!, campaignCallbacks());
}

function confirmAbandon(): void {
  const body = openModal(`
    <h2>ABANDON OPERATION?</h2>
    <p class="event-desc">The run will be lost. The front will remember.</p>
    <div class="modal-actions">
      <button id="m-no">STAY</button>
      <button id="m-yes" class="primary">ABANDON</button>
    </div>
  `);
  body.querySelector('#m-no')!.addEventListener('click', closeModal);
  body.querySelector('#m-yes')!.addEventListener('click', () => {
    clearRun();
    run = null;
    closeModal();
    showMenu();
  });
}

function onCampaignNode(nodeId: number): void {
  const node = nodeById(run!, nodeId);
  if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') {
    showBattlePreview(run!, nodeId, {
      onDeploy: () => startCampaignBattle(nodeId),
      onLoadout: () => showDeckOverlay(run!, () => saveRun(run!), () => onCampaignNode(nodeId)),
      onCancel: () => showCampaign()
    });
    return;
  }
  // service sites: move there immediately
  run!.at = nodeId;
  saveRun(run!);
  const done = () => {
    saveRun(run!);
    showCampaign();
  };
  const save = () => saveRun(run!);
  switch (node.type) {
    case 'shop': showShop(run!, nodeId, save, done); break;
    case 'forge': showForge(run!, save, done); break;
    case 'loot': showLoot(run!, nodeId, save, done); break;
    case 'event': showEvent(run!, nodeId, save, done); break;
  }
}

function startCampaignBattle(nodeId: number): void {
  const node = nodeById(run!, nodeId);
  hideCampaignMap();
  hud.show();
  game = new Game(stage, hud, {
    ...battleOptions(run!, nodeId),
    ...battleUiOptions(),
    onEnd: (winner) => {
      killMatch();
      if (winner === 0) {
        run!.at = nodeId;
        run!.battlesWon++;
        saveRun(run!);
        if (node.type === 'boss') {
          run!.victory = true;
          clearRun();
          const body = openModal(`
            <h2 class="win">${icon('star')} OPERATION COMPLETE</h2>
            <p class="event-desc">The stronghold has fallen. ${run!.battlesWon} battles won with a force of ${run!.deck.length} cards.</p>
            <div class="modal-actions"><button id="m-menu" class="primary">RETURN TO COMMAND</button></div>
          `);
          body.querySelector('#m-menu')!.addEventListener('click', () => {
            run = null;
            closeModal();
            showMenu();
          });
        } else {
          showCampaign();
          showRewards(run!, nodeId, () => {
            saveRun(run!);
            showCampaign();
          });
        }
      } else {
        clearRun();
        const body = openModal(`
          <h2 class="loss">${icon('x')} OPERATION FAILED</h2>
          <p class="event-desc">Your HQ fell. ${run!.battlesWon} battles won. The run is over.</p>
          <div class="modal-actions"><button id="m-menu" class="primary">RETURN TO COMMAND</button></div>
        `);
        body.querySelector('#m-menu')!.addEventListener('click', () => {
          run = null;
          closeModal();
          showMenu();
        });
      }
    }
  });
}

document.getElementById('btn-campaign')!.addEventListener('click', () => {
  run = loadRun();
  if (!run) {
    run = newRun(freshSeed());
    saveRun(run);
  }
  showCampaign();
});

// ── skirmish loadout editor ─────────────────────────────────────────────────

let editCounts = new Map<string, number>();

function countsFrom(loadout: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of loadout) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

function editorTotal(): number {
  let t = 0;
  for (const [, n] of editCounts) t += n;
  return t;
}

function renderEditor(): void {
  const list = document.getElementById('card-list')!;
  if (list.childElementCount === 0) {
    for (const id of Object.keys(CARDS)) {
      if (CARDS[id].side === 'B') continue; // B sides are campaign-only flips
      const def = CARDS[id];
      const row = document.createElement('div');
      row.className = 'card-row';
      row.dataset.kind = def.kind;
      row.innerHTML = `
        <div class="row-icon" data-kind="${def.kind}">${icon(cardIcon(id))}</div>
        <div class="row-main">
          <div class="row-name">${def.name} <span class="row-kind">${def.kind} · ${tierLabel(def.tier)}</span></div>
          <div class="row-desc">${def.desc}</div>
        </div>
        <div class="row-cost"><span class="chip gold">${def.gold}</span>${def.oil > 0 ? `<span class="chip oil">${def.oil}</span>` : ''}</div>
        <div class="stepper">
          <button data-id="${id}" data-d="-1">−</button>
          <b id="cnt-${id}">0</b>
          <button data-id="${id}" data-d="1">+</button>
        </div>
      `;
      list.appendChild(row);
    }
    list.addEventListener('click', (ev) => {
      const btn = ev.target as HTMLElement;
      const id = btn.dataset?.id;
      if (!id) return;
      const d = parseInt(btn.dataset.d!, 10);
      const cur = editCounts.get(id) ?? 0;
      const next = Math.max(0, Math.min(6, cur + d));
      if (d > 0 && editorTotal() >= LOADOUT_SIZE) return;
      editCounts.set(id, next);
      renderEditor();
    });
  }
  for (const id of Object.keys(CARDS)) {
    const el = document.getElementById(`cnt-${id}`);
    if (el) el.textContent = String(editCounts.get(id) ?? 0);
  }
  const total = editorTotal();
  document.getElementById('deck-count')!.textContent = `${total} / ${LOADOUT_SIZE}`;
  (document.getElementById('btn-save-loadout') as HTMLButtonElement).disabled = total !== LOADOUT_SIZE;
}

document.getElementById('btn-loadout')!.addEventListener('click', () => {
  editCounts = countsFrom(loadLoadout());
  menuEl.classList.add('hidden');
  editorEl.classList.remove('hidden');
  renderEditor();
});

for (const [btnId, preset] of [
  ['btn-preset-balanced', AI_LOADOUTS.balanced],
  ['btn-preset-armor', AI_LOADOUTS.armor],
  ['btn-preset-rush', AI_LOADOUTS.rush]
] as const) {
  document.getElementById(btnId)!.addEventListener('click', () => {
    editCounts = countsFrom([...preset]);
    renderEditor();
  });
}

document.getElementById('btn-save-loadout')!.addEventListener('click', () => {
  const loadout: string[] = [];
  for (const [id, n] of editCounts) for (let i = 0; i < n; i++) loadout.push(id);
  if (loadout.length !== LOADOUT_SIZE) return;
  saveLoadout(loadout);
  editorEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
});

document.getElementById('btn-back-loadout')!.addEventListener('click', () => {
  editorEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
});

// ── audio ───────────────────────────────────────────────────────────────────

sfx.install();
// every button click ticks; M toggles mute anywhere
document.addEventListener('click', (ev) => {
  if ((ev.target as HTMLElement | null)?.closest?.('button')) sfx.play('ui_click');
});
const muteBtn = document.getElementById('btn-mute')!;
const syncMuteIcon = () => (muteBtn.innerHTML = icon(sfx.muted ? 'soundOff' : 'soundOn'));
muteBtn.addEventListener('pointerdown', (ev) => {
  ev.stopPropagation();
  sfx.toggleMute();
  syncMuteIcon();
});
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'm' || ev.key === 'M') {
    sfx.toggleMute();
    syncMuteIcon();
  }
});
syncMuteIcon();

// the desktop (Electron) shell gets a proper way out from the main menu
if (navigator.userAgent.includes('Electron')) {
  const exitBtn = document.getElementById('btn-exit')!;
  exitBtn.classList.remove('hidden');
  exitBtn.addEventListener('click', () => window.close());
}

// ── boot ────────────────────────────────────────────────────────────────────

// dev review stages: ?atelier=<kind>|all (3D assets), ?gallery (2D design system)
const bootParams = new URLSearchParams(location.search);
const atelierSpec = bootParams.get('atelier');
if (atelierSpec !== null) {
  menuEl.classList.add('hidden');
  void import('./render/art/atelier').then((m) => m.runAtelier(atelierSpec));
} else if (bootParams.get('gallery') !== null) {
  menuEl.classList.add('hidden');
  void import('./ui/gallery').then((m) => m.runGallery());
} else {
  showMenu();
}
