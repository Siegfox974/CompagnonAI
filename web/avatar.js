import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const MOOD_EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** Scène three.js + avatar VRM avec émotions, clignements, respiration, regard et bouche. */
export class Avatar {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.4, 1.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.3, 0);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x443344, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 2);
    this.scene.add(key);

    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);
    this.mouse = new THREE.Vector2();
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    });

    this.vrm = null;
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

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Sur grand écran, décale la vue pour centrer l'avatar à gauche du panneau de chat (400 px).
    if (w > 800) this.camera.setViewOffset(w, h, 200, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
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
    bone('leftUpperArm')?.rotation.set(0, 0, -1.25);
    bone('rightUpperArm')?.rotation.set(0, 0, 1.25);
    bone('leftLowerArm')?.rotation.set(0, -0.2, 0);
    bone('rightLowerArm')?.rotation.set(0, 0.2, 0);
  }

  /** Cadre la caméra sur le haut du corps. */
  frame() {
    this.vrm.scene.updateMatrixWorld(true);
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : 1.4;
    this.controls.target.set(0, y - 0.12, 0);
    this.camera.position.set(0, y - 0.1, 1.9);
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

    const vrm = this.vrm;
    if (vrm) {
      const em = vrm.expressionManager;

      // Émotion : transition douce vers l'expression demandée.
      for (const e of MOOD_EXPRESSIONS) {
        const goal = e === this.mood ? (this.speaking ? 0.7 : 1) : 0;
        this.moodWeights[e] = THREE.MathUtils.damp(this.moodWeights[e], goal, 6, dt);
        em?.setValue(e, this.moodWeights[e]);
      }

      // Bouche : alterne des visèmes pendant la parole.
      if (this.speaking && t > this.nextViseme) {
        this.viseme = VISEMES[Math.floor(Math.random() * VISEMES.length)];
        this.nextViseme = t + 0.08 + Math.random() * 0.1;
      }
      const mouthGoal = this.speaking ? 0.3 + 0.5 * Math.abs(Math.sin(t * 14)) : 0;
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

      // Respiration et léger balancement.
      const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
      const breath = Math.sin(t * 1.6);
      bone('chest')?.rotation.set(breath * 0.015, 0, 0);
      bone('spine')?.rotation.set(0, Math.sin(t * 0.4) * 0.03, Math.sin(t * 0.5) * 0.015);
      bone('neck')?.rotation.set(0, 0, Math.sin(t * 0.7) * 0.02);

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
