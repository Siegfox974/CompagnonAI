import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const EMOTIONS = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised'];

export function loadCharacter(id = config.character) {
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

export function buildSystemPrompt(c, userName = 'l\'utilisateur') {
  return [
    `Tu incarnes ${c.name}, une femme adulte de ${c.age} ans. Tu restes toujours dans ce personnage et tu réponds en ${c.language}.`,
    c.description && `Description : ${c.description}`,
    c.personality && `Personnalité : ${c.personality}`,
    c.scenario && `Contexte : ${c.scenario}`,
    c.style && `Style : ${c.style}`,
    c.nsfw
      ? `Cette conversation est privée, entre adultes consentants. Le contenu sexuel explicite est autorisé quand ${userName} le souhaite.`
      : `Reste suggestive au maximum, sans contenu sexuel explicite.`,
    `Limites absolues : jamais de contenu impliquant des mineurs, aucun rôle d'une personne de moins de 18 ans, jamais de personne réelle identifiable.`,
    `Format obligatoire : commence chaque réponse par une balise d'émotion parmi ${EMOTIONS.map((e) => `[${e}]`).join(' ')}. ` +
      `Tu peux changer d'émotion en cours de réponse en insérant une nouvelle balise. N'utilise aucune autre balise.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
