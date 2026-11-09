import { Avatar, AMBIANCES } from './avatar.js';
import { TagParser, stripTags } from './tags.js';
import { parseVMD } from './vmd.js';

const $ = (s) => document.querySelector(s);
const log = $('#log');
const form = $('#input');
const input = $('#message');
const hint = $('#drop-hint');
const emotionPill = $('#emotion');
const vrmInfo = $('#vrm-info');
const watchingEl = $('#watching');

const isApp = navigator.userAgent.includes('Electron');
const avatar = createAvatar();
// Accès de débogage en développement uniquement (npm run dev / npm run app).
if (import.meta.env?.DEV) window.__avatar = avatar;
let character = { name: '…', emotions: ['neutral'], actions: [] };
let busy = false;

/** Sans WebGL (pilote graphique absent ou bloqué), le chat doit continuer de fonctionner. */
function createAvatar() {
  try {
    return new Avatar($('#scene'));
  } catch (err) {
    console.error(err);
    queueMicrotask(() =>
      addMessage('error', "Affichage 3D indisponible (WebGL). Mets à jour le pilote de ta carte graphique. Le chat reste utilisable."),
    );
    const noop = () => {};
    return {
      setEmotion: noop,
      setSpeaking: noop,
      setAmbiance: noop,
      setLayout: noop,
      setAttention: noop,
      setAct: noop,
      setArousal: noop,
      setVideoPlaying: noop,
      climax: noop,
      setMotion: noop,
      setMotionRate: noop,
      getParts: () => [],
      setPartVisible: noop,
      getMorphs: () => [],
      setMorph: noop,
      setBrightness: noop,
      expressionReport: () => [],
      setSphereStrength: noop,
      previewExpression: noop,
      load: async () => {
        throw new Error('WebGL indisponible');
      },
    };
  }
}

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

function setEmotion(e) {
  avatar.setEmotion(e);
  emotionPill.textContent = e;
}

