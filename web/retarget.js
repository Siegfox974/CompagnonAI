import * as THREE from 'three';
import { sampleBone, sampleMorph } from './vmd.js';

/**
 * Applique une animation MMD (.vmd) au squelette normalisé d'un VRM.
 *
 * - Les os MMD et les os normalisés VRM ont tous deux des axes locaux alignés sur le modèle au repos :
 *   une rotation MMD se transpose donc directement, après conversion de repère (MMD = main gauche).
 * - Les bras MMD sont au repos en « A » (≈35° vers le bas), ceux du VRM en « T » : on compense à l'épaule
 *   et on transpose les rotations des os enfants (avant-bras, main, doigts) dans ce repère incliné.
 * - Les jambes MMD sont pilotées par IK (足ＩＫ) : on recalcule cuisse + genou pour placer la cheville.
 * - L'os racine (全ての親) : on garde son inclinaison (se coucher, se pencher) et sa hauteur, mais pas
 *   sa rotation horizontale ni son déplacement au sol, qui placent le personnage dans la scène MMD
 *   d'origine — ici elle doit rester face à l'utilisateur.
 */

const A_POSE_ANGLE = THREE.MathUtils.degToRad(35);
const MMD_HIP_HEIGHT = 10.5; // hauteur approximative de l'articulation de hanche d'un modèle MMD standard (unités MMD)

const FINGERS = [
  ['親指０', 'ThumbMetacarpal'],
  ['親指１', 'ThumbProximal'],
  ['親指２', 'ThumbDistal'],
  ['人指１', 'IndexProximal'],
  ['人指２', 'IndexIntermediate'],
  ['人指３', 'IndexDistal'],
  ['中指１', 'MiddleProximal'],
  ['中指２', 'MiddleIntermediate'],
  ['中指３', 'MiddleDistal'],
  ['薬指１', 'RingProximal'],
  ['薬指２', 'RingIntermediate'],
  ['薬指３', 'RingDistal'],
  ['小指１', 'LittleProximal'],
  ['小指２', 'LittleIntermediate'],
  ['小指３', 'LittleDistal'],
];

/** Morphs MMD courants → expressions VRM. */
const MORPHS = {
  まばたき: 'blink',
  ウィンク: 'blinkLeft',
  ウィンク右: 'blinkRight',
  ウィンク２: 'blinkLeft',
  ｳｨﾝｸ２右: 'blinkRight',
  あ: 'aa',
  い: 'ih',
  う: 'ou',
  え: 'ee',
  お: 'oh',
  笑い: 'happy',
  にこり: 'happy',
  怒り: 'angry',
  困る: 'sad',
};

const SIDES = [
  ['left', '左'],
  ['right', '右'],
];

/** Os touchés par l'animation (remis à zéro quand elle s'arrête). */
export const MOTION_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  ...SIDES.flatMap(([s]) => [
    `${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`,
    `${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`,
    ...FINGERS.map(([, v]) => `${s}${v}`),
  ]),
];

