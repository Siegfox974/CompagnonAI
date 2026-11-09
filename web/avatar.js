import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const MOOD_EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
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
    this.moodWeights = Object.fromEntries(MOOD_EXPRESSIONS.map((e) => [e, 0]));
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
    const s = this.vrm.meta?.metaVersion === '0' ? -1 : 1;
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
    this.mood = MOOD_EXPRESSIONS.includes(name) ? name : 'neutral';
  }

  setSpeaking(on) {
    this.speaking = on;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.controls.update();
    this.animateAmbiance(t, dt);

    const vrm = this.vrm;
    if (vrm) {
      const em = vrm.expressionManager;

      // Émotion : transition douce vers l'expression demandée.
      for (const e of MOOD_EXPRESSIONS) {
        const goal = e === this.mood ? (this.speaking ? 0.7 : 1) : 0;
        this.moodWeights[e] = THREE.MathUtils.damp(this.moodWeights[e], goal, 6, dt);
        em?.setValue(e, this.moodWeights[e]);
      }

      // Bouche : alterne des visèmes pendant qu'elle « parle » (réponse en cours).
      if (this.speaking && t > this.nextViseme) {
        this.viseme = VISEMES[Math.floor(Math.random() * VISEMES.length)];
        this.nextViseme = t + 0.08 + Math.random() * 0.1;
      }
      const mouthGoal = this.speaking ? 0.2 + 0.35 * Math.abs(Math.sin(t * 12)) : 0;
      this.mouthOpen = THREE.MathUtils.damp(this.mouthOpen, mouthGoal, 18, dt);
      for (const v of VISEMES) em?.setValue(v, v === this.viseme ? this.mouthOpen : 0);

      // Clignements aléatoires.
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
      em?.setValue('blink', this.mood === 'happy' ? blink * 0.4 : blink);

      // Attitude : respiration, déhanché lent (les jambes compensent pour garder les pieds au sol),
      // buste en contre-mouvement, tête légèrement penchée.
      const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
      const breath = Math.sin(t * 1.6);
      const sway = Math.sin(t * 0.8);
      bone('hips')?.rotation.set(0, sway * 0.05, sway * 0.06);
      bone('leftUpperLeg')?.rotation.set(0, 0, -sway * 0.06);
      bone('rightUpperLeg')?.rotation.set(0, 0, -sway * 0.06);
      bone('spine')?.rotation.set(0, Math.sin(t * 0.4) * 0.03, -sway * 0.045);
      bone('chest')?.rotation.set(breath * 0.015, 0, -sway * 0.02);
      bone('neck')?.rotation.set(0, 0, Math.sin(t * 0.7) * 0.02);
      bone('head')?.rotation.set(0.03, 0, 0.07 + Math.sin(t * 0.5) * 0.025);

      // Regard : suit le curseur.
      this.lookTarget.position.set(
        this.camera.position.x + this.mouse.x * 0.5,
        this.camera.position.y + this.mouse.y * 0.3,
        this.camera.position.z,
      );

      vrm.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
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
