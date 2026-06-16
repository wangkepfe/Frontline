import { RunState, actConfig } from '../campaign/run';
import { BIOME_FRONT } from './campaignUi';
import { icon } from './icons';

/**
 * Act-transition splash. Shown over the (already-rendered) biome map when a run
 * starts and after each mid-boss falls, so the change of front lands as a
 * moment. A translucent scrim lets the new biome's war table read behind the
 * title. Click BEGIN to dismiss; the map is live underneath.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

export function showActSplash(run: RunState, onBegin: () => void): void {
  const cfg = actConfig(run);
  const el = document.getElementById('actsplash')!;
  el.className = `actsplash biome-${cfg.biome}`;
  el.innerHTML = `
    <div class="as-inner">
      <div class="as-act">ACT ${ROMAN[run.act] ?? run.act + 1} OF III</div>
      <h1 class="as-front">${BIOME_FRONT[cfg.biome] ?? ''}</h1>
      <div class="as-op">${cfg.name}</div>
      <p class="as-brief">${cfg.brief}</p>
      <button id="as-begin" class="primary big">${icon('chevR')} BEGIN OPERATION</button>
    </div>`;
  const begin = () => {
    el.classList.add('hidden');
    el.innerHTML = '';
    onBegin();
  };
  el.querySelector('#as-begin')!.addEventListener('click', begin);
}

export function hideActSplash(): void {
  const el = document.getElementById('actsplash');
  if (el) {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}
