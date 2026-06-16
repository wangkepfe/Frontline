import './style.css';
import { Game } from './game';
import { Hud } from './ui/hud';
import { CARDS, DEFAULT_LOADOUT, AI_LOADOUTS, baseId, tierLabel, type CardTier } from './sim/cards';
import { profileFromDifficulty, type AiPlaystyle, type AiProfile } from './sim/ai';
import { LOADOUT_SIZE } from './sim/stats';
import type { Sim } from './sim/sim';
import { MISSIONS, completeTutorial, tutorialProgress, Mission } from './tutorial';
import { generateMap } from './sim/mapgen';
import {
  buildTuning, diffLabel, gradeMatch, loadRecord, MUTATORS, paintMinimap, recordMatch,
  type SkirmishConfig
} from './skirmish';
import { sfx } from './audio/sfx';
import {
  RunState, advanceAct, clearRun, isFinalBoss, loadRun, newRun, nodeById, saveRun, battleOptions
} from './campaign/run';
import {
  closeModal, hideCampaignMap, openModal, renderCampaignMap, reservePips, showBattlePreview,
  showDeckOverlay, showEvent, showForge, showLoot, showShop, showVictory
} from './ui/campaignUi';
import { hideActSplash, showActSplash } from './ui/actSplash';
import { cardFaceHtml } from './ui/cardFace';
import { initTooltips } from './ui/tooltips';
import { cardIcon, icon } from './ui/icons';
import { ElectronTransport, netBridge } from './net/electronTransport';
import { hostSession, joinSession, type SessionResult } from './net/session';
import type { Transport } from './net/transport';
import type { TeamId } from './sim/types';

// declarative icon slots: <el data-icn="name"> gets its glyph at boot
for (const el of document.querySelectorAll<HTMLElement>('[data-icn]')) {
  el.insertAdjacentHTML('afterbegin', icon(el.dataset.icn!));
}

// keyword tooltips (Sabot Rounds, Reactive Armor, …) — UI-only, global handlers
initTooltips();

// UI scale: everything is authored at 1920×1080 and follows the window. Two
// scales, because the battle HUD and the full-screen menus want different floors:
//   --uiscale   corner-anchored command-center chrome + field slips + world
//               badges. Shrinks on small screens so the four posts never eat the
//               battlefield; floored low enough that tablets/phones still fit
//               the diamond. (style.css zooms .post/#warn/#hint/#toast; world
//               badges scale their font instead — their px anchors must stay true.)
//   --menuscale full-screen centered UI (menus, campaign, loadout, end, modals,
//               overlays, act splash). Held at native 1.0 from phone up through
//               1080p (it reads crisp and full there), scaled UP on bigger
//               displays, and shrunk only on genuinely small viewports (short
//               laptops, phones) so it fits without clipping.
function fitUiScale(): void {
  const w = window.innerWidth, h = window.innerHeight;
  const ratio = Math.min(w / 1920, h / 1080);
  const ui = Math.min(3, Math.max(0.55, ratio));
  const menu = ratio >= 1
    ? Math.min(3, ratio)
    : Math.max(0.5, Math.min(1, w / 1180, h / 660));
  const root = document.documentElement.style;
  root.setProperty('--uiscale', ui.toFixed(3));
  root.setProperty('--menuscale', menu.toFixed(3));
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
  const loadout = game!.sim.players[game!.localTeam].loadout;
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
  hideActSplash();
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
  renderRecord();
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

// the three skirmish commanders are PLAYSTYLES; the slider sets difficulty
const ENEMY_CONFIG: Record<string, { loadout: string[]; playstyle: AiPlaystyle }> = {
  standard: { loadout: AI_LOADOUTS.balanced, playstyle: 'balanced' },
  aggressive: { loadout: AI_LOADOUTS.rush, playstyle: 'rush' },
  turtle: { loadout: AI_LOADOUTS.armor, playstyle: 'armor' }
};

// briefing-room flavor for each opposing commander
const ENEMY_META: Record<string, { name: string; desc: string }> = {
  standard: { name: 'BALANCED COMMAND', desc: 'combined arms' },
  aggressive: { name: 'THE AGGRESSOR', desc: 'infantry rush' },
  turtle: { name: 'THE FORTRESS', desc: 'armor & turrets' }
};

function aiDifficulty(): number {
  const el = document.getElementById('ai-difficulty') as HTMLInputElement | null;
  return (el ? parseInt(el.value, 10) : 65) / 100;
}

// difficulty slider label tracks the shared scale (also used in the briefing)
{
  const slider = document.getElementById('ai-difficulty') as HTMLInputElement | null;
  const label = document.getElementById('diff-label');
  const sync = () => { if (label) label.textContent = diffLabel(aiDifficulty()); };
  slider?.addEventListener('input', sync);
  sync();
}

// ── match modifiers: composable toggle chips ──
const selectedMutators = new Set<string>();
{
  const host = document.getElementById('mutator-select');
  if (host) {
    host.innerHTML = MUTATORS.map(
      (m) => `<button class="mut-chip" data-mut="${m.id}" title="${m.blurb}">${icon(m.icon)}<span>${m.name}</span></button>`
    ).join('');
    host.querySelectorAll<HTMLButtonElement>('.mut-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.mut!;
        if (selectedMutators.has(id)) selectedMutators.delete(id);
        else selectedMutators.add(id);
        btn.classList.toggle('on', selectedMutators.has(id));
      });
    });
  }
}

