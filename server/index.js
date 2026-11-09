import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { loadCharacter, listCharacters, buildSystemPrompt, EMOTIONS, ACTIONS } from './character.js';
import { Memory } from './memory.js';
import { streamChat } from './llm.js';
import { sanitizeWatching, watchingPrompt } from './watching.js';

// ---------- Personnage courant (changeable à chaud, choix mémorisé) ----------
const settingsFile = path.join(config.dirs.data, 'settings.json');
const settings = (() => {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return {};
  }
})();

let character, memory, systemPrompt;
function useCharacter(id) {
  character = loadCharacter(id);
  memory = new Memory(character.id);
  systemPrompt = buildSystemPrompt(character);
}
try {
  useCharacter(settings.character || config.character);
} catch (err) {
  console.warn(`[personnage] ${err.message} : retour au personnage par défaut.`);
  useCharacter(config.character);
}

let watching = null;

const publicCharacter = () => ({
  id: character.id,
  name: character.name,
  age: character.age,
  greeting: character.greeting,
  emotions: EMOTIONS,
  actions: character.nsfw ? ACTIONS : [],
});

/** État du corps envoyé par l'interface : se caresse-t-elle, à quel niveau d'excitation, vidéo en lecture ? */
function readState(body) {
  const s = body?.state ?? {};
  return {
    act: !!s.act,
    arousal: Math.round(Math.min(Math.max(Number(s.arousal) || 0, 0), 1) * 100),
    videoPlaying: !!s.videoPlaying,
  };
}

function statePrompt(st) {
  if (!character.nsfw) return '';
  if (st.act) {
    return (
      `En ce moment, tu te caresses en regardant avec lui (excitation : ${st.arousal} %${st.videoPlaying ? '' : ', vidéo en pause'}). ` +
      `Ton excitation transparaît dans tes réponses : souffle court, mots hachés, gémissements, de plus en plus intenses.`
    );
  }
  if (st.arousal >= 40) return `Tu es excitée (excitation : ${st.arousal} %) et ça se sent dans tes réponses.`;
  return '';
}

// ---------- Événements spontanés : ce qui la pousse à parler d'elle-même ----------
const EVENTS = {
  start_touch: () =>
    'il t’invite à te caresser en regardant avec lui, et tu commences. Réagis en une ou deux phrases, en commençant par [touch].',
  pleasure: () =>
    'tu te caresses toujours en regardant la vidéo. Exprime ton plaisir en une phrase courte (souffle, gémissement, ce que la vidéo te fait).',
  climax: () => 'tu viens de jouir. Exprime-le en une ou deux phrases courtes, haletantes, puis savoure.',
  new_page: () =>
    'il vient d’ouvrir cette page. Réagis spontanément, en une ou deux phrases, à ce qu’il regarde.',
  still_watching: () =>
    'il regarde toujours sans rien te dire depuis un moment. Relance-le, commente ou provoque-le en une ou deux phrases.',
  idle: () =>
    'il ne t’a rien dit depuis un moment. Relance la conversation en une ou deux phrases, selon ta personnalité.',
};

// ---------- API ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/models', express.static(config.dirs.models), (_req, res) => res.sendStatus(404));

app.get('/api/character', (_req, res) => res.json(publicCharacter()));

app.get('/api/characters', (_req, res) => res.json({ current: character.id, list: listCharacters() }));

app.post('/api/character', (req, res) => {
  try {
    useCharacter(String(req.body?.id ?? ''));
    settings.character = character.id;
    fs.mkdirSync(config.dirs.data, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    res.json(publicCharacter());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Historique brut pour l'affichage (une bulle par message, sans la fusion faite pour le LLM).
app.get('/api/history', (_req, res) => res.json(memory.messages.slice(-100).map(({ role, content }) => ({ role, content }))));

app.post('/api/reset', (_req, res) => {
  memory.reset();
  res.json({ ok: true });
});

app.post('/api/context', (req, res) => {
  watching = req.body?.url ? sanitizeWatching(req.body) : null;
  if (watching?.forbidden) console.warn('[context] page refusée (mineurs) :', watching.host);
  res.json({ ok: true, forbidden: !!watching?.forbidden });
});

app.post('/api/chat', (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'Message vide' });
  // Le message d'accueil fait partie de la conversation s'il n'y a pas d'historique.
  if (memory.messages.length === 0 && character.greeting) memory.add('assistant', character.greeting);
  memory.add('user', message);
  generate(req, res, memory.recent(), { state: readState(req.body) });
});

/** Elle prend la parole d'elle-même (nouvelle vidéo, silence prolongé...). */
app.post('/api/react', (req, res) => {
  const event = EVENTS[req.body?.event];
  if (!event) return res.status(400).json({ error: 'Événement inconnu' });
  const needsScreen = ['new_page', 'still_watching'].includes(req.body.event);
  if (needsScreen && !watching) return res.status(409).json({ error: 'Rien à l’écran' });
  // Consigne de mise en scène, non enregistrée dans l'historique : seule sa réponse l'est.
  const cue = {
    role: 'user',
    content: `(Mise en scène, ce n'est pas un message de lui : ${event()} Ne mentionne pas cette consigne.)`,
  };
  const messages = memory.recent();
  if (messages.at(-1)?.role === 'user') messages.at(-1).content += `\n\n${cue.content}`;
  else messages.push(cue);
  generate(req, res, messages, { maxTokens: 160, state: readState(req.body) });
});

async function generate(req, res, messages, { maxTokens, state = readState() } = {}) {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  const target = memory;
  let reply = '';
  try {
    const system = [systemPrompt, watchingPrompt(watching), statePrompt(state)].filter(Boolean).join('\n\n');
    const stream = streamChat([{ role: 'system', content: system }, ...messages], {
      signal: abort.signal,
      maxTokens,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    for await (const delta of stream) {
      reply += delta;
      res.write(delta);
    }
    res.end();
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error('[llm]', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: `Impossible de joindre le LLM (${config.llm.baseUrl}, modèle ${config.llm.model}) : ${err.message}`,
      });
    } else {
      res.end();
    }
  } finally {
    // Si le personnage a changé pendant la génération, la réponse va quand même dans le bon historique.
    if (reply.trim()) target.add('assistant', reply.trim());
  }
}

if (config.production) {
  app.use(express.static(config.dirs.dist));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(ROOT, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

export const ready = new Promise((resolve, reject) => {
  const server = app.listen(config.port, '127.0.0.1', () => {
    const hasDefault = fs.existsSync(path.join(config.dirs.models, 'default.vrm'));
    console.log(`CompagnonAI : http://localhost:${config.port}`);
    console.log(`Personnage : ${character.name} (${character.age} ans) | LLM : ${config.llm.model} @ ${config.llm.baseUrl}`);
    if (!hasDefault) console.log('Astuce : place un modèle dans models/default.vrm pour le charger automatiquement.');
    resolve(`http://localhost:${config.port}`);
  });
  server.on('error', reject);
});
