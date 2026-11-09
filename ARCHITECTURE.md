# Architecture et feuille de route

## Principes

1. **Local d'abord.** LLM, voix et mémoire tournent sur la machine. Le serveur écoute seulement sur `127.0.0.1`.
2. **Fournisseurs interchangeables.** Le LLM est appelé via l'API OpenAI `/chat/completions`, donc on peut changer de moteur sans toucher au code.
3. **Personnages majeurs uniquement.** L'âge est vérifié au chargement de la fiche, et le prompt système interdit tout rôle de mineur et toute personne réelle.

## Vue d'ensemble

```
 Navigateur (web/)                         Serveur Node (server/)              Local
┌──────────────────────────────┐        ┌─────────────────────────┐      ┌──────────────┐
│ avatar.js  three.js+three-vrm│        │ index.js   Express      │      │ Ollama /     │
│   émotions, clignements,     │  HTTP  │ character.js fiche+prompt│ SSE  │ llama.cpp /  │
│   respiration, regard, bouche│◄──────►│ memory.js  historique    │◄────►│ LM Studio    │
│ tags.js   balises d'émotion  │ stream │ llm.js     client OpenAI │      └──────────────┘
│ tts.js    Web Speech         │        └─────────────────────────┘
│ main.js   UI + chat          │                 ▲ (MVP 3) WebSocket
└──────────────────────────────┘                 │
                                        ┌─────────────────────────┐
                                        │ Extension navigateur    │
                                        │ métadonnées de la page  │
                                        └─────────────────────────┘
```

## Feuille de route

### MVP 1 : fait
- Chargement VRM 0.x et 1.0 (glisser-déposer ou `models/default.vrm`), pose au repos, cadrage auto.
- Animations procédurales : respiration, balancement, clignements, regard qui suit le curseur.
- Chat en streaming, émotions pilotées par balises, transitions douces.
- Voix via Web Speech, découpée par phrases pendant le streaming, bouche animée.
- Fiches personnage, historique persistant, lecture des permissions VRM.

### MVP 2 : voix et mémoire
- **STT** : `faster-whisper` en service Python local, avec détection d'activité vocale (VAD) pour parler sans appuyer sur un bouton.
- **TTS** : Kokoro (Apache 2.0) ou Piper. On envoie l'audio au navigateur et on calcule le **lip-sync** à partir de l'amplitude, ou mieux, des phonèmes.
- **Mémoire long terme** : résumé glissant au-delà de `CONTEXT_MESSAGES`, plus des faits marquants extraits par le LLM et indexés (sqlite-vec), réinjectés quand ils sont pertinents.
- **Animations** : clips `.vrma` (idle, rire, gêne…) déclenchés par une balise `[anim:xxx]`.

### MVP 3 : réagir à ce que tu regardes
- **Extension Chrome/Firefox** (Manifest V3) qui ne s'active que sur une **liste blanche de domaines**.
- Elle extrait titre, tags, catégories et durée (DOM, balises meta et JSON-LD), sans aucune capture d'écran, puis les envoie par WebSocket à `ws://127.0.0.1:<port>/events`.
- Côté serveur, un `EventBus` injecte un message système (« Il regarde : … ») et une **politique de réaction** décide quand elle parle : délai minimal entre deux remarques, probabilité, changement de vidéo, pause. L'idée est d'éviter qu'elle commente toutes les 10 secondes.
- Dans l'UI : un indicateur « elle regarde » et un bouton pause.
- Filtre : si les métadonnées évoquent des mineurs ou du contenu non consenti, elle refuse et ne commente pas.

### Plus tard
- Mode vision optionnel : capture de l'onglet à la demande, analysée par un VLM local (Qwen-VL, MiniCPM-V…). C'est coûteux en VRAM, donc à activer à la main.
- App desktop (Tauri) avec fenêtre transparente, l'avatar posé sur le bureau.
- Plusieurs personnages, tenues, éditeur de fiche dans l'UI.

## Budget matériel indicatif

| Composant | VRAM |
|---|---|
| LLM 12B Q4 | ~8 Go |
| Whisper small/medium | 1–2 Go |
| Kokoro / Piper | < 1 Go (ou CPU) |
| Rendu VRM | < 1 Go |

Cible : un GPU de 12 Go (par exemple RTX 3060 12 Go). Avec moins, il faut un LLM plus petit ou décharger une partie sur le CPU.