// ── service record (persistent across sessions) ──
function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderRecord(): void {
  const el = document.getElementById('skirmish-record');
  if (!el) return;
  const rec = loadRecord();
  if (rec.matches === 0) {
    el.classList.add('hidden');
    return;
  }
  const winPct = Math.round((rec.wins / rec.matches) * 100);
  const stat = (value: string, label: string, hot = false) =>
    `<div class="rec-stat"><b class="${hot ? 'hot' : ''}">${value}</b><span>${label}</span></div>`;
  el.innerHTML = [
    stat(`${rec.wins}–${rec.losses}`, 'Win–Loss'),
    stat(`${winPct}%`, 'Win rate'),
    stat(String(rec.streak), 'Streak', rec.streak >= 3),
    stat(String(rec.bestStreak), 'Best'),
    stat(rec.fastestWin > 0 ? fmtClock(rec.fastestWin) : '—', 'Fastest')
  ].join('');
  el.classList.remove('hidden');
}

// ── launch + pre-deploy briefing ──
interface SkirmishSetup { enemyValue: string; difficulty: number; mutators: Set<string> }
let lastSkirmish: { setup: SkirmishSetup; seed: number } | null = null;

function readMenuSetup(): SkirmishSetup {
  const checked = document.querySelector('input[name="enemy"]:checked') as HTMLInputElement | null;
  return { enemyValue: checked?.value ?? 'standard', difficulty: aiDifficulty(), mutators: new Set(selectedMutators) };
}