export class MotionPlayer {
  /**
   * @param vrm modèle chargé
   * @param clip résultat de parseVMD
   * @param flip -1 pour un VRM 0.x (squelette tourné vers -Z), 1 sinon
   * @param hipsRest position de repos du bassin (repère du squelette normalisé)
   */
  constructor(vrm, clip, flip, hipsRest) {
    this.vrm = vrm;
    this.clip = clip;
    this.flip = flip;
    this.hipsRest = hipsRest.clone();
    const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    this.bone = bone;
    this.rigRoot = bone('hips').parent;

    // Échelle MMD → mètres d'après la hauteur de hanche du modèle.
    const hipY = hipsRest.y + (bone('leftUpperLeg')?.position.y ?? -0.08);
    this.scale = hipY / MMD_HIP_HEIGHT;

    // Position de repos des chevilles dans le repère du squelette (rotations de repos = identité).
    this.footRest = {};
    for (const [s] of SIDES) {
      const p = hipsRest.clone();
      for (const n of [`${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`]) if (bone(n)) p.add(bone(n).position);
      this.footRest[s] = p;
    }
    // Inclinaison des bras : rotation qui amène la direction « T » sur la direction « A ».
    this.aPose = {
      left: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -A_POSE_ANGLE * flip),
      right: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), A_POSE_ANGLE * flip),
    };
    this.useLegIK = clip.bones.has('左足ＩＫ') || clip.bones.has('右足ＩＫ');
    this.cache = new Map();
  }

  // ----- conversions de repère -----
  /** Quaternion MMD → repère du squelette normalisé. */
  toRig(q) {
    // MMD (main gauche) → three.js : (-x, -y, z, w) ; VRM 0.x : demi-tour autour de Y en plus.
    return this.flip === 1 ? q.set(-q.x, -q.y, q.z, q.w) : q.set(q.x, -q.y, -q.z, q.w);
  }

  /** Position MMD → repère du squelette normalisé (mètres). */
  posToRig(p) {
    const s = this.scale;
    return this.flip === 1 ? new THREE.Vector3(p[0] * s, p[1] * s, -p[2] * s) : new THREE.Vector3(-p[0] * s, p[1] * s, p[2] * s);
  }

  /** Échantillonne un os MMD (mis en cache pour l'image courante). */
  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const pos = [0, 0, 0];
    const q = new THREE.Quaternion();
    const r = sampleBone(this.clip, name, this.t, pos, q) ? { pos, q: this.toRig(q) } : null;
    this.cache.set(name, r);
    return r;
  }

  q(name) {
    return this.get(name)?.q.clone() ?? new THREE.Quaternion();
  }

  /** Produit des rotations de plusieurs os MMD (parent → enfant). */
  chain(...names) {
    return names.reduce((acc, n) => acc.multiply(this.q(n)), new THREE.Quaternion());
  }

  /**
   * Applique l'animation à l'instant t (s, en boucle) avec un poids w (fondu avec la pose actuelle).
   * Renvoie les poids d'expressions issus des morphs du fichier.
   */
  apply(t, w) {
    this.t = t % this.clip.duration;
    this.cache.clear();
    // Os racine : inclinaison seule (rotation autour de Y retirée) + hauteur.
    const root = this.get('全ての親');
    this.rootSwing = root ? withoutYaw(root.q) : new THREE.Quaternion();
    this.rootLift = new THREE.Vector3(0, root ? root.pos[1] * this.scale : 0, 0);
    const bone = this.bone;
    const set = (name, q) => bone(name)?.quaternion.slerp(q, w);

    // Bassin : centre + groove + taille + bas du corps. Buste : compense le bas du corps.
    const lower = this.q('下半身');
    set('hips', this.rootSwing.clone().multiply(this.chain('センター', 'グルーブ', '腰')).multiply(lower));
    const off = [0, 0, 0];
    for (const n of ['センター', 'グルーブ']) {
      const b = this.get(n);
      if (b) for (let i = 0; i < 3; i++) off[i] += b.pos[i];
    }
    const hipsPos = this.hipsRest.clone().add(this.posToRig(off)).applyQuaternion(this.rootSwing).add(this.rootLift);
    bone('hips')?.position.lerpVectors(bone('hips').position.clone(), hipsPos, w);
    set('spine', lower.clone().invert().multiply(this.q('上半身')));
    set('chest', this.q('上半身2'));
    set('neck', this.q('首'));
    set('head', this.q('頭'));

    // Bras : épaule, bras (+ torsion), avant-bras (+ torsion), main, doigts — avec correction A → T.
    for (const [s, j] of SIDES) {
      const a = this.aPose[s];
      const ai = a.clone().invert();
      const conj = (q) => ai.clone().multiply(q).multiply(a);
      set(`${s}Shoulder`, this.q(`${j}肩`));
      set(`${s}UpperArm`, this.chain(`${j}腕`, `${j}腕捩`).multiply(a));
      set(`${s}LowerArm`, conj(this.chain(`${j}ひじ`, `${j}手捩`)));
      set(`${s}Hand`, conj(this.q(`${j}手首`)));
      for (const [mmd, vrm] of FINGERS) if (this.get(`${j}${mmd}`)) set(`${s}${vrm}`, conj(this.q(`${j}${mmd}`)));
    }

    // Jambes : IK (placer la cheville) si le fichier en contient, sinon rotations directes.
    if (this.useLegIK) {
      this.rigRoot.updateMatrixWorld(true);
      for (const [s, j] of SIDES) this.solveLeg(s, j, w);
    } else {
      for (const [s, j] of SIDES) {
        set(`${s}UpperLeg`, this.q(`${j}足`));
        set(`${s}LowerLeg`, this.q(`${j}ひざ`));
        set(`${s}Foot`, this.q(`${j}足首`));
      }
    }

    // Expressions.
    const morphs = {};
    for (const [mmd, vrm] of Object.entries(MORPHS)) {
      const v = sampleMorph(this.clip, mmd, this.t);
      if (v !== null) morphs[vrm] = Math.max(morphs[vrm] ?? 0, v);
    }
    return morphs;
  }

  solveLeg(s, j, w) {
    const up = this.bone(`${s}UpperLeg`);
    const lo = this.bone(`${s}LowerLeg`);
    const foot = this.bone(`${s}Foot`);
    if (!up || !lo || !foot) return;

    // Cible : cheville au repos + déplacement de l'IK (et de ses parents).
    const off = [0, 0, 0];
    for (const n of [`${j}足IK親`, `${j}足ＩＫ`]) {
      const b = this.get(n);
      if (b) for (let i = 0; i < 3; i++) off[i] += b.pos[i];
    }
    const target = this.rigRoot.localToWorld(
      this.footRest[s].clone().add(this.posToRig(off)).applyQuaternion(this.rootSwing).add(this.rootLift),
    );

    const startUp = up.quaternion.clone();
    const startLo = lo.quaternion.clone();
    up.quaternion.identity();
    lo.quaternion.identity();
    up.updateMatrixWorld(true);
    // Le genou se plie vers l'avant du personnage (+Z dans la scène).
    solveTwoBone(up, lo, foot, target, new THREE.Vector3(0, 0, 1));
    up.quaternion.copy(startUp.slerp(up.quaternion, w));
    lo.quaternion.copy(startLo.slerp(lo.quaternion, w));

    // Orientation du pied : celle de l'os IK, exprimée dans le repère du tibia.
    lo.updateMatrixWorld(true);
    const ik = this.get(`${j}足ＩＫ`);
    if (ik) {
      const rigQ = this.rigRoot.getWorldQuaternion(new THREE.Quaternion());
      const worldQ = rigQ.multiply(this.rootSwing).multiply(this.q(`${j}足IK親`)).multiply(ik.q.clone());
      const parentQ = lo.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.slerp(parentQ.invert().multiply(worldQ), w);
    }
  }

  /** Remet à zéro les os animés (fin de l'animation). */
  reset() {
    for (const n of MOTION_BONES) this.bone(n)?.quaternion.identity();
    this.bone('hips')?.position.copy(this.hipsRest);
  }
}

