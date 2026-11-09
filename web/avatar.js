import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { MotionPlayer } from './retarget.js';
import { loadPMX } from './pmx.js';

const BASE_EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

/**
 * Humeurs : mélange d'expressions VRM de base + posture + geste ponctuel.
 * pose : tilt (tête penchée), yaw (tête tournée), pitch (>0 = baisse la tête), lean (buste en avant),
 *        sway (amplitude du déhanché), speed (vitesse du déhanché), breath (rythme de respiration).
 */
const MOODS = {
  neutral: { exp: {}, pose: {} },
  happy: { exp: { happy: 1 }, pose: { sway: 1.2 }, gesture: 'nod' },
  excited: { exp: { happy: 1, surprised: 0.3 }, pose: { sway: 1.4, speed: 1.4, breath: 1.4 }, gesture: 'bounce' },
  flirty: { exp: { relaxed: 0.6, happy: 0.35 }, pose: { tilt: 0.14, lean: 0.06, sway: 1.7, speed: 0.75 }, gesture: 'wink', blush: 0.4 },
  teasing: { exp: { happy: 0.65 }, pose: { tilt: 0.12, yaw: 0.1 }, gesture: 'wink', blush: 0.2 },
  aroused: { exp: { relaxed: 0.85 }, mouth: 0.18, lids: 0.3, pose: { pitch: -0.06, sway: 1.9, speed: 0.6, breath: 2 }, blush: 1 },
  shy: { exp: { happy: 0.4, sad: 0.25 }, lids: 0.15, pose: { pitch: 0.16, yaw: 0.2, tilt: 0.08, sway: 0.5 }, gesture: 'lookaway', blush: 1 },
  relaxed: { exp: { relaxed: 1 }, pose: { sway: 1 } },
  surprised: { exp: { surprised: 1 }, pose: { pitch: -0.08 }, gesture: 'jolt' },
  pout: { exp: { angry: 0.35, sad: 0.35 }, pose: { yaw: -0.22, pitch: 0.05, sway: 0.4 } },
  sad: { exp: { sad: 1 }, pose: { pitch: 0.12, sway: 0.4, breath: 0.8 } },
  angry: { exp: { angry: 1 }, pose: { pitch: 0.06, sway: 0.3 }, gesture: 'shake' },
};
const POSE_DEFAULTS = { tilt: 0, yaw: 0, pitch: 0, lean: 0, sway: 1, speed: 1, breath: 1 };
/** Expressions personnalisées de rougissement, présentes sur certains modèles. */
const BLUSH_RE = /blush|cheek|tere|照れ|赤面|頬|ほほ|ポッ/i;
const PANEL_W = 400;

/** Préréglages d'éclairage : [couleur, intensité]. */
export const AMBIANCES = {
  neon: {
    label: 'Néon',
    hemi: [0x8a6aa8, 0x200a28, 0.9],
    key: [0xffd0e6, 1.3],
    rimA: [0xff3d9a, 3.2],
    rimB: [0x7a4dff, 3.2],
    particles: [0xff5fa8, 0x8a6bff],
  },
  boudoir: {
    label: 'Boudoir',
    hemi: [0xa06050, 0x200505, 0.7],
    key: [0xffb070, 1.5],
    rimA: [0xff3020, 2.4],
    rimB: [0xff8a3a, 1.8],
    particles: [0xffa040, 0xff4030],
    flicker: true,
  },
  studio: {
    label: 'Studio',
    hemi: [0xffffff, 0x443344, 1.2],
    key: [0xffffff, 1.6],
    rimA: [0xffffff, 0.4],
    rimB: [0xc9a0ff, 0.6],
    particles: null,
  },
};