function seedTag(seed: number): string {
  return `#${(seed & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Pre-deploy briefing: preview the generated battlefield, the opponent and the
 *  active modifiers — and reroll the map if the layout looks unfair before
 *  committing (a player-side answer to the map lottery). */
function openBriefing(setup: SkirmishSetup, seed: number): void {
  const layout = generateMap(seed);
  const meta = ENEMY_META[setup.enemyValue] ?? ENEMY_META.standard;
  const tuning = buildTuning({ difficulty: setup.difficulty, mutators: setup.mutators } as SkirmishConfig);
  const aiSupply = Math.round(tuning.incomeMult[1] * 100);
  const mods = MUTATORS.filter((m) => setup.mutators.has(m.id));
  const modRows = mods.length
    ? mods.map((m) => `<span class="intel-chip mod">${icon(m.icon)} ${m.name}</span>`).join('')
    : '<span class="dim small">Standard rules</span>';
  const body = openModal(`
    <h2>${icon('battle')} SKIRMISH BRIEFING</h2>
    <div class="preview-grid">
      <div>
        <canvas id="minimap" width="220" height="220"></canvas>
        <div class="dim small center">Battlefield ${seedTag(seed)}</div>
      </div>
      <div class="intel">
        <div class="intel-name">${meta.name}</div>
        <div class="dim small">${meta.desc} · ${diffLabel(setup.difficulty)} commander</div>
        <div class="dim small">Enemy supply rate: <b style="color:var(--ink-hi)">${aiSupply}%</b></div>
        <div class="brief-mods">${modRows}</div>
        <div class="dim small">Your force: ${loadLoadout().length} cards</div>
      </div>
    </div>
    <div class="modal-actions">
      <button id="m-cancel">BACK</button>
      <button id="m-reroll" data-icn="play">NEW MAP</button>
      <button id="m-deploy" class="primary">${icon('chevR')} DEPLOY</button>
    </div>
  `);
  paintMinimap(body.querySelector('#minimap') as HTMLCanvasElement, layout);
  body.querySelector('#m-cancel')!.addEventListener('click', closeModal);
  body.querySelector('#m-reroll')!.addEventListener('click', () => openBriefing(setup, freshSeed()));
  body.querySelector('#m-deploy')!.addEventListener('click', () => {
    closeModal();
    launchSkirmish(setup, seed);
  });
}

function launchSkirmish(setup: SkirmishSetup, seed: number): void {
  killMatch();
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hud.show();
  lastSkirmish = { setup, seed };
  const cfg = ENEMY_CONFIG[setup.enemyValue] ?? ENEMY_CONFIG.standard;
  const profile = profileFromDifficulty(setup.difficulty, cfg.playstyle);
  const tuning = buildTuning({ difficulty: setup.difficulty, mutators: setup.mutators } as SkirmishConfig);
  game = new Game(stage, hud, {
    seed,
    playerLoadout: loadLoadout(),
    aiLoadout: cfg.loadout,
    aiProfile: profile,
    simOptions: {
      mapLayout: generateMap(seed),
      rules: { manualCollect: true, incomeMult: tuning.incomeMult },
      start: tuning.start
    },
    onEnd: (winner, sim) => showSkirmishEnd(winner, sim, setup),
    ...battleUiOptions()
  });
}

function showSkirmishEnd(winner: number, sim: Sim, setup: SkirmishSetup): void {
  const win = winner === 0;
  const ownHq = sim.hqOf(0);
  const enemyHq = sim.hqOf(1);
  const grade = gradeMatch({
    won: win,
    ownHqFrac: ownHq ? Math.max(0, ownHq.hp / ownHq.maxHp) : 0,
    enemyHqFrac: enemyHq ? Math.max(0, enemyHq.hp / enemyHq.maxHp) : 0,
    time: sim.time,
    difficulty: setup.difficulty
  });

  // fold the result into the persistent record and learn which bests it broke
  const rec = loadRecord();
  const damage = sim.players[0].damageDealt;
  const deltas = recordMatch(rec, { won: win, time: sim.time, damage });

  const title = document.getElementById('end-title')!;
  title.textContent = win ? 'VICTORY' : 'DEFEAT';
  title.className = win ? 'win' : 'loss';

  // grade badge
  const gradeEl = document.getElementById('end-grade')!;
  gradeEl.classList.remove('hidden');
  const letterEl = gradeEl.querySelector('.grade-letter') as HTMLElement;
  letterEl.textContent = grade.letter;
  letterEl.className = `grade-letter ${grade.cls}`;
  (gradeEl.querySelector('.grade-blurb') as HTMLElement).textContent = grade.blurb;

  // field-report ledger
  const st = game?.stats ?? { cardsPlayed: 0, collects: 0, peakArmy: 0, enemyLost: 0, ownLost: 0 };
  const row = (label: string, value: string, hot = false) =>
    `<div><span>${label}</span><b class="${hot ? 'hot' : ''}">${value}</b></div>`;
  document.getElementById('end-stats')!.innerHTML = [
    row('Battle length', fmtClock(sim.time), deltas.newFastestWin),
    row('Commander', `${ENEMY_META[setup.enemyValue]?.name ?? '—'} · ${diffLabel(setup.difficulty)}`),
    row('Damage dealt', String(Math.round(damage)), deltas.newMostDamage),
    row('Damage taken', String(Math.round(sim.players[1].damageDealt))),
    row('Peak army', String(st.peakArmy)),
    row('Units destroyed / lost', `${st.enemyLost} / ${st.ownLost}`),
    row('Cards played', String(st.cardsPlayed))
  ].join('');

  // record line: celebrate any new bests, then the running tally
  const bests: string[] = [];
  if (deltas.newFastestWin) bests.push('FASTEST VICTORY');
  if (deltas.newBestStreak) bests.push(`BEST STREAK ${rec.bestStreak}`);
  if (deltas.newMostDamage) bests.push('RECORD DAMAGE');
  const winPct = Math.round((rec.wins / rec.matches) * 100);
  let recHtml = '';
  if (win && rec.streak >= 2) recHtml += `On a <b>${rec.streak}-win</b> streak. `;
  recHtml += `Record <b>${rec.wins}–${rec.losses}</b> · <b>${winPct}%</b> wins.`;
  if (bests.length) recHtml = `<span class="nb">★ NEW ${bests.join(' · ')}</span><br>${recHtml}`;
  const recordEl = document.getElementById('end-record')!;
  recordEl.innerHTML = recHtml;
  recordEl.classList.remove('hidden');

  // rematch the SAME field (learn a brutal map), or brief a fresh one
  document.getElementById('btn-rematch')!.classList.remove('hidden');
  endEl.classList.remove('hidden');
}

document.getElementById('btn-deploy')!.addEventListener('click', () => openBriefing(readMenuSetup(), freshSeed()));
document.getElementById('btn-again')!.addEventListener('click', () => openBriefing(lastSkirmish?.setup ?? readMenuSetup(), freshSeed()));
document.getElementById('btn-rematch')!.addEventListener('click', () => {
  if (lastSkirmish) launchSkirmish(lastSkirmish.setup, lastSkirmish.seed);
});
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
    onEnd: (winner, sim) => {
      killMatch();
      if (winner === 0) {
        run!.at = nodeId;
        run!.battlesWon++;
        run!.attempt = 0; // node cleared — the next first-attempt deals fresh
        saveRun(run!);
        // every win opens the spoils window (stats + choose-one reward); the
        // node-type progression runs only once the player has claimed a reward
        showCampaign();
        showVictory(run!, nodeId, sim, () => {
          saveRun(run!);
          if (node.type === 'boss') {
            if (isFinalBoss(run!, node)) {
              run!.victory = true;
              clearRun();
              const body = openModal(`
                <h2 class="win">${icon('star')} OPERATION COMPLETE</h2>
                <p class="event-desc">The enemy capital has fallen. ${run!.battlesWon} battles won across three fronts with a force of ${run!.deck.length} cards.</p>
                <div class="modal-actions"><button id="m-menu" class="primary">RETURN TO COMMAND</button></div>
              `);
              body.querySelector('#m-menu')!.addEventListener('click', () => {
                run = null;
                closeModal();
                showMenu();
              });
            } else {
              // act cleared — advance to the next biome/front with a splash
              advanceAct(run!);
              saveRun(run!);
              showCampaign();
              showActSplash(run!, () => {});
            }
          } else {
            showCampaign();
          }
        });
      } else if (run!.reserves > 0) {
        // a RESERVE absorbs the loss: regroup and try again, or reroute. run.at is
        // NOT advanced, so the lost node stays selectable on the campaign map.
        run!.reserves--;
        run!.attempt++; // a retry deals a fresh (still fair) card order, not a replay
        saveRun(run!);
        showCampaign();
        const left = run!.reserves;
        const tail = left === 0
          ? `<b class="rsv-last">${reservePips(left)}</b> — that was your last reserve; the next defeat ends the operation.`
          : `<b>${reservePips(left)}</b> — ${left} ${left === 1 ? 'reserve' : 'reserves'} left.`;
        const body = openModal(`
          <h2 class="loss">${icon('alert')} FORCES REPELLED</h2>
          <p class="event-desc">Your assault was thrown back, but the operation holds. ${tail} Adjust your force and try again, or find another route.</p>
          <div class="modal-actions">
            <button id="m-deck">REVIEW DECK</button>
            <button id="m-map" class="primary">RETURN TO MAP</button>
          </div>
        `);
        body.querySelector('#m-map')!.addEventListener('click', closeModal);
        body.querySelector('#m-deck')!.addEventListener('click', () => {
          closeModal();
          showDeckOverlay(run!, () => saveRun(run!), showCampaign);
        });
      } else {
        clearRun();
        const body = openModal(`
          <h2 class="loss">${icon('x')} OPERATION FAILED</h2>
          <p class="event-desc">Reserves exhausted and your HQ fell. ${run!.battlesWon} battles won. The run is over.</p>
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
  const existing = loadRun();
  if (existing) {
    run = existing;
    showCampaign();
  } else {
    // a fresh operation opens with the Act I splash over the new biome map
    run = newRun(freshSeed());
    saveRun(run);
    showCampaign();
    showActSplash(run, () => {});
  }
});

