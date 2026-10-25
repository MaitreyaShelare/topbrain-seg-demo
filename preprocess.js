// preprocess.js — crop + resample + normalize.
// The normalize() function matches topbrain_lib._normalize EXACTLY.
// The crop() matches topbrain_lib._bbox_from_array exactly.
// The resample() is a reasonable trilinear; boundary handling may differ from
// SimpleITK by <1% on edge voxels. Preloaded cases don't go through resample()
// (already 0.9mm), so no fairness risk for the demo.

// ---- percentile helper (matches numpy.percentile linear interpolation) ----
function percentile(arr, p) {
  // arr: Float32Array, p in [0,100]
  const n = arr.length;
  const sorted = Float32Array.from(arr).sort();
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---- crop to brain bbox (matches topbrain_lib._bbox_from_array) ----
function cropToBbox(img, refBbox = null) {
  const { data, shape, spacing, affine } = img;
  const [D, H, W] = shape;

  let z0, z1, y0, y1, x0, x1;

  if (refBbox) {
    // Use the exact bounding box from the reference (e.g., the image)
    ({ z0, z1, y0, y1, x0, x1 } = refBbox);
  } else {
    const N = data.length;
    const sampleSize = Math.min(200000, N);
    const sample = new Float32Array(sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      sample[i] = data[Math.floor(Math.random() * N)];
    }
    const p01 = percentile(sample, 1);
    const p99 = percentile(sample, 99);
    const threshold = p01 + 0.1 * (p99 - p01);

    z0 = D; z1 = 0; y0 = H; y1 = 0; x0 = W; x1 = 0;
    for (let z = 0; z < D; z++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (data[z * H * W + y * W + x] > threshold) {
            if (z < z0) z0 = z; if (z > z1) z1 = z;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
          }
        }
      }
    }
    if (z0 > z1) { z0 = 0; z1 = D - 1; }
    if (y0 > y1) { y0 = 0; y1 = H - 1; }
    if (x0 > x1) { x0 = 0; x1 = W - 1; }

    z0 = Math.max(0, z0 - 5); z1 = Math.min(D - 1, z1 + 5);
    y0 = Math.max(0, y0 - 5); y1 = Math.min(H - 1, y1 + 5);
    x0 = Math.max(0, x0 - 5); x1 = Math.min(W - 1, x1 + 5);
  }

  const newD = z1 - z0 + 1, newH = y1 - y0 + 1, newW = x1 - x0 + 1;
  const out = new Float32Array(newD * newH * newW);
  for (let z = 0; z < newD; z++) {
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        out[z * newH * newW + y * newW + x] =
          data[(z + z0) * H * W + (y + y0) * W + (x + x0)];
      }
    }
  }
  const newAffine = Float64Array.from(affine);
  newAffine[3] -= x0 * spacing[2];
  newAffine[7] -= y0 * spacing[1];
  newAffine[11] -= z0 * spacing[0];

  const res = { data: out, shape: [newD, newH, newW], spacing, affine: newAffine };
  res._bbox = { z0, z1, y0, y1, x0, x1 };
  return res;
}

