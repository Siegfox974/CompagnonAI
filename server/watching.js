/**
 * Contexte « ce qu'il regarde » envoyé par l'app desktop (titre, URL, tags de la page).
 * Tout contenu évoquant des mineurs est refusé : le personnage ne le commente pas.
 */
const FORBIDDEN =
  /\b(loli|lolicon|shota|shotacon|underage|under-age|minor|minors|preteen|pre-teen|child|children|kid|kids|cp|pedo|jailbait|enfant|mineure?s?|gamine?s?|fillette|écolière|ecoliere)\b/i;

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function sanitizeWatching(input) {
  let host = '';
  try {
    host = new URL(String(input?.url)).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  const page = {
    host,
    title: clip(input.title, 200),
    tags: clip(input.tags, 300),
    description: clip(input.description, 300),
  };
  const text = `${page.title} ${page.tags} ${page.description}`;
  return { ...page, forbidden: FORBIDDEN.test(text) };
}

export function watchingPrompt(w, userName = "l'utilisateur") {
  if (!w) return '';
  if (w.forbidden) {
    return `${userName} a ouvert une page dont le contenu semble impliquer des mineurs. Tu refuses catégoriquement d'en parler et tu lui demandes de fermer cette page.`;
  }
  const details = [
    `site : ${w.host}`,
    w.title && `titre : « ${w.title} »`,
    w.tags && `tags : ${w.tags}`,
    w.description && `description : ${w.description}`,
  ].filter(Boolean);
  return (
    `En ce moment, ${userName} regarde à l'écran une page (${details.join(' ; ')}). ` +
    `Tu peux y faire allusion naturellement, réagir, taquiner ou commenter selon ta personnalité, sans tout répéter mot pour mot. ` +
    `Fie-toi surtout aux tags pour savoir ce qui se passe à l'écran. Abréviations fréquentes dans les titres : ` +
    `HMV = hentai music video (montage animé érotique sur de la musique), PMV = porn music video, ` +
    `JOI = instructions de masturbation, POV = point de vue subjectif, MMD = animation 3D style anime, ` +
    `beatbar / FH (fap hero) = barre de rythme qui donne la cadence pour se masturber.`
  );
}