// ── multiplayer (local network) ──────────────────────────────────────────────

const MP_PORT = 47615;

function mpStatus(html: string): void {
  const el = document.getElementById('mp-status');
  if (el) el.innerHTML = html;
}

function showMultiplayerLobby(): void {
  if (!netBridge()) {
    const body = openModal(`
      <h2>${icon('battle')} MULTIPLAYER</h2>
      <p class="event-desc">Local-network multiplayer runs in the FRONTLINE desktop app. Launch the installed game (not a browser) to host or join a LAN match.</p>
      <div class="modal-actions"><button id="m-close" class="primary">BACK</button></div>
    `);
    body.querySelector('#m-close')!.addEventListener('click', closeModal);
    return;
  }
  const body = openModal(`
    <h2>${icon('battle')} LOCAL MULTIPLAYER</h2>
    <p class="event-desc">Two commanders on one network. One hosts; the other joins by IP. Each brings their own SKIRMISH loadout.</p>
    <div class="modal-actions vertical">
      <button id="mp-host" class="primary">HOST GAME</button>
      <button id="mp-join">JOIN GAME</button>
      <button id="mp-cancel">BACK</button>
    </div>
    <div id="mp-status" class="dim small center"></div>
  `);
  body.querySelector('#mp-host')!.addEventListener('click', startHost);
  body.querySelector('#mp-join')!.addEventListener('click', showJoinForm);
  body.querySelector('#mp-cancel')!.addEventListener('click', () => {
    netBridge()?.close();
    closeModal();
  });
}

