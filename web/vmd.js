/**
 * Lecture des fichiers .vmd (Vocaloid Motion Data, MikuMikuDance) et échantillonnage.
 *
 * Format : en-tête 30 o, nom du modèle 20 o, puis
 *   - images clés d'os  : nom (15 o, Shift-JIS), image (u32), position (3 f32), rotation (quaternion 4 f32), interpolation (64 o)
 *   - images clés de morph : nom (15 o), image (u32), poids (f32)
 * Repère MMD : main gauche, Y vers le haut ; 1 unité ≈ 8 cm.
 */

const FPS = 30;
const sjis = new TextDecoder('shift_jis');
const readName = (bytes) => {
  const end = bytes.indexOf(0);
  return sjis.decode(end === -1 ? bytes : bytes.subarray(0, end));
};

export function parseVMD(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const header = readName(u8.subarray(0, 30));
  if (!header.startsWith('Vocaloid Motion Data')) throw new Error("Ce fichier n'est pas une animation .vmd.");
  let o = 50;
  const bones = new Map();
  const boneCount = view.getUint32(o, true);
  o += 4;
  for (let i = 0; i < boneCount; i++, o += 111) {
    const name = readName(u8.subarray(o, o + 15));
    const key = {
      frame: view.getUint32(o + 15, true),
      pos: [view.getFloat32(o + 19, true), view.getFloat32(o + 23, true), view.getFloat32(o + 27, true)],
      rot: [view.getFloat32(o + 31, true), view.getFloat32(o + 35, true), view.getFloat32(o + 39, true), view.getFloat32(o + 43, true)],
      // Courbes de Bézier pour X, Y, Z et la rotation : x1 à +47, y1 à +51, x2 à +55, y2 à +59 (0..127).
      curves: [0, 1, 2, 3].map((c) => [u8[o + 47 + c], u8[o + 51 + c], u8[o + 55 + c], u8[o + 59 + c]].map((v) => v / 127)),
    };
    if (!bones.has(name)) bones.set(name, []);
    bones.get(name).push(key);
  }
  const morphs = new Map();
  if (o + 4 <= buffer.byteLength) {
    const morphCount = view.getUint32(o, true);
    o += 4;
    for (let i = 0; i < morphCount && o + 23 <= buffer.byteLength; i++, o += 23) {
      const name = readName(u8.subarray(o, o + 15));
      if (!morphs.has(name)) morphs.set(name, []);
      morphs.get(name).push({ frame: view.getUint32(o + 15, true), weight: view.getFloat32(o + 19, true) });
    }
  }
  let last = 0;
  for (const keys of [...bones.values(), ...morphs.values()]) {
    keys.sort((a, b) => a.frame - b.frame);
    last = Math.max(last, keys.at(-1).frame);
  }
  return { model: readName(u8.subarray(30, 50)), bones, morphs, duration: Math.max(last, 1) / FPS };
}

/** Courbe de Bézier cubique MMD : pour une progression x dans [0,1], renvoie y. */
function bezier([x1, y1, x2, y2], x) {
  if (x1 === y1 && x2 === y2) return x; // linéaire
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 15; i++) {
    const bx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (Math.abs(bx - x) < 1e-4) break;
    if (bx < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

function segment(keys, frame) {
  if (frame <= keys[0].frame) return [keys[0], keys[0], 0];
  if (frame >= keys.at(-1).frame) return [keys.at(-1), keys.at(-1), 0];
  let i = 1;
  while (keys[i].frame < frame) i++;
  const a = keys[i - 1];
  const b = keys[i];
  return [a, b, (frame - a.frame) / (b.frame - a.frame)];
}

/** Position (repère MMD) et rotation d'un os à l'instant t (secondes). null si l'os n'est pas animé. */
export function sampleBone(clip, name, t, outPos, outQuat) {
  const keys = clip.bones.get(name);
  if (!keys) return false;
  const [a, b, x] = segment(keys, t * FPS);
  for (let c = 0; c < 3; c++) {
    const k = bezier(b.curves[c], x);
    outPos[c] = a.pos[c] + (b.pos[c] - a.pos[c]) * k;
  }
  outQuat.slerpQuaternions(
    outQuat.clone().set(...a.rot),
    outQuat.clone().set(...b.rot),
    bezier(b.curves[3], x),
  );
  return true;
}

export function sampleMorph(clip, name, t) {
  const keys = clip.morphs.get(name);
  if (!keys) return null;
  const [a, b, x] = segment(keys, t * FPS);
  return a.weight + (b.weight - a.weight) * x;
}
