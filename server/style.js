/**
 * Anti-répétition : repère dans ses derniers messages les débuts de phrase et les formules
 * qui reviennent, pour les lui interdire explicitement dans le prompt.
 * (Les petits modèles locaux retombent vite dans les mêmes tics : « Oh, mon grand... », « Est-ce que ça te plaît ? ».)
 */
const TAG = /\[[a-z]+\]/gi;
const words = (text) =>
  text
    .replace(TAG, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’ ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

export function repetitionPrompt(messages, { window = 8 } = {}) {
  const mine = messages.filter((m) => m.role === 'assistant').slice(-window).map((m) => m.content);
  if (mine.length < 2) return '';

  // Débuts de réponse (3 premiers mots) déjà utilisés.
  const openings = [...new Set(mine.map((t) => words(t).slice(0, 3).join(' ')).filter((o) => o.split(' ').length === 3))];

  // Formules de 4 mots présentes dans au moins 2 messages différents.
  const counts = new Map();
  for (const t of mine) {
    const w = words(t);
    const seen = new Set();
    for (let i = 0; i + 4 <= w.length; i++) seen.add(w.slice(i, i + 4).join(' '));
    for (const g of seen) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  // Fusionne les morceaux qui se chevauchent en expressions complètes (« est-ce que ça te plaît de me voir comme ça »).
  const repeated = new Set([...counts].filter(([, n]) => n >= 2).map(([g]) => g));
  const phrases = [];
  for (const t of mine) {
    const w = words(t);
    let start = -1;
    for (let i = 0; i <= w.length; i++) {
      const hit = i + 4 <= w.length && repeated.has(w.slice(i, i + 4).join(' '));
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) {
        const phrase = w.slice(start, i + 3).join(' ');
        if (!phrases.some((p) => p.includes(phrase))) {
          for (let k = phrases.length - 1; k >= 0; k--) if (phrase.includes(phrases[k])) phrases.splice(k, 1);
          phrases.push(phrase);
        }
        start = -1;
      }
    }
  }
  phrases.splice(8);

  // Questions de fin répétées (« ... ça te plaît ? »).
  const endsWithQuestion = mine.slice(-4).filter((t) => /\?\s*$/.test(t.trim())).length;

  const rules = [];
  if (openings.length) rules.push(`Ne commence pas ta réponse par : ${openings.map((o) => `« ${o} »`).join(', ')}.`);
  if (phrases.length) rules.push(`Formules que tu as trop répétées, à ne plus employer : ${phrases.map((p) => `« ${p} »`).join(', ')}.`);
  if (endsWithQuestion >= 3) rules.push(`Tes derniers messages finissent tous par une question : cette fois, termine par une affirmation, un ordre ou une action.`);
  return rules.length ? `Anti-répétition (important) : ${rules.join(' ')}` : '';
}
