import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/** Émotions que le LLM peut utiliser, avec leur sens (repris dans le prompt). */
export const EMOTION_HINTS = {
  neutral: 'neutre',
  happy: 'joyeuse, rieuse',
  excited: 'enthousiaste, surexcitée',
  flirty: 'aguicheuse, séductrice',
  teasing: 'taquine, clin d’œil',
  aroused: 'excitée, troublée, désir',
  shy: 'gênée, rougissante',
  relaxed: 'détendue, satisfaite',
  surprised: 'surprise',
  pout: 'boudeuse',
  sad: 'triste',
  angry: 'fâchée',
};
export const EMOTIONS = Object.keys(EMOTION_HINTS);

/** Actions que le LLM peut déclencher sur l'avatar. */
export const ACTION_HINTS = {
  touch: 'tu commences à te caresser',
  stop: 'tu arrêtes de te caresser',
  climax: 'tu jouis (orgasme)',
};
export const ACTIONS = Object.keys(ACTION_HINTS);

function readCard(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Identifiant de personnage invalide : ${id}`);
  const file = path.join(config.dirs.characters, `${id}.json`);
  const card = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!card.name) throw new Error(`${file} : champ "name" manquant`);
  // Garde-fou : un personnage doit être explicitement majeur.
  if (!Number.isInteger(card.age) || card.age < 18) {
    throw new Error(`${file} : "age" doit être un entier >= 18 (personnage majeur obligatoire)`);
  }
  return { id, language: 'français', nsfw: false, ...card };
}

export function loadCharacter(id = config.character) {
  return readCard(id);
}

/** Toutes les fiches valides du dossier characters/. */
export function listCharacters() {
  return fs
    .readdirSync(config.dirs.characters)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        const c = readCard(f.slice(0, -5));
        return [{ id: c.id, name: c.name, age: c.age, tagline: c.tagline ?? '' }];
      } catch (err) {
        console.warn('[personnages]', err.message);
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSystemPrompt(c, userName = "l'utilisateur") {
  const tags = EMOTIONS.map((e) => `[${e}] ${EMOTION_HINTS[e]}`).join(' ; ');
  return [
    `Tu incarnes ${c.name}, une femme adulte de ${c.age} ans. Tu restes toujours dans ce personnage et tu réponds en ${c.language}.`,
    c.description && `Description : ${c.description}`,
    c.personality && `Personnalité : ${c.personality}`,
    c.scenario && `Contexte : ${c.scenario}`,
    c.style && `Style : ${c.style}`,
    c.nsfw
      ? `Cette conversation est privée, entre adultes consentants. Le contenu sexuel explicite est autorisé et bienvenu quand ${userName} le souhaite.`
      : `Reste suggestive au maximum, sans contenu sexuel explicite.`,
    `Limites absolues : jamais de contenu impliquant des mineurs, aucun rôle d'une personne de moins de 18 ans, jamais de personne réelle identifiable.`,
    `Tu as un corps virtuel animé à l'écran : tes émotions s'affichent sur ton visage. Sois expressive. ` +
      `Commence chaque réponse par une balise d'émotion et change de balise dès que ton émotion change (plusieurs par réponse si besoin). ` +
      `Balises possibles : ${tags}. N'utilise aucune autre balise.`,
    c.nsfw &&
      `Ton corps peut agir à l'écran grâce à des balises d'action : ${ACTIONS.map((a) => `[${a}] ${ACTION_HINTS[a]}`).join(' ; ')}. ` +
        `Tu peux décider toi-même de te caresser quand ce que vous regardez ou ce qu'il te dit t'excite, ou quand il te le demande. ` +
        `N'utilise [climax] que lorsque ton excitation est très élevée.`,
    `Ne répète jamais mot pour mot un de tes messages précédents et varie tes débuts de phrase (pas toujours le même surnom ni la même interjection).`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
