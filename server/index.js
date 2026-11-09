import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { loadCharacter, buildSystemPrompt, EMOTIONS } from './character.js';
import { Memory } from './memory.js';
import { streamChat } from './llm.js';

const character = loadCharacter();
const memory = new Memory(character.id);
const systemPrompt = buildSystemPrompt(character);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/models', express.static(config.dirs.models), (_req, res) => res.sendStatus(404));

app.get('/api/character', (_req, res) => {
  const { name, age, greeting } = character;
  res.json({ name, age, greeting, emotions: EMOTIONS });
});

app.get('/api/history', (_req, res) => res.json(memory.recent(100)));

app.post('/api/reset', (_req, res) => {
  memory.reset();
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return res.status(400).json({ error: 'Message vide' });

  // Le message d'accueil fait partie de la conversation s'il n'y a pas d'historique.
  if (memory.messages.length === 0 && character.greeting) memory.add('assistant', character.greeting);
  memory.add('user', message);

  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  let reply = '';
  try {
    const stream = streamChat([{ role: 'system', content: systemPrompt }, ...memory.recent()], {
      signal: abort.signal,
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
    console.error('[chat]', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: `Impossible de joindre le LLM (${config.llm.baseUrl}, modèle ${config.llm.model}) : ${err.message}`,
      });
    } else {
      res.end();
    }
  } finally {
    if (reply.trim()) memory.add('assistant', reply.trim());
  }
});

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

app.listen(config.port, '127.0.0.1', () => {
  const hasDefault = fs.existsSync(path.join(config.dirs.models, 'default.vrm'));
  console.log(`CompagnonAI : http://localhost:${config.port}`);
  console.log(`Personnage : ${character.name} (${character.age} ans) | LLM : ${config.llm.model} @ ${config.llm.baseUrl}`);
  if (!hasDefault) console.log('Astuce : place un modèle dans models/default.vrm pour le charger automatiquement.');
});
