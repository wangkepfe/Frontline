import { CARDS } from '../sim/cards';
import { icon } from './icons';
import { cardArt } from './cardArt';

/**
 * Dev-only design gallery (`?gallery`): every icon, every art plate, and the
 * card in every state, on one scrollable page — the 2D counterpart of the
 * 3D atelier. Never imported by the game itself.
 */
export function runGallery(): void {
  document.getElementById('hud')?.classList.add('hidden');
  const root = document.createElement('div');
  root.id = 'gallery';

  const ICONS = [
    'gold', 'oil', 'power', 'pop', 'clock', 'req',
    'powerplant', 'extractor', 'derrick', 'barracks', 'factory', 'bunker', 'atturret',
    'rifle', 'rocket', 'tank', 'howitzer', 'harvester', 'buggy', 'jet',
    'sabot', 'apammo', 'reactive', 'smoke', 'barrels',
    'battle', 'elite', 'shop', 'forge', 'loot', 'event', 'boss',
    'lock', 'soundOn', 'soundOff', 'flip', 'check', 'play', 'star', 'x', 'chevR', 'alert', 'boltOff'
  ];

  let html = '<h2 class="gal-h">ICONS — 24px / 16px</h2><div class="gal-icons">';
  for (const n of ICONS) {
    html += `<div class="gal-icon"><span class="big">${icon(n)}</span><span class="sml">${icon(n)}</span><label>${n}</label></div>`;
  }
  html += '</div>';

  html += '<h2 class="gal-h">ART PLATES — every card</h2><div class="gal-plates">';
  for (const id of Object.keys(CARDS)) {
    html += `<div class="gal-plate">${cardArt(id)}<label>${id}</label></div>`;
  }
  html += '</div>';

  html += '<h2 class="gal-h">HAND CARDS — states</h2><div class="gal-cards" id="gal-cards"></div>';
  root.innerHTML = html;
  document.body.appendChild(root);

  // sample hand cards in every state, using the real face renderer
  void import('./cardFace').then(({ renderCardFaceInto }) => {
    const wrap = document.getElementById('gal-cards')!;
    const states: Array<[string, string, boolean]> = [
      ['tank', '', false], ['tank', 'armed', false], ['rifle', 'unaffordable', false],
      ['factory', 'locked', false], ['howitzer', 'expiring', false], ['airstrike_b', '', false],
      ['tank_b', '', true], ['sabot', '', false], ['powerplant', '', false], ['extractor', '', false]
    ];
    for (const [id, cls, up] of states) {
      const el = document.createElement('div');
      el.className = `card ${cls}${up ? ' up' : ''}`;
      renderCardFaceInto(el, id, up, 4);
      if (cls === 'expiring') {
        const ttl = el.querySelector('.ttl b');
        if (ttl) ttl.textContent = '0:05';
      }
      const cell = document.createElement('div');
      cell.className = 'gal-card';
      cell.appendChild(el);
      const lab = document.createElement('label');
      lab.textContent = `${id}${cls ? ' · ' + cls : ''}${up ? ' · refit' : ''}`;
      cell.appendChild(lab);
      wrap.appendChild(cell);
    }
    const empty = document.createElement('div');
    empty.className = 'gal-card';
    empty.innerHTML = '<div class="card empty" data-key="4"></div><label>empty desk slot</label>';
    wrap.appendChild(empty);
  });
}