/** Scène three.js + avatar VRM : émotions, clignements, respiration, déhanché, regard, bouche, ambiances. */
export class Avatar {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.4, 1.9);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.3, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;

    this.lights = {
      hemi: new THREE.HemisphereLight(),
      key: new THREE.DirectionalLight(),
      rimA: new THREE.DirectionalLight(),
      rimB: new THREE.DirectionalLight(),
    };
    this.lights.key.position.set(1, 2, 2);
    this.lights.rimA.position.set(-1.6, 1.8, -1.5);
    this.lights.rimB.position.set(1.6, 1.2, -1.5);
    Object.values(this.lights).forEach((l) => this.scene.add(l));
    this.particles = makeParticles();
    this.scene.add(this.particles);

    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);
    this.mouse = new THREE.Vector2();
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    });

    this.vrm = null;
    this.layout = 'center';
    this.mood = 'neutral';
    this.expWeights = {};
    this.pose = { ...POSE_DEFAULTS };
    this.mouthBase = 0;
    this.lids = 0;
    this.blush = 0;
    this.blushNames = [];
    this.gesture = null;
    this.attention = 'user';
    // Moment intime : on (elle se caresse), w (fondu 0→1), arousal (0→1), phase du rythme, orgasme.
    this.act = { on: false, w: 0, arousal: 0, phase: 0, climaxT: -1, videoPlaying: true };
    // Animation .vmd en cours : lecteur, temps, vitesse, fondu.
    this.motion = { player: null, clip: null, on: false, t: 0, rate: 1, w: 0 };
    this.glanceUntil = 0;
    this.nextGlance = 5;
    this.speaking = false;
    this.mouthOpen = 0;
    this.viseme = 'aa';
    this.nextViseme = 0;
    this.nextBlink = 2;
    this.blinkT = -1;
    this.clock = new THREE.Clock();

    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));

    this.setAmbiance('neon');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (w > 800) {
      const freeW = w - PANEL_W;
      // 'center' : avatar centré dans la zone libre ; 'corner' : en bas à droite, par-dessus le site.
      const targetX = this.layout === 'corner' ? freeW - Math.min(260, freeW * 0.2) : freeW / 2;
      const offsetY = this.layout === 'corner' ? -h * 0.1 : 0;
      this.camera.setViewOffset(w, h, w / 2 - targetX, offsetY, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  setLayout(layout) {
    this.layout = layout;
    this.resize();
    if (this.vrm) this.frame();
  }

  /** Multiplie l'intensité de l'éclairage (les matériaux MMD réagissent plus fort que les VRM). */
  setBrightness(k) {
    this.brightness = k;
    if (this.ambiance) this.setAmbiance(this.ambianceName);
  }

  setAmbiance(name) {
    const a = AMBIANCES[name] ?? AMBIANCES.neon;
    this.ambiance = a;
    this.ambianceName = name;
    const k = this.brightness ?? 1;
    const { hemi, key, rimA, rimB } = this.lights;
    if (this.vrm?.isPMX) {
      // Matériaux toon MMD : lumière ambiante uniforme + une directionnelle (pas de dégradé ciel/sol),
      // légèrement teintées par l'ambiance ; contre-jours discrets.
      // Calibré pour qu'une peau éclairée de face restitue la couleur de sa texture (luminosité 1).
      const tint = (c, amount) => new THREE.Color(0xffffff).lerp(new THREE.Color(c), amount);
      hemi.color.copy(tint(a.hemi[0], 0.15));
      hemi.groundColor.copy(hemi.color);
      hemi.intensity = 1.25 * k;
      key.color.copy(tint(a.key[0], 0.25));
      key.intensity = key.baseIntensity = 1.9 * k;
      key.position.set(-1, 1, 1);
      for (const [light, [color, intensity]] of [[rimA, a.rimA], [rimB, a.rimB]]) {
        light.color.set(color);
        light.intensity = light.baseIntensity = intensity * 0.2 * k;
      }
    } else {
      hemi.color.set(a.hemi[0]);
      hemi.groundColor.set(a.hemi[1]);
      hemi.intensity = a.hemi[2] * k;
      key.position.set(1, 2, 2);
      for (const [light, [color, intensity]] of [[key, a.key], [rimA, a.rimA], [rimB, a.rimB]]) {
        light.color.set(color);
        light.intensity = light.baseIntensity = intensity * k;
      }
    }
    this.particles.visible = !!a.particles;
    if (a.particles) {
      const colors = this.particles.geometry.attributes.color;
      const c1 = new THREE.Color(a.particles[0]);
      const c2 = new THREE.Color(a.particles[1]);
      for (let i = 0; i < colors.count; i++) {
        const c = c1.clone().lerp(c2, Math.random());
        colors.setXYZ(i, c.r, c.g, c.b);
      }
      colors.needsUpdate = true;
    }
  }

  /** Charge un VRM depuis une URL (ou un blob URL). Renvoie ses métadonnées. */
  /** Charge un modèle VRM ou MMD (.pmx, depuis son dossier pour trouver ses textures). */
  async load(url) {
    const isPMX = /\.pmx$/i.test(url.split('?')[0]);
    let vrm;
    if (isPMX) {
      vrm = await loadPMX(url, (files) => this.onMissingTextures?.(files));
    } else {
      const gltf = await this.loader.loadAsync(url);
      vrm = gltf.userData.vrm;
      if (!vrm) throw new Error("Ce fichier n'est pas un modèle VRM valide.");
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
    }

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      if (this.vrm.isPMX) this.vrm.dispose();
      else VRMUtils.deepDispose(this.vrm.scene);
    }
    vrm.scene.traverse((o) => (o.frustumCulled = false));

    this.vrm = vrm;
    // VRM 0.x : squelette retourné, les rotations autour de X et Z sont inversées.
    this.flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
    this.armRest = measureArmRest(vrm);
    if (this.ambianceName) this.setAmbiance(this.ambianceName); // éclairage adapté au type de modèle
    this.blushNames = (vrm.expressionManager?.expressions ?? [])
      .map((e) => e.expressionName)
      .filter((n) => BLUSH_RE.test(n));
    this.scene.add(vrm.scene);
    this.hipsRest = vrm.humanoid.getNormalizedBoneNode('hips').position.clone();
    // Position de repos du bassin dans la scène (mètres), pour le suivi caméra (un PMX est mis à l'échelle).
    vrm.scene.updateMatrixWorld(true);
    this.hipsRestWorld = vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(new THREE.Vector3());
    this.motion.player = this.motion.clip && !vrm.isPMX ? new MotionPlayer(vrm, this.motion.clip, this.flip, this.hipsRest) : null;
    if (vrm.isPMX && this.motion.on && this.motion.clip?.url) vrm.playVMD(this.motion.clip.url).catch(() => {});
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.restPose();
    this.frame();
    return readMeta(vrm);
  }

  /** Bras le long du corps au lieu de la T-pose. */
  restPose() {
    const bone = (n) => this.vrm.humanoid.getNormalizedBoneNode(n);
    // En VRM 0.x le squelette regarde vers -Z (retourné ensuite par rotateVRM0) :
    // le sens des rotations est donc inversé par rapport au VRM 1.0.
    const s = this.flip;
    // Angle à ajouter depuis la pose de repos du modèle (T pour un VRM, A pour un modèle MMD).
    const { left = 0, right = 0 } = this.armRest ?? {};
    bone('leftUpperArm')?.rotation.set(0, 0, -(1.2 - left) * s);
    bone('rightUpperArm')?.rotation.set(0, 0, (1.2 - right) * s);
    bone('leftLowerArm')?.rotation.set(0, -0.25 * s, 0);
    bone('rightLowerArm')?.rotation.set(0, 0.25 * s, 0);
    this.restQ = Object.fromEntries(
      ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'].map((n) => [
        n,
        bone(n)?.quaternion.clone(),
      ]),
    );
  }

  /** Cadre la caméra : haut du corps (centre) ou plan plus large (coin, par-dessus le site). */
  frame() {
    this.vrm.scene.updateMatrixWorld(true);
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    // Plan large en coin (par-dessus le site) ou pendant le moment intime (pour voir les mains).
    const wide = this.layout === 'corner' || this.act.on;
    this.controls.target.set(0, wide ? y - 0.38 : y - 0.12, 0);
    this.camera.position.set(0, wide ? y - 0.32 : y - 0.1, wide ? 2.8 : 1.9);
    this.controls.update();
    this.baseTarget = this.controls.target.clone();
  }

  setEmotion(name) {
    const mood = MOODS[name] ? name : 'neutral';
    if (mood !== this.mood && MOODS[mood].gesture) this.playGesture(MOODS[mood].gesture);
    this.mood = mood;
  }

  /** Geste bref joué par-dessus la posture : nod, bounce, wink, jolt, shake, lookaway. */
  playGesture(type) {
    this.gesture = { type, t: 0, side: Math.random() < 0.5 ? 'blinkLeft' : 'blinkRight' };
  }

  /** Où elle regarde : 'user' (toi / la souris), 'chat' (le panneau quand tu écris), 'screen' (la vidéo). */
  /** Elle se caresse (true) ou s'arrête (false). */
  setAct(on) {
    if (this.act.on === on) return;
    this.act.on = on;
    if (this.vrm) this.frame();
  }

  /** Niveau d'excitation 0..1 : accélère le rythme et intensifie les expressions. */
  setArousal(v) {
    this.act.arousal = THREE.MathUtils.clamp(v, 0, 1);
  }

  /** La vidéo est-elle en lecture ? (en pause, le rythme ralentit) */
  setVideoPlaying(on) {
    this.act.videoPlaying = on;
  }

  /** Joue une animation .vmd en boucle (clip de parseVMD), ou l'arrête en fondu (null). */
  setMotion(clip) {
    const m = this.motion;
    if (!clip) {
      m.on = false;
      return;
    }
    if (this.vrm?.isPMX) {
      // Modèle MMD : lecture native du fichier (IK, liaisons et morphs MMD compris).
      m.clip = clip;
      m.on = true;
      if (clip.url) this.vrm.playVMD(clip.url).catch((err) => console.error(err));
      return;
    }
    if (clip !== m.clip) {
      m.player?.reset();
      m.clip = clip;
      m.t = 0;
      m.player = this.vrm ? new MotionPlayer(this.vrm, clip, this.flip, this.hipsRest) : null;
    }
    m.on = true;
  }

  setMotionRate(rate) {
    this.motion.rate = rate;
  }

  /** Orgasme : environ 4 s d'intensité maximale, tremblements, puis relâchement. */
  climax() {
    this.act.climaxT = 0;
  }

  setAttention(target) {
    this.attention = target;
  }

  /** Morphs de réglage du modèle (tenues, formes) : uniquement pour les modèles MMD. */
  getMorphs() {
    const rig = this.vrm;
    return rig?.isPMX ? rig.settingMorphs.map((name) => ({ name, value: rig.getMorph(name) })) : [];
  }

  setMorph(name, value) {
    if (this.vrm?.isPMX) this.vrm.setMorph(name, value);
  }

  /** Parties du modèle regroupées par matériau (vêtements, accessoires, cheveux...). */
  getParts() {
    const parts = new Map();
    this.vrm?.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        const key = partName(m.name) || partName(o.name) || 'Sans nom';
        if (!parts.has(key)) parts.set(key, []);
        parts.get(key).push(m);
      }
    });
    return [...parts].map(([name, mats]) => ({ name, visible: mats.some((m) => !m.userData.hiddenByUser), mats }));
  }

  setPartVisible(name, visible) {
    for (const p of this.getParts()) {
      if (p.name !== name) continue;
      for (const m of p.mats) {
        m.userData.hiddenByUser = !visible;
        m.visible = visible;
      }
    }
  }

  setSpeaking(on) {
    this.speaking = on;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.controls.update();
    this.animateAmbiance(t, dt);

    if (this.vrm) {
      this.animateBody(t, dt);
      this.followBody(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  animateBody(t, dt) {
    const vrm = this.vrm;
    const em = vrm.expressionManager;
    const damp = (a, b, k = 5) => THREE.MathUtils.damp(a, b, k, dt);

    // Moment intime : fondu, rythme (plus rapide avec l'excitation, ralenti si la vidéo est en pause), orgasme.
    const act = this.act;
    act.w = damp(act.w, act.on ? 1 : 0, 2.5);
    const intensity = act.w * (0.4 + 0.6 * act.arousal);
    act.phase += dt * Math.PI * 2 * (0.8 + act.arousal * 1.8) * (act.videoPlaying ? 1 : 0.5);
    let C = 0;
    if (act.climaxT >= 0) {
      act.climaxT += dt;
      C = act.climaxT < 4 ? Math.min(1, act.climaxT * 3) : Math.max(0, 1 - (act.climaxT - 4) / 3);
      if (act.climaxT > 7) act.climaxT = -1;
    }
    const stroke = Math.sin(act.phase);
    const mood = act.w > 0.5 || C > 0 ? MOODS.aroused : MOODS[this.mood];
    const set = (name, v) => em?.getExpression(name) && em.setValue(name, THREE.MathUtils.clamp(v, 0, 1));

    // Expressions : transition douce vers le mélange de l'humeur.
    for (const e of BASE_EXPRESSIONS) {
      const goal = (mood.exp[e] ?? 0) * (this.speaking ? 0.75 : 1);
      this.expWeights[e] = damp(this.expWeights[e] ?? 0, goal, 6);
      set(e, this.expWeights[e]);
    }
    this.mouthBase = damp(this.mouthBase, Math.max(mood.mouth ?? 0, intensity * (0.15 + 0.15 * Math.abs(stroke)), C * 0.6), 8);
    this.lids = damp(this.lids, Math.max(mood.lids ?? 0, intensity * 0.45, C * 0.9), 6);
    this.blush = damp(this.blush, Math.max(mood.blush ?? 0, act.w), 2);
    for (const n of this.blushNames) set(n, this.blush);
    // Yeux en cœur à l'orgasme (si le modèle en a : morph ハート目 des modèles MMD).
    set('heartEyes', C);

    // Posture : chaque paramètre glisse vers celui de l'humeur.
    for (const k of Object.keys(POSE_DEFAULTS)) {
      this.pose[k] = damp(this.pose[k], mood.pose[k] ?? POSE_DEFAULTS[k], 3);
    }

    // Geste ponctuel.
    const g = { pitch: 0, yaw: 0, roll: 0, chest: 0, wink: 0 };
    if (this.gesture) {
      const k = (this.gesture.t += dt);
      const env = Math.max(0, 1 - k / 0.9);
      switch (this.gesture.type) {
        case 'nod': g.pitch = Math.sin(k * 14) * 0.1 * env; break;
        case 'bounce': g.chest = Math.abs(Math.sin(k * 12)) * -0.06 * env; g.pitch = Math.sin(k * 12) * 0.05 * env; break;
        case 'wink': g.wink = k < 0.4 ? Math.sin((k / 0.4) * Math.PI) : 0; g.roll = 0.06 * env; break;
        case 'jolt': g.pitch = -0.14 * Math.exp(-k * 5); g.chest = -0.05 * Math.exp(-k * 5); break;
        case 'shake': g.yaw = Math.sin(k * 16) * 0.12 * env; break;
        case 'lookaway': g.yaw = 0.15 * env; break;
      }
      if (k > 1.2) this.gesture = null;
    }

    // Bouche : base de l'humeur + visèmes pendant qu'elle « parle ».
    if (this.speaking && t > this.nextViseme) {
      this.viseme = VISEMES[Math.floor(Math.random() * VISEMES.length)];
      this.nextViseme = t + 0.08 + Math.random() * 0.1;
    }
    const mouthGoal = this.speaking ? 0.2 + 0.35 * Math.abs(Math.sin(t * 12)) : 0;
    this.mouthOpen = damp(this.mouthOpen, mouthGoal, 18);
    for (const v of VISEMES) set(v, (v === this.viseme ? this.mouthOpen : 0) + (v === 'aa' ? this.mouthBase : 0));

    // Paupières : clignements aléatoires + paupières mi-closes selon l'humeur + clin d'œil.
    if (this.blinkT < 0 && t > this.nextBlink) this.blinkT = 0;
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = Math.sin(Math.min(this.blinkT / 0.15, 1) * Math.PI);
      if (this.blinkT > 0.15) {
        this.blinkT = -1;
        this.nextBlink = t + 2 + Math.random() * 4;
      }
    }
    const happyish = (this.expWeights.happy ?? 0) > 0.5;
    set('blink', Math.max(happyish ? blink * 0.4 : blink, this.lids));
    set('blinkLeft', this.gesture?.side === 'blinkLeft' ? g.wink : 0);
    set('blinkRight', this.gesture?.side === 'blinkRight' ? g.wink : 0);

    // Regard : toi (souris), le panneau de chat quand tu écris, ou des coups d'œil à la vidéo.
    let attention = this.attention;
    if (attention === 'screen') {
      if (t > this.nextGlance) {
        this.glanceUntil = t + 2.5 + Math.random() * 3;
        this.nextGlance = this.glanceUntil + 4 + Math.random() * 6;
      }
      if (t > this.glanceUntil) attention = 'user';
    }
    const cam = this.camera.position;
    const look = {
      user: [cam.x + this.mouse.x * 0.5, cam.y + this.mouse.y * 0.3, cam.z, 0],
      chat: [cam.x + 1.2, cam.y - 0.25, cam.z, 0.22],
      screen: [-2.5, cam.y - 0.1, 0.6, -0.35],
    }[attention];
    this.lookTarget.position.set(look[0], look[1], look[2]);
    this.attYaw = damp(this.attYaw ?? 0, look[3], 3);

    // Corps : respiration, déhanché (jambes en compensation), buste en contre-mouvement, tête.
    const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    const f = this.flip ?? 1; // rotations X et Z inversées en VRM 0.x
    const p = this.pose;
    this.swayPhase = (this.swayPhase ?? 0) + dt * 0.8 * p.speed;
    this.breathPhase = (this.breathPhase ?? 0) + dt * 1.6 * p.breath;
    const breath = Math.sin(this.breathPhase);
    const sway = Math.sin(this.swayPhase) * p.sway;
    // Bassin qui ondule au rythme, buste et tête qui partent en arrière, tremblements à l'orgasme.
    const thrust = stroke * 0.07 * intensity;
    const tremble = Math.sin(t * 45) * 0.015 * C;
    bone('hips')?.rotation.set(f * thrust, sway * 0.05, f * (sway * 0.06 + tremble));
    bone('leftUpperLeg')?.rotation.set(-f * thrust, 0, -f * sway * 0.06);
    bone('rightUpperLeg')?.rotation.set(-f * thrust, 0, -f * sway * 0.06);
    bone('spine')?.rotation.set(f * (p.lean * 0.5 - 0.04 * intensity), Math.sin(t * 0.4) * 0.03, -f * sway * 0.045);
    bone('chest')?.rotation.set(
      f * (breath * 0.015 * p.breath + p.lean * 0.5 + g.chest - 0.05 * intensity - 0.08 * C + tremble),
      0,
      -f * sway * 0.02,
    );
    bone('neck')?.rotation.set(0, this.attYaw * 0.4, f * Math.sin(t * 0.7) * 0.02);
    bone('head')?.rotation.set(
      f * (0.03 + p.pitch + g.pitch - 0.08 * intensity - 0.2 * C),
      p.yaw + g.yaw + this.attYaw * 0.6,
      f * (0.07 + p.tilt + g.roll + Math.sin(t * 0.5) * 0.025),
    );

    // Mains : animation calculée, sauf si une animation .vmd a pris le relais.
    const motion = this.motion;
    const handsOn = act.w > 0.001 && !motion.on && motion.w < 0.001;
    if (handsOn) this.animateHands(stroke, intensity, C);
    else if (this.handsActive) this.restPose();
    this.handsActive = handsOn;

    // Animation .vmd par-dessus la posture calculée.
    const pmx = vrm.isPMX ? vrm : null;
    motion.w = damp(motion.w, motion.on && (motion.player || pmx?.action) ? 1 : 0, 3);
    if (pmx) {
      if (pmx.action) {
        pmx.action.setEffectiveWeight(motion.w);
        pmx.mixer.timeScale = motion.rate * (1 + C);
        if (!motion.on && motion.w <= 0.001) {
          pmx.stopVMD();
          this.restPose();
        }
      }
    } else if (motion.player && motion.w > 0.001) {
      motion.t += dt * motion.rate * (1 + C);
      const morphs = motion.player.apply(motion.t, motion.w);
      for (const [name, v] of Object.entries(morphs)) set(name, Math.max(em?.getValue(name) ?? 0, v * motion.w));
    } else if (motion.player && !motion.on && motion.w <= 0.001 && motion.wasOn) {
      motion.player.reset();
      this.restPose();
    }
    motion.wasOn = motion.w > 0.001;

    vrm.update(dt);
  }

  /**
   * Mains placées par cinématique inverse : main droite entre les cuisses (va-et-vient),
   * main gauche sur la poitrine (petits cercles). Fondu avec la pose de repos selon act.w.
   */
  animateHands(stroke, intensity, C) {
    const vrm = this.vrm;
    const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    const lUpLeg = bone('leftUpperLeg');
    const rUpLeg = bone('rightUpperLeg');
    const chest = bone('upperChest') ?? bone('chest');
    if (!lUpLeg || !rUpLeg || !chest || !this.restQ) return;

    // Le modèle regarde vers +Z ; sa droite est en -X.
    vrm.scene.updateMatrixWorld(true);
    const crotch = lUpLeg.getWorldPosition(new THREE.Vector3()).add(rUpLeg.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const scale = crotch.y / 0.85; // proportions du modèle
    const speed = 1 + C;
    crotch.add(new THREE.Vector3(0, (-0.06 + stroke * 0.035 * speed) * scale, (0.09 + Math.cos(this.act.phase) * 0.015) * scale));
    // Poitrine : un peu au-dessus de l'os du buste (entre lui et le cou), côté gauche, en avant.
    const chestPos = chest.getWorldPosition(new THREE.Vector3());
    const neckY = bone('neck')?.getWorldPosition(new THREE.Vector3()).y ?? chestPos.y + 0.2;
    const breast = chestPos.add(
      new THREE.Vector3(
        0.08 * scale,
        (neckY - chestPos.y) * 0.25 + Math.sin(this.act.phase * 0.5) * 0.015 * scale,
        (0.15 + Math.cos(this.act.phase * 0.5) * 0.01) * scale,
      ),
    );

    this.solveArm('right', crotch, new THREE.Vector3(-0.5, -0.2, -0.3));
    this.solveArm('left', breast, new THREE.Vector3(0.5, -0.4, -0.2));
  }

  /** IK analytique à deux os (bras + avant-bras), pôle = direction vers laquelle pointe le coude. */
  solveArm(side, target, poleOffset) {
    const bone = (n) => this.vrm.humanoid.getNormalizedBoneNode(n);
    const up = bone(`${side}UpperArm`);
    const lo = bone(`${side}LowerArm`);
    const hand = bone(`${side}Hand`);
    if (!up || !lo || !hand) return;
    const w = this.act.w;
    const restUp = this.restQ[`${side}UpperArm`];
    const restLo = this.restQ[`${side}LowerArm`];

    up.quaternion.copy(restUp);
    lo.quaternion.copy(restLo);
    up.updateMatrixWorld(true);
    const S = up.getWorldPosition(new THREE.Vector3());
    const E = lo.getWorldPosition(new THREE.Vector3());
    const W = hand.getWorldPosition(new THREE.Vector3());
    const a = S.distanceTo(E);
    const b = E.distanceTo(W);
    const toT = target.clone().sub(S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const pole = S.clone().add(poleOffset).sub(S);
    pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = S.clone()
      .add(dir.clone().multiplyScalar(a * cosA))
      .add(pole.multiplyScalar(a * Math.sqrt(1 - cosA * cosA)));

    rotateBoneToward(up, E, elbow, S);
    up.updateMatrixWorld(true);
    rotateBoneToward(lo, hand.getWorldPosition(new THREE.Vector3()), target, lo.getWorldPosition(new THREE.Vector3()));

    // Fondu avec la pose de repos.
    up.quaternion.copy(restUp.clone().slerp(up.quaternion, w));
    lo.quaternion.copy(restLo.clone().slerp(lo.quaternion, w));
  }

  /**
   * Pendant une animation .vmd (accroupie, allongée...), la caméra suit le bassin pour garder le corps
   * dans le cadre ; elle revient au cadrage normal ensuite. L'orbite choisie à la souris est conservée.
   */
  followBody(dt) {
    if (!this.baseTarget) return;
    const w = this.motion.w;
    const hips = this.vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(new THREE.Vector3());
    const goal = this.baseTarget.clone();
    goal.y += (hips.y - this.hipsRestWorld.y) * w;
    goal.z += (hips.z - this.hipsRestWorld.z) * w;
    const delta = goal.sub(this.controls.target).multiplyScalar(1 - Math.exp(-4 * dt));
    this.controls.target.add(delta);
    this.camera.position.add(delta);
  }

  animateAmbiance(t, dt) {
    if (this.ambiance.flicker) {
      // Lumière de bougie : petites variations irrégulières.
      const f = 1 + 0.06 * Math.sin(t * 7.3) + 0.04 * Math.sin(t * 13.1 + 1.3) + 0.03 * Math.sin(t * 23.7);
      this.lights.key.intensity = this.lights.key.baseIntensity * f;
      this.lights.rimA.intensity = this.lights.rimA.baseIntensity * (2 - f);
    }
    if (this.particles.visible) {
      const pos = this.particles.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * (0.04 + (i % 7) * 0.01);
        if (y > 2.6) y = -0.1;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(t * 0.5 + i) * dt * 0.02);
      }
      pos.needsUpdate = true;
    }
  }
}

/** Bokeh flottant : petits points lumineux flous autour de l'avatar. */
function makeParticles(count = 140) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions.set([(Math.random() - 0.5) * 4, Math.random() * 2.6, -1.8 + Math.random() * 2], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);

  const material = new THREE.PointsMaterial({
    size: 0.07,
    map: new THREE.CanvasTexture(c),
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/**
 * Inclinaison des bras au repos (radians sous l'horizontale) : 0 pour un VRM en T, ~0.6 pour un MMD en A.
 * Mesurée avant toute animation, à partir de la position épaule → coude.
 */
function measureArmRest(vrm) {
  const out = {};
  vrm.scene.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const up = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
    const lo = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
    if (!up || !lo) continue;
    const a = up.getWorldPosition(new THREE.Vector3());
    const b = lo.getWorldPosition(new THREE.Vector3());
    out[side] = Math.max(0, Math.atan2(a.y - b.y, Math.abs(b.x - a.x)));
  }
  return out;
}

/** Tourne un os pour que le point `from` (porté par l'os, autour de `pivot`) vise `to`. */
function rotateBoneToward(bone, from, to, pivot) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    from.clone().sub(pivot).normalize(),
    to.clone().sub(pivot).normalize(),
  );
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
}

