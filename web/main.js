import { Avatar } from './avatar.js';
import { Speaker } from './tts.js';
import { TagParser, stripTags } from './tags.js';

const $ = (s) => document.querySelector(s);
const log = $('#log');
const form = $('#input');
const input = $('#message');
const hint = $('#drop-hint');
const emotionPill = $('#emotion');
const vrmInfo = $('#vrm-info');

const avatar = new Avatar($('#scene'));
const speaker = new Speaker({ onSpeakingChange: (on) => avatar.setSpeaking(on) });
let character = { name: '…', emotions: ['neutral'] };
let busy = false;
let ttsOn = load('ttsOn', true);

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

// ---------- Conversation ----------
async function send(message) {
  busy = true;
  form.querySelector('button').disabled = true;
  speaker.stop();
  addMessage('user', message);
  const bubble = addMessage('assistant');
  const parser = new TagParser(character.emotions, setEmotion);

  const append = (text) => {
    if (!text) return;
    bubble.textContent = (bubble.textContent + text).replace(/^\s+/, '');
    log.scrollTop = log.scrollHeight;
    if (ttsOn) speaker.feed(text);
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
    if (ttsOn) speaker.flush();
    if (!bubble.textContent.trim()) bubble.remove();
  } catch (err) {
    bubble.remove();
    addMessage('error', err.message);
  } finally {
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

const ttsBtn = $('#tts-toggle');
const renderTts = () => ttsBtn.classList.toggle('off', !ttsOn);
ttsBtn.addEventListener('click', () => {
  ttsOn = !ttsOn;
  save('ttsOn', ttsOn);
  if (!ttsOn) speaker.stop();
  renderTts();
});
renderTts();
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
