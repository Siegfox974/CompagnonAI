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

## Moment intime 🔥
Elle se caresse en regardant avec toi. Les mains sont placées par cinématique inverse : une entre les cuisses avec un va-et-vient, l'autre sur la poitrine. Le bassin ondule, la tête part en arrière, les yeux se ferment à moitié.
- **Déclenchement** : le bouton 🔥, ou elle-même quand la conversation ou la vidéo l'excite (balises `[touch]`, `[stop]`, `[climax]` du LLM).
- **Excitation** : une jauge qui monte pendant que la vidéo est en lecture (environ 3 min pour atteindre 100 %) et redescend en pause.
  Le rythme suit l'excitation et ralentit quand la vidéo est en pause.
- **Orgasme** à 100 %, ou quand elle le décide : tremblements, tête renversée, yeux fermés, puis relâchement.
- **Dans la conversation** : son état est transmis au LLM, ses réponses deviennent haletantes, et elle s'exprime d'elle-même environ toutes les 40 s.

Uniquement pour les personnages avec `"nsfw": true`.

## Animations MMD (.vmd) 🎞
Les animations MikuMikuDance se jouent sur le modèle VRM.
- **Ajouter** : glisser un fichier `.vmd` dans la fenêtre. Il est copié dans `motions/`, qui est exclu de Git.
- **Utiliser** : dans le panneau 🎞, choisir l'animation du moment 🔥. Elle remplace alors l'animation calculée,
  accélère avec l'excitation et ralentit quand la vidéo est en pause. « Jouer en boucle » la lance à tout moment.
- **Conversion** :
  - os japonais → os VRM, repère MMD (main gauche) → three.js ;
  - bras au repos en A (MMD) → en T (VRM), avec un angle de 35° ;
  - jambes : la position des pieds (IK) est recalculée ;
  - expressions courantes (clignement, voyelles, sourire) reprises ;
  - l'os racine (placement dans la scène d'origine) est ignoré pour qu'elle reste face à toi.
- **La caméra suit le bassin** pendant l'animation : accroupie ou allongée, elle reste dans le cadre.
- **Limites** :
  - pas de sol ni de décor : une pose assise donne l'impression qu'elle flotte ;
  - les expressions propres au modèle d'origine sont ignorées ;
  - si les proportions sont très différentes, les mains peuvent tomber à côté.

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

### Utiliser un modèle MMD (.pmx)
Les modèles `.pmx` se chargent directement, avec leurs matériaux toon d'origine, l'IK MMD et la physique des cheveux et de la poitrine (`@moeru/three-mmd`) :
1. Copier **le dossier complet du modèle**, avec son sous-dossier de textures, dans `models/` (par exemple `models/eleanor/…`).
2. Dans l'app : ⓘ → **Modèle**, puis le choisir. Le choix est mémorisé.

Points à connaître :
- Les animations `.vmd` se jouent **nativement** sur un PMX, sans conversion : rendu fidèle à MMD.
- Les morphs japonais courants pilotent les émotions : まばたき, 笑い, にこり, ウィンク, びっくり, 困る, 怒り, あいうえお.
  Le rougissement utilise 照れ / 赤面, et les yeux en cœur ハート目 s'affichent à l'orgasme.
- La garde-robe liste les matériaux avec une traduction (Nuisette, Sous-vêtements, Corps…).
- **Réglages du modèle** (dans 👗) : les morphs prévus par l'auteur, avec des curseurs mémorisés par modèle.
  On y trouve les tenues (« 衬衣消 » = masquer la chemise, « ネグリジェ消し » = masquer la nuisette), les formes et les variantes.
  Quand un modèle superpose plusieurs tenues, c'est là qu'on choisit celle qui est portée.
- Les morphs de matériau (masquer un vêtement, rougissement) sont appliqués par l'app : la bibliothèque les lit mais ne les applique pas.
- **Éclairage** : les modèles MMD utilisent l'éclairage de référence de MMD (lumière ambiante + une directionnelle), légèrement teinté par l'ambiance. La **luminosité** et les **reflets** (dans ⓘ) sont réglables et mémorisés. Les reflets dosent les sphere maps en addition (peau huilée, cheveux) : 0,5 par défaut, car la bibliothèque les applique beaucoup plus fort que MMD.
- Une texture introuvable est signalée dans le chat. La partie concernée garde sa couleur unie au lieu de disparaître.
- Le format PMX ne contient pas de permissions : elles sont dans le **readme** du modèle.

Alternative : convertir le PMX en VRM avec Blender (gratuit) :
1. Installer **[MMD Tools](https://extensions.blender.org/add-ons/mmd-tools/)** et le **[VRM Add-on for Blender](https://vrm-addon-for-blender.info/)**.
2. Importer le `.pmx` (File → Import → MikuMikuDance Model).
3. Définir les os humanoïdes dans l'onglet VRM (assignation automatique proposée), puis exporter en `.vrm`.

Les shaders MMD sont convertis en MToon : le rendu change un peu. Vérifier aussi les conditions d'utilisation du modèle (fichier « readme » fourni avec).

## Expressions
12 émotions que le LLM choisit, plusieurs par réponse : neutral, happy, excited, flirty, teasing, aroused, shy, relaxed, surprised, pout, sad, angry.
Chacune combine :
- un mélange d'expressions du visage ;
- une posture (tête penchée ou baissée, buste en avant, déhanché plus ou moins marqué, respiration) ;
- un geste ponctuel (hochement, clin d'œil, sursaut, regard fuyant, rebond).

Le rougissement fonctionne si le modèle a une expression « blush ». Elle te regarde, regarde le chat quand tu écris, et jette des coups d'œil à la vidéo.

## Ambiances

Bouton 🎨 : **Néon** (rose et violet), **Boudoir** (lumière chaude de bougie qui vacille) ou **Studio** (neutre).

## Réglages conseillés pour une RTX 3060 12 Go

Un modèle de 12B en Q4 (environ 7 Go) tient entièrement dans la carte, avec la place pour le contexte et l'affichage 3D :
```bat
setx OLLAMA_CONTEXT_LENGTH 8192
setx OLLAMA_FLASH_ATTENTION 1
setx OLLAMA_KV_CACHE_TYPE q8_0
```
Redémarrer ensuite Ollama. Sans `OLLAMA_CONTEXT_LENGTH`, Ollama peut couper la conversation : le prompt du personnage
et l'historique dépassent la taille par défaut. Elle « oublie » alors ses consignes et répond plus lentement.

## Réponses plus naturelles
- **Anti-répétition automatique** : à chaque réponse, le serveur repère dans ses derniers messages les débuts de phrase, les formules
  qui reviennent et les questions finales systématiques, puis les lui interdit dans la consigne.
- **Pénalités de répétition** envoyées au modèle (`LLM_FREQUENCY_PENALTY`, `LLM_PRESENCE_PENALTY` dans `.env`).
- **Exemples de dialogue** (`examples` dans chaque fiche de `characters/`) : ils montrent le ton et la longueur attendus.
  C'est le réglage le plus efficace pour donner une personnalité. Modifie-les à ton goût.

## Espace disque
- `espace-disque.bat` affiche ce qu'occupent le projet et ses outils : cache, modèles, Ollama, cache npm, fichiers temporaires.
- Le cache du navigateur intégré (morceaux de vidéos) est plafonné à 300 Mo et vidé à chaque fermeture de l'application.

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
- **Espace disque** : `espace-disque.bat` indique ce qui prend de la place.
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
