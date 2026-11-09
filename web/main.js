import { Avatar, AMBIANCES } from './avatar.js';
import { TagParser, stripTags } from './tags.js';

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
let character = { name: '…', emotions: ['neutral'] };
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
  } catch (err) {
    console.error(err);
    addMessage('error', `Chargement du VRM impossible : ${err.message}`);
  }
}

function showMeta(meta) {
  vrmInfo.innerHTML = '';
  const line = (label, value) => {
    const p = document.createElement('div');
    p.textContent = `${label} : ${value || '—'}`;
    vrmInfo.append(p);
  };
  line('Modèle', `${meta.title || 'sans titre'} (VRM ${meta.version})`);
  line('Auteur', meta.author);
  line('Licence', meta.license);
  if (!meta.sexualUse) {
    const w = document.createElement('div');
    w.className = 'warn';
    w.textContent = "⚠ L'auteur n'autorise pas l'usage sexuel de ce modèle dans ses métadonnées.";
    vrmInfo.append(w);
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
  const f = [...e.dataTransfer.files].find((f) => f.name.toLowerCase().endsWith('.vrm'));
  if (f) loadVrm(URL.createObjectURL(f));
});

// ---------- Site en fond (app desktop) ----------
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

function sendContext(page) {
  fetch('/api/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(page ?? {}),
  })
    .then((r) => r.json())
    .then(({ forbidden }) => {
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
  });
  $('#avatar-toggle').classList.add('on');
  if (load('siteMode', false)) setSiteMode(true);
} else {
  sendContext(null);
}

// ---------- Conversation ----------
async function send(message) {
  busy = true;
  form.querySelector('button').disabled = true;
  addMessage('user', message);
  const bubble = addMessage('assistant');
  bubble.classList.add('typing');
  const parser = new TagParser(character.emotions, setEmotion);

  const append = (text) => {
    if (!text) return;
    bubble.textContent = (bubble.textContent + text).replace(/^\s+/, '');
    log.scrollTop = log.scrollHeight;
    avatar.setSpeaking(true);
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
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
    input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message || busy) return;
  input.value = '';
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
  const emo = character.greeting.match(/\[(\w+)\]/)?.[1];
  if (emo) setEmotion(emo);
  addMessage('assistant', stripTags(character.greeting, character.emotions));
}

// ---------- Démarrage ----------
(async () => {
  character = await (await fetch('/api/character')).json();
  $('#char-name').textContent = `${character.name}, ${character.age} ans`;
  document.title = `${character.name} · CompagnonAI`;

  const history = await (await fetch('/api/history')).json();
  if (history.length === 0) greet();
  for (const m of history) addMessage(m.role, stripTags(m.content, character.emotions));
  const lastEmo = [...history].reverse().find((m) => m.role === 'assistant')?.content.match(/\[(\w+)\][^[]*$/)?.[1];
  if (lastEmo) setEmotion(lastEmo);

  const def = await fetch('/models/default.vrm', { method: 'HEAD' });
  if (def.ok) loadVrm('/models/default.vrm');
})();
