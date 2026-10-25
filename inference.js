// inference.js — ONNX model + tiled inference + class-masked reconstruction.

let onnxSession = null;
const PATCH_SIZE = 128;
const STRIDE_FRAC = 0.75;
const N_CLASSES = 43;

async function loadModel(url = 'model.onnx') {
  if (onnxSession) return onnxSession;
  const buf = await fetch(url).then(r => r.arrayBuffer());
  onnxSession = await ort.InferenceSession.create(buf, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return onnxSession;
}

// Parse class_table.csv -> list of invalid class indices for a given modality
async function loadInvalidClasses() {
  const csv = await fetch('class_table.csv').then(r => r.text());
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(s => s.trim());
  const valIdx = header.indexOf('value');
  const ctIdx = header.indexOf('cta_valid');
  const mrIdx = header.indexOf('mra_valid');
  const invalidCt = [], invalidMr = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    const v = parseInt(cols[valIdx]);
    const ctv = cols[ctIdx].toLowerCase() === 'true';
    const mrv = cols[mrIdx].toLowerCase() === 'true';
    if (!ctv) invalidCt.push(v);
    if (!mrv) invalidMr.push(v);
  }
  return { ct: invalidCt, mr: invalidMr };
}

function tilePositions(L, P, S) {
  if (L <= P) return [0];
  const pos = [];
  for (let p = 0; p + P <= L; p += S) pos.push(p);
  if (pos[pos.length - 1] + P < L) pos.push(L - P);
  return pos;
}

const DIST_MAP = (() => {
  const P = PATCH_SIZE;
  const out = new Int32Array(P * P * P);
  for (let z = 0; z < P; z++)
    for (let y = 0; y < P; y++)
      for (let x = 0; x < P; x++) {
        out[z * P * P + y * P + x] = Math.min(
          z, P - 1 - z, y, P - 1 - y, x, P - 1 - x);
      }
  return out;
})();

// img: {data: Float32Array, shape: [D,H,W]}  (already normalized)
// invalidClasses: array of class indices to mask (e.g. [41, 42] for CT)
async function inferVolume(img, invalidClasses, onProgress) {
  const sess = await loadModel();
  const [D, H, W] = img.shape;
  const P = PATCH_SIZE;
  const S = Math.floor(P * STRIDE_FRAC);
  const PPP = P * P * P;
  const C = N_CLASSES;

  const invalidSet = new Set(invalidClasses || []);

  const Dz = Math.max(D, P), Hz = Math.max(H, P), Wz = Math.max(W, P);
  const padded = new Float32Array(Dz * Hz * Wz);
  for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        padded[z * Hz * Wz + y * Wz + x] = img.data[z * H * W + y * W + x];

  const zPos = tilePositions(Dz, P, S);
  const yPos = tilePositions(Hz, P, S);
  const xPos = tilePositions(Wz, P, S);
  const total = zPos.length * yPos.length * xPos.length;

  const predVol = new Uint8Array(Dz * Hz * Wz);
  const bestDist = new Int32Array(Dz * Hz * Wz).fill(-1);

  let done = 0;
  for (const z0 of zPos) {
    for (const y0 of yPos) {
      for (const x0 of xPos) {
        const patch = new Float32Array(PPP);
        for (let z = 0; z < P; z++)
          for (let y = 0; y < P; y++)
            for (let x = 0; x < P; x++)
              patch[z * P * P + y * P + x] =
                padded[(z0 + z) * Hz * Wz + (y0 + y) * Wz + (x0 + x)];

        const tensor = new ort.Tensor('float32', patch, [1, 1, P, P, P]);
        const out = await sess.run({ input: tensor });
        const logits = out.logits.data;

        for (let z = 0; z < P; z++) {
          for (let y = 0; y < P; y++) {
            for (let x = 0; x < P; x++) {
              const pi = z * P * P + y * P + x;
              const wi = (z0 + z) * Hz * Wz + (y0 + y) * Wz + (x0 + x);
              const d = DIST_MAP[pi];
              if (d > bestDist[wi]) {
                // ARGMAX with class masking
                let best = 0, bestV = -Infinity;
                for (let c = 0; c < C; c++) {
                  if (invalidSet.has(c)) continue;
                  const v = logits[c * PPP + pi];
                  if (v > bestV) { bestV = v; best = c; }
                }
                predVol[wi] = best;
                bestDist[wi] = d;
              }
            }
          }
        }

        done++;
        if (onProgress) onProgress(done, total);
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  const result = new Uint8Array(D * H * W);
  for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        result[z * H * W + y * W + x] = predVol[z * Hz * Wz + y * Wz + x];

  return { data: result, shape: [D, H, W] };
}
