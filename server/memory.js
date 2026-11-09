import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/** Historique de conversation persistant, un fichier JSON par personnage. */
export class Memory {
  constructor(characterId) {
    this.file = path.join(config.dirs.data, `history-${characterId}.json`);
    this.messages = [];
    try {
      this.messages = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* pas encore d'historique */
    }
  }

  add(role, content) {
    this.messages.push({ role, content, at: new Date().toISOString() });
    this.save();
  }

  /**
   * Derniers messages pour le LLM. Les messages consécutifs du même rôle sont fusionnés :
   * certains modèles exigent l'alternance utilisateur / assistant (réactions spontanées).
   */
  recent(n = config.contextMessages) {
    const out = [];
    for (const { role, content } of this.messages.slice(-n)) {
      const last = out.at(-1);
      if (last?.role === role) last.content += `\n\n${content}`;
      else out.push({ role, content });
    }
    return out;
  }

  reset() {
    this.messages = [];
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.messages, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
