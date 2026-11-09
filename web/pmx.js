import * as THREE from 'three';
import { MMDLoader, VMDLoader, buildAnimation } from '@moeru/three-mmd';
import { MMDSpringBonePlugin } from '@moeru/three-mmd-physics-springbone';

/**
 * Modèles MMD (.pmx) : chargés avec @moeru/three-mmd (matériaux toon d'origine, IK et liaisons MMD,
 * physique des cheveux/poitrine via spring bones), puis présentés à l'avatar avec la même interface
 * qu'un VRM (os humanoïdes, expressions, update). Les animations .vmd s'y jouent nativement.
 *
 * Le modèle doit rester dans son dossier (avec ses textures) sous models/.
 */

const MMD_SCALE = 0.08; // 1 unité MMD ≈ 8 cm

/** Os humanoïdes (noms VRM) → noms d'os MMD standards (le premier trouvé est utilisé). */
const BONES = {
  hips: ['センター'],
  spine: ['上半身'],
  chest: ['上半身2'],
  neck: ['首'],
  head: ['頭'],
};
const FINGERS = [
  ['ThumbMetacarpal', '親指０'], ['ThumbProximal', '親指１'], ['ThumbDistal', '親指２'],
  ['IndexProximal', '人指１'], ['IndexIntermediate', '人指２'], ['IndexDistal', '人指３'],
  ['MiddleProximal', '中指１'], ['MiddleIntermediate', '中指２'], ['MiddleDistal', '中指３'],
  ['RingProximal', '薬指１'], ['RingIntermediate', '薬指２'], ['RingDistal', '薬指３'],
  ['LittleProximal', '小指１'], ['LittleIntermediate', '小指２'], ['LittleDistal', '小指３'],
];
for (const [side, j] of [['left', '左'], ['right', '右']]) {
  Object.assign(BONES, {
    [`${side}Shoulder`]: [`${j}肩`],
    [`${side}UpperArm`]: [`${j}腕`],
    [`${side}LowerArm`]: [`${j}ひじ`],
    [`${side}Hand`]: [`${j}手首`],
    [`${side}UpperLeg`]: [`${j}足`],
    [`${side}LowerLeg`]: [`${j}ひざ`],
    [`${side}Foot`]: [`${j}足首`],
  });
  for (const [vrm, mmd] of FINGERS) BONES[`${side}${vrm}`] = [`${j}${mmd}`];
}

/** Expressions (noms VRM) → morphs MMD courants. */
const EXPRESSIONS = {
  happy: ['笑い', 'にこり', 'にっこり', '笑顔'],
  angry: ['怒り', '真面目'],
  sad: ['困る', '悲しい', '悲しむ'],
  relaxed: ['なごみ', 'にやり', 'はぅ'],
  surprised: ['びっくり', '驚き', '瞳小'],
  blink: ['まばたき', 'まばたき２'],
  blinkLeft: ['ウィンク', 'ウィンク２'],
  blinkRight: ['ウィンク右', 'ｳｨﾝｸ２右', 'ウィンク２右'],
  aa: ['あ', 'あ２'],
  ih: ['い'],
  ou: ['う'],
  ee: ['え'],
  oh: ['お'],
  heartEyes: ['ハート目', 'はぁと', 'ハート'],
  tears: ['涙'],
};

/**
 * Charge le modèle. Une texture introuvable rendrait le matériau transparent (donc invisible) :
 * on la retire pour garder la couleur unie du matériau, et on signale les fichiers manquants.
 * @param onMissing appelé avec la liste des textures introuvables (une fois tout chargé)
 */
export async function loadPMX(url, onMissing = () => {}) {
  const missing = new Set();
  let rig = null;
  const manager = new THREE.LoadingManager();
  manager.onError = (u) => missing.add(decodeURIComponent(u).split(/[\\/]/).pop());
  manager.onLoad = () => {
    if (!rig || !missing.size) return;
    rig.removeBrokenTextures();
    onMissing([...missing]);
  };
  const mmd = await new MMDLoader(manager).register(MMDSpringBonePlugin).loadAsync(url);
  rig = new PmxRig(mmd);
  return rig;
}

class PmxRig {
  constructor(mmd) {
    this.isPMX = true;
    this.mmd = mmd;
    mmd.setScalar(MMD_SCALE);
    const mesh = mmd.mesh;
    this.scene = mesh;

    const byName = new Map(mesh.skeleton.bones.map((b) => [b.name, b]));
    const nodes = {};
    for (const [vrm, names] of Object.entries(BONES)) nodes[vrm] = names.map((n) => byName.get(n)).find(Boolean) ?? null;
    nodes.hips ??= byName.get('下半身') ?? null;
    if (!nodes.hips || !nodes.head) {
      throw new Error("Ce modèle n'a pas les os MMD standards (センター, 頭...) : il ne peut pas être animé.");
    }
    this.humanoid = { getNormalizedBoneNode: (name) => nodes[name] ?? null };

    // Expressions : noms VRM traduits en morphs, et morphs bruts (ex. 照れ pour le rougissement).
    const dict = mesh.morphTargetDictionary ?? {};
    const influences = mesh.morphTargetInfluences ?? [];
    const indexOf = (name) => dict[name] ?? (EXPRESSIONS[name] ?? []).map((n) => dict[n]).find((i) => i !== undefined);
    this.expressionManager = {
      expressions: Object.keys(dict).map((expressionName) => ({ expressionName })),
      getExpression: (name) => (indexOf(name) !== undefined ? { name } : null),
      setValue: (name, v) => {
        const i = indexOf(name);
        if (i !== undefined) influences[i] = v;
      },
      getValue: (name) => {
        const i = indexOf(name);
        return i === undefined ? 0 : influences[i];
      },
    };
    this.lookAt = null;

    const header = mmd.pmx?.header ?? {};
    this.meta = {
      metaVersion: 'pmx',
      name: header.modelName || header.englishModelName || '',
      comment: header.comment || '',
    };

    this.mixer = new THREE.AnimationMixer(mesh);
    this.action = null;
    this.actionUrl = '';
  }

  /** Retire des matériaux les textures qui n'ont pas pu être chargées (image absente). */
  removeBrokenTextures() {
    for (const m of [this.mmd.mesh.material].flat()) {
      for (const key of Object.keys(m)) {
        const t = m[key];
        if (t?.isTexture && !t.image) {
          m[key] = null;
          m.needsUpdate = true;
        }
      }
    }
  }

  /** Joue un .vmd nativement (IK et liaisons MMD comprises). */
  async playVMD(url) {
    if (this.actionUrl === url && this.action) return this.action;
    this.stopVMD();
    const vmd = await new VMDLoader().loadAsync(url);
    this.action = this.mixer.clipAction(buildAnimation(vmd, this.mmd.mesh));
    this.action.play();
    this.actionUrl = url;
    return this.action;
  }

  stopVMD() {
    if (!this.action) return;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mmd.mesh);
    this.action = null;
    this.actionUrl = '';
    this.mmd.mesh.skeleton.pose(); // retour à la pose de repos
  }

  update(dt) {
    if (this.action) this.mmd.updateWithMixer(dt, this.mixer);
    else this.mmd.update(dt);
  }

  dispose() {
    this.stopVMD();
    this.mmd.dispose();
  }
}
