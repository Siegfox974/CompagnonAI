# CompagnonAI

Compagnon IA pour adulte, **100 % local** : un personnage VRM animé avec qui on discute, qui réagit avec des émotions et qui parle.
Usage personnel, rien ne quitte la machine.

> État actuel : application desktop avec avatar VRM, chat en streaming avec un LLM local, émotions, ambiances
> (néon, boudoir, studio), site en fond dont elle connaît le titre et les tags, mémoire persistante.
> Feuille de route complète dans [ARCHITECTURE.md](ARCHITECTURE.md).

## Prérequis

- Node.js ≥ 22.9
- Un serveur LLM compatible OpenAI. Le plus simple est [Ollama](https://ollama.com) :
  ```bash
  ollama pull mistral-nemo
  ```
  `mistral-nemo` (12B) parle bien français et tient sur environ 8 Go de VRAM en Q4.
  Pour du jeu de rôle adulte, on peut prendre un fine-tune RP communautaire (Hugging Face, format GGUF) et le déclarer dans `LLM_MODEL`.
  llama.cpp `llama-server`, LM Studio et KoboldCpp fonctionnent aussi : il suffit de changer `LLM_BASE_URL`.

## Lancer

```bash
npm install
cp .env.example .env   # puis ajuster LLM_MODEL
npm run app            # application desktop (recommandé)
```

Glisser un fichier `.vrm` dans la fenêtre. Pour qu'il se charge automatiquement, le placer dans `models/default.vrm`.

`npm run dev` lance la version navigateur sur http://localhost:3000. Elle ne permet pas d'afficher un site en fond.

## Site en fond

Bouton 🌐 : le site s'affiche à gauche et l'avatar se place dans le coin, par-dessus, sans bloquer les clics.
- La barre du haut permet de saisir une adresse et de naviguer ; 👁 masque ou affiche l'avatar.
- Les pop-ups sont bloquées.
- Cookies et cache restent dans `data/electron/`, donc pas sur C:.
- À chaque page, le titre, la description et les tags sont transmis au personnage, qui peut en parler quand tu lui écris.
  La ligne 👀 du panneau montre ce qu'elle « voit ».
- Une page dont le titre ou les tags évoquent des mineurs est refusée : elle ne la commente pas.

### Mode cinéma 🎬
Isole le lecteur vidéo de la page (le plus grand `<video>` ou `<iframe>`) et masque tout le reste, en laissant de la place à droite pour l'avatar.
Un bloqueur de pubs et de pisteurs (listes Ghostery / EasyList, mises en cache dans `data/`) est actif sur le site en fond.

### Quel navigateur ?
Le site en fond s'ouvre dans le **navigateur intégré à l'application** (Chromium, via Electron), séparé de Chrome ou Edge :
rien n'apparaît dans leur historique. Ce n'est pas une navigation privée : cookies et cache sont gardés dans `data/electron/`.
Pour tout effacer, fermer l'application et supprimer ce dossier.

## Réactions spontanées 💬
Elle prend la parole d'elle-même :
- environ 7 s après l'ouverture d'une nouvelle page ;
- quand tu regardes sans rien dire depuis 3 min ;
- quand tu es silencieux depuis 6 min hors vidéo.

Il y a toujours au moins 45 s entre deux prises de parole spontanées. Le bouton 💬 les active ou les désactive.

## Personnages
Le menu en haut du panneau permet de changer de personnage à tout moment. Chacun garde sa propre mémoire.
- **Luna** (27 ans) : petite amie complice et joueuse.
- **Victoria** (38 ans) : mommy dominante et perverse.
- **Jade** (24 ans) : coquine espiègle et provocatrice.

Pour en créer un, copier une fiche de `characters/`.

## Garde-robe 👗
Liste les parties du modèle, regroupées par matériau (Tops, Bottoms, Shoes, Hair…). Décocher une partie la retire.
Le choix est mémorisé par modèle.
⚠ Sur la plupart des modèles VRoid, il n'y a pas de peau sous les vêtements : retirer un haut laisse un vide.
Pour un vrai résultat, il faut un modèle conçu pour (corps complet, vêtements séparés).

## Expressions
12 émotions que le LLM choisit, plusieurs par réponse : neutral, happy, excited, flirty, teasing, aroused, shy, relaxed, surprised, pout, sad, angry.
Chacune combine :
- un mélange d'expressions du visage ;
- une posture (tête penchée ou baissée, buste en avant, déhanché plus ou moins marqué, respiration) ;
- un geste ponctuel (hochement, clin d'œil, sursaut, regard fuyant, rebond).

Le rougissement fonctionne si le modèle a une expression « blush ». Elle te regarde, regarde le chat quand tu écris, et jette des coups d'œil à la vidéo.

## Ambiances

Bouton 🎨 : **Néon** (rose et violet), **Boudoir** (lumière chaude de bougie qui vacille) ou **Studio** (neutre).

## Réponses lentes ?

La vitesse dépend du LLM et de la carte graphique. `ollama ps` doit afficher **100% GPU**. Sinon :
- choisir un modèle plus petit (7–8B au lieu de 12B) ;
- baisser `LLM_MAX_TOKENS` dans `.env` (par exemple 200) ;
- fermer les autres programmes qui utilisent la carte graphique.

## Windows : installation et mises à jour

Installer une fois [Git](https://git-scm.com/download/win) et [Node.js LTS](https://nodejs.org), puis :

```bat
cd /d D:\
git clone -b claude/practical-hamilton-vv7br4 https://github.com/siegfox974/CompagnonAI.git
```

- **Lancer** : double-clic sur `lancer.bat` (application desktop). `lancer-navigateur.bat` ouvre la version navigateur.
- **Mettre à jour** : double-clic sur `mettre-a-jour.bat`. Seuls les fichiers modifiés sont téléchargés. Les modèles Ollama, `.env`, `models/` et `data/` ne sont pas touchés.

Pour stocker les modèles Ollama hors du SSD : `setx OLLAMA_MODELS "D:\Ollama\models"`, puis redémarrer Ollama.

## Personnage

Les fiches sont dans `characters/<id>.json`. Le personnage de départ se règle avec `CHARACTER=<id>` dans `.env`, puis se change depuis le menu.

| Champ | Rôle |
|---|---|
| `name`, `age` | **`age` doit être un entier ≥ 18**, sinon la fiche est ignorée |
| `tagline` | Description courte affichée dans le menu |
| `description`, `personality`, `scenario`, `style` | Injectés dans le prompt système |
| `greeting` | Premier message (peut commencer par une balise d'émotion) |
| `nsfw` | `true` autorise le contenu explicite |

L'historique est enregistré dans `data/history-<id>.json`. Le bouton ⟲ l'efface.

## Émotions

Le LLM insère des balises d'émotion (`[flirty]`, `[shy]`…, voir « Expressions » plus haut).
Le front retire ces balises à l'affichage et les applique en direct aux expressions du modèle VRM.

## Modèle VRM

Le panneau ⓘ affiche le titre, l'auteur et la licence du modèle.
Un avertissement apparaît si l'auteur interdit l'usage sexuel dans les métadonnées (`allowExcessivelySexualUsage` en VRM 1.0, `sexualUssageName` en 0.x).