async function startHost(): Promise<void> {
  const bridge = netBridge();
  if (!bridge) return;
  mpStatus('Starting host…');
  let transport: Transport;
  try {
    transport = new ElectronTransport();
  } catch (e) {
    mpStatus(`Host failed: ${String(e)}`);
    return;
  }
  let res: { ok: boolean; error?: string };
  try {
    res = await bridge.host(MP_PORT);
  } catch (e) {
    mpStatus(`Host failed: ${String(e)}`);
    return;
  }
  if (!res.ok) {
    mpStatus(`Host failed: ${res.error ?? 'unknown error'}`);
    return;
  }
  const ips = await bridge.ips();
  const addr = ips.length ? ips.join(' / ') : 'localhost';
  mpStatus(`Listening on <b>${addr}</b> port <b>${MP_PORT}</b><br/>Have the other player JOIN this address. Waiting…`);
  try {
    const result = await hostSession(transport, loadLoadout(), freshSeed());
    startNetGame(transport, result);
  } catch (e) {
    mpStatus(`Host error: ${String(e)}`);
  }
}

function showJoinForm(): void {
  const body = openModal(`
    <h2>${icon('battle')} JOIN GAME</h2>
    <p class="event-desc">Enter the host's address (shown on their screen).</p>
    <div class="mp-form">
      <input id="mp-ip" type="text" placeholder="192.168.1.50" autocomplete="off" spellcheck="false" />
      <span class="mp-colon">:</span>
      <input id="mp-port" type="text" value="${MP_PORT}" autocomplete="off" spellcheck="false" />
    </div>
    <div class="modal-actions">
      <button id="mp-back">BACK</button>
      <button id="mp-connect" class="primary">CONNECT</button>
    </div>
    <div id="mp-status" class="dim small center"></div>
  `);
  body.querySelector('#mp-back')!.addEventListener('click', showMultiplayerLobby);
  body.querySelector('#mp-connect')!.addEventListener('click', startJoin);
  (body.querySelector('#mp-ip') as HTMLInputElement | null)?.focus();
}

