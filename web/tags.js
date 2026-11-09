/**
 * Extrait au fil du streaming les balises du texte du LLM :
 * émotions [happy], [flirty]... et actions [touch], [stop], [climax].
 * Une balise coupée entre deux fragments est retenue jusqu'au fragment suivant.
 */
export class TagParser {
  constructor(emotions, onEmotion, actions = [], onAction = () => {}) {
    this.emotions = new Set(emotions);
    this.re = new RegExp(`\\[(${[...emotions, ...actions].join('|')})\\] ?`, 'gi');
    this.onEmotion = onEmotion;
    this.onAction = onAction;
    this.pending = '';
  }

  /** Ajoute un fragment, renvoie le texte affichable (sans balises). */
  push(chunk) {
    let text = this.pending + chunk;
    this.pending = '';
    const open = text.lastIndexOf('[');
    if (open !== -1 && text.indexOf(']', open) === -1 && text.length - open <= 12) {
      this.pending = text.slice(open);
      text = text.slice(0, open);
    }
    text = this.strip(text);
    // Évite le double espace laissé par une balise retirée entre deux phrases.
    if (this.lastEndsWithSpace && text.startsWith(' ')) text = text.slice(1);
    if (text) this.lastEndsWithSpace = /\s$/.test(text);
    return text;
  }

  flush() {
    const rest = this.strip(this.pending);
    this.pending = '';
    return rest;
  }

  strip(text) {
    return text.replace(this.re, (_, tag) => {
      const name = tag.toLowerCase();
      if (this.emotions.has(name)) this.onEmotion(name);
      else this.onAction(name);
      return '';
    });
  }
}

/** Retire les balises d'un message complet (historique). */
export function stripTags(text, tags) {
  return text.replace(new RegExp(`\\[(${tags.join('|')})\\]\\s*`, 'gi'), '').trim();
}
