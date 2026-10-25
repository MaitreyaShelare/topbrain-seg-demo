// metrics.js — compute Dice on masked ground truth.
// merged: binary foreground Dice (any fg class matches any fg class) — matches workstation.
// macro:  per-class Dice averaged over classes present in GT.

function dicePerClass(gtArr, predArr, nClasses = 43) {
  const inter = new Uint32Array(nClasses);
  const gtN = new Uint32Array(nClasses);
  const predN = new Uint32Array(nClasses);
  let mergedInter = 0, mergedGt = 0, mergedPred = 0;

  for (let i = 0; i < gtArr.length; i++) {
    const g = gtArr[i], p = predArr[i];
    gtN[g]++;
    predN[p]++;
    if (g === p) inter[g]++;
    // Merged-Dice TP: any foreground voxel (>=1) counts, regardless of class match
    const gFg = g > 0, pFg = p > 0;
    if (gFg) mergedGt++;
    if (pFg) mergedPred++;
    if (gFg && pFg) mergedInter++;
  }

  const perClass = [];
  for (let c = 1; c < nClasses; c++) {
    if (gtN[c] === 0) continue;
    const d = (2 * inter[c]) / (gtN[c] + predN[c] + 1e-6);
    perClass.push({ cls: c, dice: d, gtVoxels: gtN[c] });
  }

  const merged = (2 * mergedInter) / (mergedGt + mergedPred + 1e-6);
  const macro = perClass.length
    ? perClass.reduce((s, r) => s + r.dice, 0) / perClass.length
    : 0;
  return { merged, macro, perClass };
}
