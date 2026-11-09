import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  production: process.env.NODE_ENV === 'production' || process.argv.includes('--production'),
  llm: {
    baseUrl: (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || 'mistral-nemo',
    apiKey: process.env.LLM_API_KEY || '',
    temperature: num(process.env.LLM_TEMPERATURE, 0.9),
    maxTokens: num(process.env.LLM_MAX_TOKENS, 400),
  },
  character: process.env.CHARACTER || 'default',
  contextMessages: num(process.env.CONTEXT_MESSAGES, 30),
  dirs: {
    characters: path.join(ROOT, 'characters'),
    models: path.join(ROOT, 'models'),
    motions: path.join(ROOT, 'motions'),
    data: path.join(ROOT, 'data'),
    dist: path.join(ROOT, 'dist'),
  },
};