function addMessage(role, text = '') {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

// ---------- Ambiance ----------
const ambianceNames = Object.keys(AMBIANCES);
let ambiance = load('ambiance', 'neon');
function applyAmbiance(name) {
  ambiance = AMBIANCES[name] ? name : 'neon';
  document.body.dataset.ambiance = ambiance;
  avatar.setAmbiance(ambiance);
  $('#ambiance').title = `Ambiance : ${AMBIANCES[ambiance].label}`;
  save('ambiance', ambiance);
}
$('#ambiance').addEventListener('click', () => {
  applyAmbiance(ambianceNames[(ambianceNames.indexOf(ambiance) + 1) % ambianceNames.length]);
});
applyAmbiance(ambiance);

// ---------- Modèle VRM ----------
async function loadVrm(url) {
  try {
    const meta = await avatar.load(url);
    hint.hidden = true;
    showMeta(meta);
    modelKey = `wardrobe:${meta.title || 'modele'}`;
    for (const name of load(modelKey, [])) avatar.setPartVisible(name, false);
    for (const [name, v] of Object.entries(load(`morphs:${modelKey}`, {}))) avatar.setMorph(name, v);
    // Luminosité mémorisée par type de modèle (les matériaux MMD sont plus sensibles à la lumière).
    // (clé « pmx2 » : l'éclairage MMD a été recalibré, l'ancien réglage à 0,6 ne s'applique plus)
    // 0,85 par défaut pour un PMX : proche du rendu de MMD (lumière 154/255), et laisse voir les reflets.
    brightnessKey = /\.pmx$/i.test(url.split('?')[0]) ? 'brightness:pmx3' : 'brightness:vrm';
    const k = load(brightnessKey, brightnessKey === 'brightness:pmx3' ? 0.85 : 1);
    $('#brightness').value = k;
    avatar.setBrightness(k);
    // Reflets des sphere maps en addition (modèles MMD) : 0,5 par défaut.
    const isPmx = brightnessKey !== 'brightness:vrm';
    $('#sphere-row').hidden = !isPmx;
    const sp = load('sphere:pmx', 0.5);
    $('#sphere').value = sp;
    if (isPmx) avatar.setSphereStrength(sp);
    renderWardrobe();
    renderExprDiag();
  } catch (err) {
    console.error(err);
    addMessage('error', `Chargement du VRM impossible : ${err.message}`);
  }
}

avatar.onMissingTextures = (files) =>
  addMessage(
    'error',
    `Textures introuvables (${files.length}) : ${files.join(', ')}. Vérifie que le dossier du modèle a été copié en entier (avec son sous-dossier de textures).`,
  );

// ---------- Choix du modèle (dossier models/) ----------
const modelSelect = $('#model-select');
const modelUrl = (rel) => `/models/${rel.split('/').map(encodeURIComponent).join('/')}`;
async function listModels() {
  const names = await (await fetch('/api/models')).json();
  modelSelect.innerHTML = '';
  modelSelect.append(new Option('— choisir —', ''));
  for (const n of names) modelSelect.append(new Option(n, n));
  return names;
}
modelSelect.addEventListener('change', () => {
  if (!modelSelect.value) return;
  save('model', modelSelect.value);
  loadVrm(modelUrl(modelSelect.value));
});

// ---------- Animations .vmd ----------
/**
 * Fichiers du dossier motions/. L'animation choisie remplace l'animation calculée pendant le moment 🔥
 * (vitesse liée à l'excitation) ; « Jouer en boucle » la lance à tout moment.
 */
const motions = {
  cache: new Map(),
  selected: load('actMotion', ''),
  preview: false,
  async list() {
    const names = await (await fetch('/api/motions')).json();
    const box = $('#motions-list');
    box.innerHTML = '';
    for (const name of ['', ...names]) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'motion';
      radio.checked = name === this.selected;
      radio.addEventListener('change', () => this.select(name));
      label.append(radio, name || 'Calculée (sans fichier)');
      box.append(label);
    }
  },
  async clip(name) {
    if (!name) return null;
    if (!this.cache.has(name)) {
      const res = await fetch(`/motions/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`Animation introuvable : ${name}`);
      const clip = parseVMD(await res.arrayBuffer());
      clip.url = `/motions/${encodeURIComponent(name)}`; // lecture native sur les modèles .pmx
      this.cache.set(name, clip);
    }
    return this.cache.get(name);
  },
  select(name) {
    this.selected = name;
    save('actMotion', name);
    if (this.preview || intimacy.on) this.play(this.preview);
  },
  /** Lance l'animation choisie (aperçu en boucle, ou pour le moment intime). */
  async play(preview = false) {
    this.preview = preview;
    try {
      const clip = await this.clip(this.selected);
      avatar.setMotion(clip);
      if (preview) avatar.setMotionRate(1);
      if (!clip && preview) addMessage('error', 'Choisis d’abord un fichier .vmd dans la liste.');
    } catch (err) {
      addMessage('error', `Animation illisible : ${err.message}`);
    }
  },
  stop() {
    this.preview = false;
    avatar.setMotion(null);
  },
  async upload(file) {
    const res = await fetch('/api/motions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
      body: await file.arrayBuffer(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return addMessage('error', data.error || 'Envoi impossible');
    this.cache.delete(data.name);
    this.selected = data.name;
    save('actMotion', data.name);
    await this.list();
    $('#motions').hidden = false;
  },
};
$('#motions-toggle').addEventListener('click', () => ($('#motions').hidden = !$('#motions').hidden));
$('#motion-play').addEventListener('click', () => motions.play(true));
$('#motion-stop').addEventListener('click', () => motions.stop());
motions.list();

// ---------- Garde-robe ----------
/** Traduction des termes fréquents dans les noms de matériaux MMD (japonais). */
const PART_WORDS = [
  ['消し', ' (masquer)'], ['消', ' (masquer)'], ['OFF', ' (retirer)'], ['ON', ' (afficher)'], ['爆', ' déchiré'],
  ['豊乳', 'poitrine +'], ['貧乳', 'poitrine −'], ['尻大', 'fesses +'], ['ウエスト細', 'taille fine'], ['小顔', 'petit visage'],
  ['衬衣', 'chemise'], ['背心', 'débardeur'], ['奶罩', 'soutien-gorge'], ['短裤', 'short'], ['短袴', 'short'], ['胖次', 'culotte'],
  ['乳貼', 'cache-tétons'], ['乳贴', 'cache-tétons'], ['高跟', 'talons'], ['鞋', 'chaussures'], ['衣', 'vêtement'],
  ['体汗', 'sueur'], ['汗', 'sueur'], ['陰毛', 'pilosité'], ['乳首', 'tétons'], ['ボテ', 'ventre rond'],
  ['ネグリジェ', 'nuisette'], ['レース', 'dentelle'], ['裏地', 'doublure'], ['下着', 'sous-vêtements'],
  ['ブラ', 'soutien-gorge'], ['パンツ', 'culotte'], ['ショーツ', 'culotte'], ['ニーソ', 'chaussettes hautes'],
  ['ストッキング', 'bas'], ['タイツ', 'collant'], ['靴下', 'chaussettes'], ['靴', 'chaussures'], ['スカート', 'jupe'],
  ['ドレス', 'robe'], ['ワンピース', 'robe'], ['シャツ', 'chemise'], ['上着', 'veste'], ['服', 'vêtement'],
  ['手袋', 'gants'], ['リボン', 'ruban'], ['エプロン', 'tablier'], ['水着', 'maillot'], ['身体', 'corps'], ['体', 'corps'],
  ['肌', 'peau'], ['顔', 'visage'], ['白目', 'blanc des yeux'], ['目', 'yeux'], ['眉', 'sourcils'], ['まぶた', 'paupières'],
  ['ハイライト', 'reflets'], ['涙', 'larmes'], ['鼻線', 'nez'], ['ハート', 'cœur'], ['髪', 'cheveux'], ['猫耳', 'oreilles de chat'],
  ['耳毛', 'poils d’oreilles'], ['耳', 'oreilles'], ['しっぽ', 'queue'], ['尻尾', 'queue'], ['赤面', 'rougeur'], ['照れ', 'rougissement'],
];
function translatePart(name) {
  let out = name;
  for (const [ja, fr] of PART_WORDS) out = out.replaceAll(ja, ` ${fr} `);
  out = out.replace(/[・_]/g, ' ').replace(/\s+/g, ' ').trim();
  return out ? out[0].toUpperCase() + out.slice(1) : name;
}

let modelKey = 'wardrobe:modele';
function renderWardrobe() {
  const list = $('#wardrobe-list');
  list.innerHTML = '';
  for (const part of avatar.getParts()) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = part.visible;
    box.addEventListener('change', () => {
      avatar.setPartVisible(part.name, box.checked);
      const hidden = new Set(load(modelKey, []));
      box.checked ? hidden.delete(part.name) : hidden.add(part.name);
      save(modelKey, [...hidden]);
    });
    const fr = translatePart(part.name);
    label.append(box, fr === part.name ? part.name : `${fr} (${part.name})`);
    list.append(label);
  }

  // Morphs de réglage (modèles MMD) : curseurs 0..1, mémorisés par modèle.
  // Réglages de tenue en premier, puis les autres (formes, yeux, sourcils...).
  const OUTFIT_RE = /消|OFF|ON|爆|衣|服|下着|ネグリジェ|bikini|bra|cover|lace|乳貼|乳贴|鞋|靴|裤|袴|罩|pan|skirt|shirt/i;
  const morphs = avatar.getMorphs().sort((a, b) => OUTFIT_RE.test(b.name) - OUTFIT_RE.test(a.name));
  $('#morphs-box').hidden = morphs.length === 0;
  const mlist = $('#morphs-list');
  mlist.innerHTML = '';
  for (const m of morphs) {
    const row = document.createElement('label');
    row.className = 'morph-row';
    const name = document.createElement('span');
    // Traduction affichée seulement si elle est complète (sinon le nom d'origine, plus lisible).
    const fr = translatePart(m.name);
    const partial = /[\u3040-\u30ff\u3400-\u9fff]/.test(fr);
    name.textContent = fr === m.name || partial ? m.name : `${fr} (${m.name})`;
    name.title = m.name;
    const range = document.createElement('input');
    range.type = 'range';
    range.min = 0;
    range.max = 1;
    range.step = 0.05;
    range.value = m.value;
    range.addEventListener('input', () => {
      const v = Number(range.value);
      avatar.setMorph(m.name, v);
      const saved = load(`morphs:${modelKey}`, {});
      if (v > 0) saved[m.name] = v;
      else delete saved[m.name];
      save(`morphs:${modelKey}`, saved);
    });
    row.append(name, range);
    mlist.append(row);
  }
}
// ---------- Diagnostic des expressions ----------
const EXPR_FR = {
  blink: 'clignement', happy: 'sourire', angry: 'colère', sad: 'tristesse', surprised: 'surprise',
  relaxed: 'détente', aa: 'bouche a', ih: 'bouche i', ou: 'bouche ou', blinkLeft: 'clin d’œil',
};
function renderExprDiag() {
  const box = $('#expr-diag');
  box.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = 'Expressions du modèle :';
  box.append(title);
  for (const r of avatar.expressionReport()) {
    const span = document.createElement('span');
    span.className = r.found ? 'ok' : 'ko';
    span.textContent = `${r.found ? '✓' : '✗'} ${EXPR_FR[r.name]}${r.morph ? ` (${r.morph})` : ''}  `;
    box.append(span);
  }
  const stats = avatar.vrm?.morphStats;
  if (stats && stats.mb > 150) {
    const w = document.createElement('div');
    w.className = 'warn';
    w.textContent =
      `⚠ ${stats.morphCount} morphs sur ${stats.vertexCount.toLocaleString('fr-FR')} sommets (~${stats.mb} Mo à envoyer à la carte graphique) : ` +
      'si « Tester les expressions » ne montre rien, le navigateur a probablement refusé cette quantité de données.';
    box.append(w);
  }
}
$('#expr-test').addEventListener('click', async () => {
  for (const r of avatar.expressionReport().filter((r) => r.found)) {
    addMessage('error', `Test : ${EXPR_FR[r.name]}${r.morph ? ` (${r.morph})` : ''}`);
    avatar.previewExpression(r.name, 1300);
    await new Promise((res) => setTimeout(res, 1500));
  }
});

let brightnessKey = 'brightness:vrm';
$('#sphere').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  avatar.setSphereStrength(v);
  save('sphere:pmx', v);
});
$('#brightness').addEventListener('input', (e) => {
  const k = Number(e.target.value);
  avatar.setBrightness(k);
  save(brightnessKey, k);
});

$('#wardrobe-toggle').addEventListener('click', () => ($('#wardrobe').hidden = !$('#wardrobe').hidden));

function showMeta(meta) {
  const box = $('#vrm-meta');
  box.innerHTML = '';
  const line = (label, value) => {
    const p = document.createElement('div');
    p.textContent = `${label} : ${value || '—'}`;
    box.append(p);
  };
  line('Modèle', `${meta.title || 'sans titre'} (${/^\d/.test(meta.version) ? `VRM ${meta.version}` : meta.version})`);
  line('Auteur', meta.author);
  line('Licence', meta.license);
  if (meta.sexualUse === false) {
    const w = document.createElement('div');
    w.className = 'warn';
    w.textContent = "⚠ L'auteur n'autorise pas l'usage sexuel de ce modèle dans ses métadonnées.";
    box.append(w);
    vrmInfo.hidden = false;
  }
}

$('#file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadVrm(URL.createObjectURL(f));
});
addEventListener('dragover', (e) => {
  e.preventDefault();
  hint.classList.add('dragging');
});
addEventListener('dragleave', () => hint.classList.remove('dragging'));
addEventListener('drop', (e) => {
  e.preventDefault();
  hint.classList.remove('dragging');
  const files = [...e.dataTransfer.files];
  const f = files.find((f) => f.name.toLowerCase().endsWith('.vrm'));
  if (f) loadVrm(URL.createObjectURL(f));
  for (const m of files.filter((f) => f.name.toLowerCase().endsWith('.vmd'))) motions.upload(m);
  if (files.some((f) => f.name.toLowerCase().endsWith('.pmx'))) {
    addMessage(
      'error',
      'Un modèle .pmx a besoin de ses textures : copie son dossier complet dans le dossier models/ du projet, puis choisis-le dans le menu ⓘ → Modèle.',
    );
  }
});

// ---------- Site en fond (app desktop) ----------
let lastPageUrl = '';
const site = {
  layer: $('#site-layer'),
  frame: $('#site-frame'),
  url: $('#site-url'),
  view: null,
  contextTimer: 0,
};

function normalizeUrl(raw) {
  const s = raw.trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Récupère titre, description et tags visibles de la page pour que le personnage sache ce qu'il regarde. */
const EXTRACT_PAGE = `(() => {
  const meta = (s) => document.querySelector(s)?.content || '';
  const links = [...document.querySelectorAll('a[href*="/tag"], a[href*="/categor"], a[href*="/cat/"], a[href*="/search/"]')]
    .slice(0, 40).map((a) => a.textContent.trim()).filter((t) => t && t.length < 40);
  const keywords = meta('meta[name="keywords"]').split(',');
  const tags = [...new Set([...keywords, ...links].map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 25);
  return {
    url: location.href,
    title: meta('meta[property="og:title"]') || document.title,
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    tags: tags.join(', '),
  };
})()`;

/** Mode cinéma : isole le lecteur vidéo de la page (le plus grand <video> ou <iframe>) et masque le reste. */
const CINEMA_CSS = `
html.cai-cinema, html.cai-cinema body { overflow: hidden !important; background: #000 !important; }
html.cai-cinema body * { visibility: hidden !important; }
html.cai-cinema .cai-player, html.cai-cinema .cai-player * { visibility: visible !important; }
html.cai-cinema .cai-player {
  position: fixed !important; left: 0 !important; top: 0 !important; bottom: 0 !important; right: auto !important;
  width: calc(100vw - var(--cai-side, 0px)) !important; height: 100vh !important;
  max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
  transform: none !important; z-index: 2147483647 !important; background: #000 !important;
}
html.cai-cinema .cai-player video, html.cai-cinema iframe.cai-player { width: 100% !important; height: 100% !important; object-fit: contain !important; }`;
const cinemaScript = (on, side) => `(() => {
  const root = document.documentElement;
  root.style.setProperty('--cai-side', '${side}px');
  if (!${on}) { root.classList.remove('cai-cinema'); return true; }
  const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const candidates = [...document.querySelectorAll('video, iframe')].filter((e) => area(e) > 200 * 150);
  if (!candidates.length) return false;
  const media = candidates.sort((a, b) => area(b) - area(a))[0];
  // Remonte jusqu'au conteneur du lecteur (pour garder les contrôles), sans englober la page.
  let player = media;
  while (player.parentElement && player.parentElement !== document.body && area(player.parentElement) <= area(media) * 1.6) {
    player = player.parentElement;
  }
  document.querySelectorAll('.cai-player').forEach((e) => e.classList.remove('cai-player'));
  player.classList.add('cai-player');
  root.classList.add('cai-cinema');
  return true;
})()`;

let cinema = load('cinema', false);
async function applyCinema() {
  const v = site.view;
  if (!v) return;
  $('#cinema-toggle').classList.toggle('on', cinema);
  // Laisse une marge à droite pour l'avatar, sauf s'il est masqué.
  const side = document.body.classList.contains('avatar-hidden') ? 0 : 340;
  try {
    if (cinema) await v.insertCSS(CINEMA_CSS);
    let ok = await v.executeJavaScript(cinemaScript(cinema, side));
    // Les lecteurs se chargent souvent après la page : on réessaie un peu plus tard.
    for (let i = 0; cinema && !ok && i < 4; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      ok = await v.executeJavaScript(cinemaScript(cinema, side));
    }
  } catch {
    /* page en cours de chargement */
  }
}

function sendContext(page) {
  fetch('/api/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(page ?? {}),
  })
    .then((r) => r.json())
    .then(({ forbidden }) => {
      if (page && !forbidden && page.url !== lastPageUrl) {
        lastPageUrl = page.url;
        reactions.onNewPage();
      }
      if (!page) lastPageUrl = '';
      watchingEl.hidden = !page;
      watchingEl.classList.toggle('forbidden', !!forbidden);
      if (page) {
        watchingEl.textContent = forbidden
          ? '⛔ Page refusée : contenu impliquant des mineurs'
          : `👀 ${new URL(page.url).hostname.replace(/^www\./, '')} — ${page.title}`;
        watchingEl.title = page.tags ? `Tags : ${page.tags}` : '';
      }
    })
    .catch(() => {});
}

function scheduleContext() {
  clearTimeout(site.contextTimer);
  site.contextTimer = setTimeout(async () => {
    try {
      sendContext(await site.view.executeJavaScript(EXTRACT_PAGE));
    } catch {
      sendContext({ url: site.view.getURL(), title: site.view.getTitle() });
    }
  }, 800);
}

function ensureView(url) {
  if (site.view) return site.view;
  const v = document.createElement('webview');
  v.setAttribute('partition', 'persist:site'); // garde cookies et vérification d'âge entre deux sessions
  v.setAttribute('src', url);
  const syncUrl = () => {
    site.url.value = v.getURL();
    save('siteUrl', v.getURL());
  };
  v.addEventListener('did-navigate', syncUrl);
  v.addEventListener('did-navigate-in-page', (e) => e.isMainFrame && (syncUrl(), scheduleContext()));
  v.addEventListener('page-title-updated', scheduleContext);
  v.addEventListener('did-stop-loading', scheduleContext);
  v.addEventListener('did-stop-loading', () => cinema && applyCinema());
  site.frame.append(v);
  site.view = v;
  return v;
}

function openSite(raw) {
  const url = normalizeUrl(raw);
  if (!url) return;
  if (site.view) site.view.loadURL(url);
  else ensureView(url);
  site.url.value = url;
  save('siteUrl', url);
}

function setSiteMode(on) {
  document.body.classList.toggle('site-mode', on);
  site.layer.hidden = !on;
  $('#site-toggle').classList.toggle('on', on);
  avatar.setLayout(on ? 'corner' : 'center');
  avatar.setAttention(on ? 'screen' : 'user');
  save('siteMode', on);
  if (on) {
    const last = load('siteUrl', '');
    if (last && !site.view) openSite(last);
    if (!site.view) site.url.focus();
    else scheduleContext();
  } else {
    sendContext(null);
  }
}

if (isApp) {
  $('#site-toggle').hidden = false;
  $('#site-toggle').addEventListener('click', () => setSiteMode(!document.body.classList.contains('site-mode')));
  $('#site-bar').addEventListener('submit', (e) => {
    e.preventDefault();
    openSite(site.url.value);
  });
  $('#site-back').addEventListener('click', () => site.view?.canGoBack() && site.view.goBack());
  $('#site-forward').addEventListener('click', () => site.view?.canGoForward() && site.view.goForward());
  $('#site-reload').addEventListener('click', () => site.view?.reload());
  $('#avatar-toggle').addEventListener('click', (e) => {
    const hidden = document.body.classList.toggle('avatar-hidden');
    e.currentTarget.classList.toggle('on', !hidden);
    if (cinema) applyCinema();
  });
  $('#cinema-toggle').addEventListener('click', () => {
    cinema = !cinema;
    save('cinema', cinema);
    applyCinema();
  });
  $('#cinema-toggle').classList.toggle('on', cinema);
  $('#avatar-toggle').classList.add('on');
  if (load('siteMode', false)) setSiteMode(true);
} else {
  sendContext(null);
}

// ---------- Conversation ----------
/** Envoie une requête au serveur et affiche la réponse en streaming dans une nouvelle bulle. */
async function streamReply(url, body) {
  busy = true;
  form.querySelector('button').disabled = true;
  const bubble = addMessage('assistant');
  bubble.classList.add('typing');
  const parser = new TagParser(character.emotions, setEmotion, character.actions, (a) => intimacy.onAction(a));

  const append = (text) => {
    if (!text) return;
    bubble.textContent = (bubble.textContent + text).replace(/^\s+/, '');
    log.scrollTop = log.scrollHeight;
    avatar.setSpeaking(true);
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, state: intimacy.state() }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      append(parser.push(value));
    }
    append(parser.flush());
    if (!bubble.textContent.trim()) bubble.remove();
  } catch (err) {
    bubble.remove();
    addMessage('error', err.message);
  } finally {
    bubble.classList.remove('typing');
    avatar.setSpeaking(false);
    busy = false;
    form.querySelector('button').disabled = false;
    reactions.touch();
  }
}

function send(message) {
  addMessage('user', message);
  avatar.playGesture?.('nod'); // elle acquiesce : « je t'écoute »
  return streamReply('/api/chat', { message }).then(() => input.focus());
}

/**
 * Réactions spontanées : elle parle d'elle-même quand tu ouvres une nouvelle vidéo,
 * ou quand tu restes silencieux longtemps. Délai minimal entre deux prises de parole.
 */
const reactions = {
  enabled: load('reactions', true),
  lastActivity: Date.now(),
  lastReaction: 0,
  pageTimer: 0,
  COOLDOWN: 45_000,
  touch() {
    this.lastActivity = Date.now();
  },
  canSpeak() {
    return this.enabled && !busy && !input.value.trim() && Date.now() - this.lastReaction > this.COOLDOWN;
  },
  async fire(event) {
    if (!this.canSpeak()) return;
    this.lastReaction = Date.now();
    await streamReply('/api/react', { event });
  },
  onNewPage() {
    clearTimeout(this.pageTimer);
    // On laisse quelques secondes pour que la vidéo démarre (et éviter de commenter chaque clic).
    this.pageTimer = setTimeout(() => this.fire('new_page'), 7000);
  },
  tick() {
    const silent = Date.now() - this.lastActivity;
    // Pendant qu'elle se caresse, elle s'exprime plus souvent.
    if (intimacy.on && silent > 40_000) return this.fire('pleasure');
    const watchingSomething = !!lastPageUrl && document.body.classList.contains('site-mode');
    if (watchingSomething && silent > 3 * 60_000) this.fire('still_watching');
    else if (!watchingSomething && silent > 6 * 60_000) this.fire('idle');
  },
};
setInterval(() => reactions.tick(), 20_000);
const reactBtn = $('#react-toggle');
reactBtn.classList.toggle('on', reactions.enabled);
reactBtn.addEventListener('click', () => {
  reactions.enabled = !reactions.enabled;
  save('reactions', reactions.enabled);
  reactBtn.classList.toggle('on', reactions.enabled);
});

/**
 * Moment intime : elle se caresse en regardant avec toi. L'excitation monte pendant que la vidéo
 * tourne (plus lentement en pause) ; à 100 % elle jouit, puis redescend.
 * Déclenché par le bouton 🔥 ou par elle-même via les balises [touch] / [stop] / [climax].
 */
const intimacy = {
  on: false,
  arousal: 0,
  videoPlaying: false,
  climaxUntil: 0,
  el: $('#arousal'),
  state() {
    return { act: this.on, arousal: this.arousal, videoPlaying: this.videoPlaying };
  },
  render() {
    $('#act-toggle').classList.toggle('on', this.on);
    this.el.hidden = !this.on && this.arousal < 0.05;
    this.el.classList.toggle('climax', Date.now() < this.climaxUntil);
    $('#arousal-fill').style.width = `${Math.round(this.arousal * 100)}%`;
    avatar.setArousal(this.arousal);
    // L'animation .vmd accélère avec l'excitation (et ralentit si la vidéo est en pause).
    if (this.on && !motions.preview) avatar.setMotionRate((0.75 + 0.6 * this.arousal) * (this.videoPlaying ? 1 : 0.6));
  },
  start() {
    if (this.on) return;
    this.on = true;
    avatar.setAct(true);
    if (motions.selected) motions.play();
    this.render();
  },
  stop(reset = false) {
    this.on = false;
    avatar.setAct(false);
    if (!motions.preview) avatar.setMotion(null);
    if (reset) this.arousal = 0;
    this.render();
  },
  climax(fromModel = false) {
    if (Date.now() < this.climaxUntil) return;
    this.climaxUntil = Date.now() + 7000;
    avatar.climax();
    setEmotion('aroused');
    this.render();
    setTimeout(() => {
      this.arousal = 0.25;
      this.stop();
      setEmotion('relaxed');
    }, 7000);
    // Si l'orgasme vient de la jauge (et non d'une balise du LLM), elle l'exprime.
    if (!fromModel) {
      reactions.lastReaction = 0;
      setTimeout(() => reactions.fire('climax'), 600);
    }
  },
  onAction(a) {
    if (a === 'touch') this.start();
    else if (a === 'stop') this.stop();
    else if (a === 'climax') {
      this.arousal = 1;
      this.start();
      this.climax(true);
    }
  },
  /** Toutes les 2 s : lecture vidéo en cours ? montée de l'excitation. */
  async tick() {
    if (site.view && document.body.classList.contains('site-mode')) {
      try {
        this.videoPlaying = await site.view.executeJavaScript(
          `[...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && v.readyState > 2)`,
        );
      } catch {
        this.videoPlaying = false;
      }
    } else {
      this.videoPlaying = false;
    }
    avatar.setVideoPlaying(this.videoPlaying);
    if (this.on && Date.now() > this.climaxUntil) {
      // ~3 min de vidéo pour atteindre 100 % ; en pause, elle redescend doucement.
      this.arousal = Math.min(1, Math.max(0, this.arousal + (this.videoPlaying ? 2 / 180 : -2 / 600)));
      if (this.arousal >= 1) this.climax();
    } else if (!this.on && Date.now() > this.climaxUntil) {
      this.arousal = Math.max(0, this.arousal - 2 / 300);
    }
    this.render();
  },
};
setInterval(() => intimacy.tick(), 2000);
$('#act-toggle').addEventListener('click', () => {
  if (intimacy.on) {
    intimacy.stop();
    return;
  }
  intimacy.start();
  // Elle réagit à l'invitation (si elle n'est pas déjà en train de parler).
  reactions.lastReaction = 0;
  reactions.fire('start_touch');
});

// Quand tu écris, elle regarde le chat ; sinon toi, ou la vidéo par moments.
input.addEventListener('input', () => {
  reactions.touch();
  avatar.setAttention(input.value ? 'chat' : document.body.classList.contains('site-mode') ? 'screen' : 'user');
});
input.addEventListener('blur', () => avatar.setAttention(document.body.classList.contains('site-mode') ? 'screen' : 'user'));

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message || busy) return;
  input.value = '';
  avatar.setAttention(document.body.classList.contains('site-mode') ? 'screen' : 'user');
  send(message);
});

$('#reset').addEventListener('click', async () => {
  if (!confirm('Effacer toute la conversation ?')) return;
  await fetch('/api/reset', { method: 'POST' });
  log.innerHTML = '';
  greet();
});

$('#info-toggle').addEventListener('click', () => (vrmInfo.hidden = !vrmInfo.hidden));

function greet() {
  if (!character.greeting) return;
  const emo = [...character.greeting.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).find((e) => character.emotions.includes(e));
  if (emo) setEmotion(emo);
  addMessage('assistant', stripTags(character.greeting, [...character.emotions, ...character.actions]));
}

// ---------- Personnages ----------
const charSelect = $('#char-select');

async function showCharacter(c) {
  character = c;
  document.title = `${c.name} · CompagnonAI`;
  log.innerHTML = '';
  setEmotion('neutral');
  const history = await (await fetch('/api/history')).json();
  if (history.length === 0) greet();
  for (const m of history) addMessage(m.role, stripTags(m.content, [...c.emotions, ...c.actions]));
  intimacy.stop(true);
  $('#act-toggle').hidden = c.actions.length === 0;
  // Dernière émotion de son dernier message (en ignorant les balises d'action comme [touch]).
  const lastMsg = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const lastEmo = [...lastMsg.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((e) => c.emotions.includes(e)).at(-1);
  if (lastEmo) setEmotion(lastEmo);
}

charSelect.addEventListener('change', async () => {
  const res = await fetch('/api/character', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: charSelect.value }),
  });
  if (res.ok) showCharacter(await res.json());
});

// ---------- Démarrage ----------
(async () => {
  const { current, list } = await (await fetch('/api/characters')).json();
  for (const c of list) {
    const o = new Option(`${c.name}, ${c.age} ans`, c.id, false, c.id === current);
    o.title = c.tagline;
    charSelect.append(o);
  }
  await showCharacter(await (await fetch('/api/character')).json());

  // Modèle : celui choisi la dernière fois, sinon models/default.vrm, sinon le premier trouvé.
  const models = await listModels();
  const saved = load('model', '');
  const pick = models.includes(saved) ? saved : models.includes('default.vrm') ? 'default.vrm' : models[0];
  if (pick) {
    modelSelect.value = pick;
    loadVrm(modelUrl(pick));
  }
})();