/** Nom lisible d'un matériau VRoid / Unity : retire « (Instance) », « (Outline) », préfixes N00_000_... */
function partName(raw = '') {
  return raw
    .replace(/\s*\((Instance|Outline|Clone)\)/gi, '')
    .replace(/_?Outline$/i, '')
    .replace(/^N\d+_\d+_\d+_/, '')
    .trim();
}

/** Métadonnées et permissions d'usage déclarées par l'auteur du modèle (VRM 0.x et 1.0). */
function readMeta(vrm) {
  const m = vrm.meta ?? {};
  if (m.metaVersion === 'pmx') {
    // Le format PMX ne contient pas de permissions : elles sont dans le readme fourni avec le modèle.
    return { version: 'PMX (MMD)', title: m.name, author: '', license: 'voir le readme du modèle', sexualUse: null };
  }
  if (m.metaVersion === '1') {
    return {
      version: '1.0',
      title: m.name,
      author: (m.authors ?? []).join(', '),
      license: m.licenseUrl,
      sexualUse: m.allowExcessivelySexualUsage === true,
    };
  }
  return {
    version: '0.x',
    title: m.title,
    author: m.author,
    license: m.otherLicenseUrl || m.licenseName,
    sexualUse: m.sexualUssageName === 'Allow', // sic : orthographe de la spec VRM 0.x
  };
}
