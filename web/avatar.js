import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

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

  setAmbiance(name) {
    const a = AMBIANCES[name] ?? AMBIANCES.neon;
    this.ambiance = a;
    const { hemi, key, rimA, rimB } = this.lights;
    hemi.color.set(a.hemi[0]);
    hemi.groundColor.set(a.hemi[1]);
    hemi.intensity = a.hemi[2];
    for (const [light, [color, intensity]] of [[key, a.key], [rimA, a.rimA], [rimB, a.rimB]]) {
      light.color.set(color);
      light.intensity = light.baseIntensity = intensity;
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
  async load(url) {
    const gltf = await this.loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("Ce fichier n'est pas un modèle VRM valide.");

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => (o.frustumCulled = false));

    this.vrm = vrm;
    // VRM 0.x : squelette retourné, les rotations autour de X et Z sont inversées.
    this.flip = vrm.meta?.metaVersion === '0' ? -1 : 1;
    this.blushNames = (vrm.expressionManager?.expressions ?? [])
      .map((e) => e.expressionName)
      .filter((n) => BLUSH_RE.test(n));
    this.scene.add(vrm.scene);
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
    bone('leftUpperArm')?.rotation.set(0, 0, -1.2 * s);
    bone('rightUpperArm')?.rotation.set(0, 0, 1.2 * s);
    bone('leftLowerArm')?.rotation.set(0, -0.25 * s, 0);
    bone('rightLowerArm')?.rotation.set(0, 0.25 * s, 0);
  }

  /** Cadre la caméra : haut du corps (centre) ou plan plus large (coin, par-dessus le site). */
  frame() {
    this.vrm.scene.updateMatrixWorld(true);
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    const corner = this.layout === 'corner';
    this.controls.target.set(0, corner ? y - 0.35 : y - 0.12, 0);
    this.camera.position.set(0, corner ? y - 0.3 : y - 0.1, corner ? 2.8 : 1.9);
    this.controls.update();
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
  setAttention(target) {
    this.attention = target;
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
    return [...parts].map(([name, mats]) => ({ name, visible: mats.some((m) => m.visible), mats }));
  }

  setPartVisible(name, visible) {
    for (const p of this.getParts()) if (p.name === name) p.mats.forEach((m) => (m.visible = visible));
  }

  setSpeaking(on) {
    this.speaking = on;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.controls.update();
    this.animateAmbiance(t, dt);

    if (this.vrm) this.animateBody(t, dt);
    this.renderer.render(this.scene, this.camera);
  }

  animateBody(t, dt) {
    const vrm = this.vrm;
    const em = vrm.expressionManager;
    const mood = MOODS[this.mood];
    const damp = (a, b, k = 5) => THREE.MathUtils.damp(a, b, k, dt);
    const set = (name, v) => em?.getExpression(name) && em.setValue(name, THREE.MathUtils.clamp(v, 0, 1));

    // Expressions : transition douce vers le mélange de l'humeur.
    for (const e of BASE_EXPRESSIONS) {
      const goal = (mood.exp[e] ?? 0) * (this.speaking ? 0.75 : 1);
      this.expWeights[e] = damp(this.expWeights[e] ?? 0, goal, 6);
      set(e, this.expWeights[e]);
    }
    this.mouthBase = damp(this.mouthBase, mood.mouth ?? 0);
    this.lids = damp(this.lids, mood.lids ?? 0);
    this.blush = damp(this.blush, mood.blush ?? 0, 2);
    for (const n of this.blushNames) set(n, this.blush);

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
    bone('hips')?.rotation.set(0, sway * 0.05, f * sway * 0.06);
    bone('leftUpperLeg')?.rotation.set(0, 0, -f * sway * 0.06);
    bone('rightUpperLeg')?.rotation.set(0, 0, -f * sway * 0.06);
    bone('spine')?.rotation.set(f * p.lean * 0.5, Math.sin(t * 0.4) * 0.03, -f * sway * 0.045);
    bone('chest')?.rotation.set(f * (breath * 0.015 * p.breath + p.lean * 0.5 + g.chest), 0, -f * sway * 0.02);
    bone('neck')?.rotation.set(0, this.attYaw * 0.4, f * Math.sin(t * 0.7) * 0.02);
    bone('head')?.rotation.set(
      f * (0.03 + p.pitch + g.pitch),
      p.yaw + g.yaw + this.attYaw * 0.6,
      f * (0.07 + p.tilt + g.roll + Math.sin(t * 0.5) * 0.025),
    );

    vrm.update(dt);
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
