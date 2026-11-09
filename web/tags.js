/**
 * Extrait au fil du streaming les balises d'émotion [happy], [sad]... du texte du LLM.
 * Une balise coupée entre deux fragments est retenue jusqu'au fragment suivant.
 */
export class TagParser {
  constructor(emotions, onEmotion) {
    this.re = new RegExp(`\\[(${emotions.join('|')})\\] ?`, 'gi');
    this.onEmotion = onEmotion;
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
    return text.replace(this.re, (_, emo) => {
      this.onEmotion(emo.toLowerCase());
      return '';
    });
  }
}

/** Retire les balises d'un message complet (historique). */
export function stripTags(text, emotions) {
  return text.replace(new RegExp(`\\[(${emotions.join('|')})\\]\\s*`, 'gi'), '').trim();
}