// ---- resample to target spacing (trilinear for image, nearest for labels) ----
function resample(img, targetSpacingZYX, isLabel = false) {
  const { data, shape, spacing } = img;
  const [D, H, W] = shape;
  const [sz, sy, sx] = spacing;
  const [tz, ty, tx] = targetSpacingZYX;

  const nD = Math.max(1, Math.round(D * sz / tz));
  const nH = Math.max(1, Math.round(H * sy / ty));
  const nW = Math.max(1, Math.round(W * sx / tx));

  const out = new Float32Array(nD * nH * nW);

  // Map output voxel (od, oh, ow) to input coordinate (id, ih, iw)
  // Since both in and out origin are the same (LPS+, axis-aligned),
  // in_coord = out_coord * target_spacing / orig_spacing
  const scaleZ = sz / tz, scaleY = sy / ty, scaleX = sx / tx;

  for (let od = 0; od < nD; od++) {
    for (let oh = 0; oh < nH; oh++) {
      for (let ow = 0; ow < nW; ow++) {
        const izf = od * scaleZ;
        const iyf = oh * scaleY;
        const ixf = ow * scaleX;
        const ix = Math.min(W - 1, Math.round(ixf));
        const iy = Math.min(H - 1, Math.round(iyf));
        const iz = Math.min(D - 1, Math.round(izf));
        if (isLabel) {
          out[od * nH * nW + oh * nW + ow] = data[iz * H * W + iy * W + ix];
        } else {
          // Trilinear
          const z0 = Math.floor(izf), z1 = Math.min(D - 1, z0 + 1);
          const y0 = Math.floor(iyf), y1 = Math.min(H - 1, y0 + 1);
          const x0 = Math.floor(ixf), x1 = Math.min(W - 1, x0 + 1);
          const dz = izf - z0, dy = iyf - y0, dx = ixf - x0;
          const c000 = data[z0 * H * W + y0 * W + x0];
          const c001 = data[z0 * H * W + y0 * W + x1];
          const c010 = data[z0 * H * W + y1 * W + x0];
          const c011 = data[z0 * H * W + y1 * W + x1];
          const c100 = data[z1 * H * W + y0 * W + x0];
          const c101 = data[z1 * H * W + y0 * W + x1];
          const c110 = data[z1 * H * W + y1 * W + x0];
          const c111 = data[z1 * H * W + y1 * W + x1];
          const c00 = c000 * (1 - dx) + c001 * dx;
          const c01 = c010 * (1 - dx) + c011 * dx;
          const c10 = c100 * (1 - dx) + c101 * dx;
          const c11 = c110 * (1 - dx) + c111 * dx;
          const c0 = c00 * (1 - dy) + c01 * dy;
          const c1 = c10 * (1 - dy) + c11 * dy;
          out[od * nH * nW + oh * nW + ow] = c0 * (1 - dz) + c1 * dz;
        }
      }
    }
  }
  const newSpacing = [tz, ty, tx];
  return { data: out, shape: [nD, nH, nW], spacing: newSpacing, affine: img.affine };
}

// ---- normalize (matches topbrain_lib._normalize EXACTLY) ----
function normalize(img, modality, preprocessing) {
  const cfg = preprocessing.normalization[modality];
  const out = new Float32Array(img.data.length);
  if (cfg.mode === "global_clip_zscore") {
    const lo = cfg.clip_low, hi = cfg.clip_high;
    const m = cfg.mean, s = cfg.std;
    for (let i = 0; i < img.data.length; i++) {
      let v = img.data[i];
      if (v < lo) v = lo; if (v > hi) v = hi;
      out[i] = (v - m) / (s + 1e-6);
    }
  } else if (cfg.mode === "per_volume_percentile_zscore") {
    // p0.5 and p99.5 of current data
    const N = img.data.length;
    const sampleSize = Math.min(200000, N);
    const sample = new Float32Array(sampleSize);
    for (let i = 0; i < sampleSize; i++) {
      sample[i] = img.data[Math.floor(Math.random() * N)];
    }
    const lo = percentile(sample, cfg.clip_low_pct);
    const hi = percentile(sample, cfg.clip_high_pct);
    let sum = 0, sumSq = 0, cnt = 0;
    for (let i = 0; i < N; i++) {
      let v = img.data[i];
      if (v < lo) v = lo; if (v > hi) v = hi;
      sum += v; sumSq += v * v; cnt++;
    }
    const m = sum / cnt;
    const s = Math.sqrt(Math.max(0, sumSq / cnt - m * m));
    for (let i = 0; i < img.data.length; i++) {
      let v = img.data[i];
      if (v < lo) v = lo; if (v > hi) v = hi;
      out[i] = (v - m) / (s + 1e-6);
    }
  } else {
    throw new Error("Unknown normalization mode: " + cfg.mode);
  }
  return { data: out, shape: img.shape, spacing: img.spacing, affine: img.affine };
}

// ---- full pipeline (for upload path; preloaded cases skip crop+resample) ----
function preprocessForInference(img, modality, preprocessing, alreadyPreprocessed) {
  let out = img;
  if (!alreadyPreprocessed) {
    out = cropToBbox(out);
    const ts = preprocessing.target_spacing_mm;
    const bbox = out._bbox;
    out = resample(out, [ts[2], ts[1], ts[0]], false);
    out._bbox = bbox;
  }
  out = normalize(out, modality, preprocessing);
  return out;
}