async function startJoin(): Promise<void> {
  const bridge = netBridge();
  if (!bridge) return;
  const ip = (document.getElementById('mp-ip') as HTMLInputElement).value.trim() || '127.0.0.1';
  const port = parseInt((document.getElementById('mp-port') as HTMLInputElement).value, 10) || MP_PORT;
  mpStatus('Connecting…');
  let transport: Transport;
  try {
    transport = new ElectronTransport();
  } catch (e) {
    mpStatus(`Connect failed: ${String(e)}`);
    return;
  }
  let res: { ok: boolean; error?: string };
  try {
    res = await bridge.join(ip, port);
  } catch (e) {
    mpStatus(`Connect failed: ${String(e)}`);
    return;
  }
  if (!res.ok) {
    mpStatus(`Connect failed: ${res.error ?? 'unknown error'}`);
    return;
  }
  mpStatus('Connected — syncing match…');
  try {
    const result = await joinSession(transport, loadLoadout());
    startNetGame(transport, result);
  } catch (e) {
    mpStatus(`Sync error: ${String(e)}`);
  }
}

function startNetGame(transport: Transport, result: SessionResult): void {
  killMatch();
  closeModal();
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hud.show();
  const localTeam = result.localTeam;
  game = new Game(stage, hud, {
    seed: result.seed,
    playerLoadout: result.loadouts[0],
    aiLoadout: result.loadouts[1],
    localTeam,
    transport,
    simOptions: {
      mapLayout: result.map,
      rules: { manualCollect: result.manualCollect, humanTeams: [true, true] }
    },
    onEnd: (winner) => showMpEnd(winner, localTeam),
    onPeerLeft: onMpPeerLeft,
    onDesync: onMpDesync,
    ...battleUiOptions()
  });
}

function showMpEnd(winner: TeamId, localTeam: TeamId): void {
  const win = winner === localTeam;
  const title = document.getElementById('end-title')!;
  title.textContent = win ? 'VICTORY' : 'DEFEAT';
  title.className = win ? 'win' : 'loss';
  // the graded report card + rematch are skirmish-only — keep the MP end clean
  document.getElementById('end-grade')!.classList.add('hidden');
  document.getElementById('end-record')!.classList.add('hidden');
  document.getElementById('btn-rematch')!.classList.add('hidden');
  const sim = game!.sim;
  const m = Math.floor(sim.time / 60);
  const s = Math.floor(sim.time % 60);
  const other: TeamId = localTeam === 0 ? 1 : 0;
  document.getElementById('end-stats')!.innerHTML = `
    <div><span>Battle length</span><b>${m}:${s.toString().padStart(2, '0')}</b></div>
    <div><span>Damage dealt</span><b>${Math.round(sim.players[localTeam].damageDealt)}</b></div>
    <div><span>Damage taken</span><b>${Math.round(sim.players[other].damageDealt)}</b></div>
  `;
  killMatch();
  endEl.classList.remove('hidden');
}

function mpResultModal(titleClass: string, head: string, body: string): void {
  killMatch();
  const el = openModal(`
    <h2 class="${titleClass}">${head}</h2>
    <p class="event-desc">${body}</p>
    <div class="modal-actions"><button id="m-menu" class="primary">MAIN MENU</button></div>
  `);
  el.querySelector('#m-menu')!.addEventListener('click', () => {
    closeModal();
    showMenu();
  });
}

function onMpPeerLeft(): void {
  if (!game || game.isEnded) return; // a clean result resolves itself
  mpResultModal('win', `${icon('star')} OPPONENT LEFT`, 'The other commander disconnected. The field is yours.');
}

function onMpDesync(): void {
  mpResultModal('loss', `${icon('x')} CONNECTION DESYNCED`, 'The two games fell out of sync and the match was aborted.');
}

document.getElementById('btn-multiplayer')!.addEventListener('click', showMultiplayerLobby);

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
    // the editor only handles A sides — fold any B-side preset cards back to base
    editCounts = countsFrom(preset.map((id) => (CARDS[id].side === 'B' ? baseId(id) : id)));
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
} else if (bootParams.get('warmap') !== null) {
  menuEl.classList.add('hidden');
  void import('./render/campaignMap').then((m) => m.runWarmap(bootParams.get('warmap') || 'temperate'));
} else if (bootParams.get('gallery') !== null) {
  menuEl.classList.add('hidden');
  void import('./ui/gallery').then((m) => m.runGallery());
} else {
  showMenu();
}