/**
 * Retire d'une rotation son cap (rotation autour de l'axe vertical Y, appliquée en dernier dans la scène) :
 * q = cap × inclinaison  →  inclinaison = cap⁻¹ × q.
 */
function withoutYaw(q) {
  const yaw = new THREE.Quaternion(0, q.y, 0, q.w);
  if (yaw.lengthSq() < 1e-8) return q.clone();
  return yaw.normalize().invert().multiply(q);
}

/** IK analytique à deux os en coordonnées monde ; `poleDir` = direction vers laquelle plier l'articulation. */
export function solveTwoBone(up, lo, end, target, poleDir) {
  const S = up.getWorldPosition(new THREE.Vector3());
  const E = lo.getWorldPosition(new THREE.Vector3());
  const W = end.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E);
  const b = E.distanceTo(W);
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const pole = poleDir.clone().sub(dir.clone().multiplyScalar(poleDir.dot(dir))).normalize();
  const joint = S.clone()
    .add(dir.clone().multiplyScalar(a * cosA))
    .add(pole.multiplyScalar(a * Math.sqrt(1 - cosA * cosA)));
  rotateToward(up, E, joint, S);
  up.updateMatrixWorld(true);
  rotateToward(lo, end.getWorldPosition(new THREE.Vector3()), target, lo.getWorldPosition(new THREE.Vector3()));
}

function rotateToward(bone, from, to, pivot) {
  const q = new THREE.Quaternion().setFromUnitVectors(from.clone().sub(pivot).normalize(), to.clone().sub(pivot).normalize());
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
}
