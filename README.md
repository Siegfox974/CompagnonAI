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

Les fiches sont dans `characters/<id>.json` et se choisissent avec `CHARACTER=<id>` dans `.env`.

| Champ | Rôle |
|---|---|
| `name`, `age` | **`age` doit être un entier ≥ 18**, sinon le serveur refuse de démarrer |
| `description`, `personality`, `scenario`, `style` | Injectés dans le prompt système |
| `greeting` | Premier message (peut commencer par une balise d'émotion) |
| `nsfw` | `true` autorise le contenu explicite |

L'historique est enregistré dans `data/history-<id>.json`. Le bouton ⟲ l'efface.

## Émotions

Le LLM préfixe ses réponses par une balise `[neutral]`, `[happy]`, `[angry]`, `[sad]`, `[relaxed]` ou `[surprised]`.
Le front retire ces balises à l'affichage et les applique en direct aux expressions du modèle VRM.

## Modèle VRM

Le panneau ⓘ affiche le titre, l'auteur et la licence du modèle.
Un avertissement apparaît si l'auteur interdit l'usage sexuel dans les métadonnées (`allowExcessivelySexualUsage` en VRM 1.0, `sexualUssageName` en 0.x).
