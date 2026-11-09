/**
 * Synthèse vocale via l'API Web Speech du navigateur (gratuite, sans installation).
 * Le texte est découpé en phrases pendant le streaming pour commencer à parler au plus tôt.
 * Sera remplacée par un TTS local (Kokoro/Piper) avec vrais visèmes au MVP 2.
 */
export class Speaker {
  constructor({ lang = 'fr-FR', onSpeakingChange = () => {} } = {}) {
    this.lang = lang;
    this.onSpeakingChange = onSpeakingChange;
    this.enabled = 'speechSynthesis' in window;
    this.buffer = '';
    this.queued = 0;
    this.voice = null;
    if (this.enabled) {
      const pick = () => (this.voice = pickVoice(speechSynthesis.getVoices(), lang));
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  /** Ajoute du texte en streaming ; prononce chaque phrase complète. */
  feed(text) {
    if (!this.enabled) return;
    this.buffer += text;
    const re = /[^.!?…\n]+[.!?…]+["»)]?\s|[^\n]+\n/g;
    let m;
    let last = 0;
    while ((m = re.exec(this.buffer))) {
      this.say(m[0]);
      last = re.lastIndex;
    }
    this.buffer = this.buffer.slice(last);
  }

  flush() {
    if (this.buffer.trim()) this.say(this.buffer);
    this.buffer = '';
  }

  stop() {
    this.buffer = '';
    if (!this.enabled) return;
    speechSynthesis.cancel();
    this.queued = 0;
    this.onSpeakingChange(false);
  }

  say(text) {
    // On ne prononce pas les didascalies éventuelles (*sourit*) ni les émojis.
    const clean = text.replace(/\*[^*]*\*/g, ' ').replace(/\p{Extended_Pictographic}/gu, '').trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = this.lang;
    if (this.voice) u.voice = this.voice;
    u.pitch = 1.1;
    u.onstart = () => this.onSpeakingChange(true);
    u.onend = u.onerror = () => {
      this.queued = Math.max(0, this.queued - 1);
      if (this.queued === 0) this.onSpeakingChange(false);
    };
    this.queued++;
    speechSynthesis.speak(u);
  }
}

function pickVoice(voices, lang) {
  const local = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2)));
  const female = /female|femme|amelie|amélie|audrey|aurelie|julie|marie|virginie|denise|hortense|eloise|céline|celine|léa|lea/i;
  return local.find((v) => female.test(v.name)) ?? local[0] ?? null;
}
