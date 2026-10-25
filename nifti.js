// nifti.js — minimal self-contained NIfTI-1 parser + gzip via DecompressionStream.

async function gunzip(arrayBuffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser lacks DecompressionStream');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(arrayBuffer));
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

function isGzip(buf) {
  const b = new Uint8Array(buf, 0, 2);
  return b[0] === 0x1f && b[1] === 0x8b;
}

async function parseNifti(arrayBuffer, isRaw = true) {
  let buf = arrayBuffer;
  if (isGzip(buf)) buf = await gunzip(buf);

  const dv = new DataView(buf);
  if (dv.getInt32(0, true) !== 348) throw new Error('Not a valid NIfTI-1 file');

  const dim = [];
  for (let i = 0; i < 8; i++) dim.push(dv.getInt16(40 + i * 2, true));
  const nx = dim[1], ny = dim[2], nz = dim[3], nt = dim[4] || 1;

  const datatype = dv.getInt16(70, true);
  const bitpix = dv.getInt16(72, true);

  const pixdim = [];
  for (let i = 0; i < 8; i++) pixdim.push(dv.getFloat32(76 + i * 4, true));
  
  // Parse affine matrix from NIfTI header
  const affine = new Float64Array(16);
  for (let i = 0; i < 4; i++) affine[i]     = dv.getFloat32(280 + i * 4, true);
  for (let i = 0; i < 4; i++) affine[4 + i] = dv.getFloat32(296 + i * 4, true);
  for (let i = 0; i < 4; i++) affine[8 + i] = dv.getFloat32(312 + i * 4, true);
  affine[15] = 1;

  // Calculate true physical spacing from affine matrix
  const sx = Math.hypot(affine[0], affine[4], affine[8]) || pixdim[1] || 1;
  const sy = Math.hypot(affine[1], affine[5], affine[9]) || pixdim[2] || 1;
  const sz = Math.hypot(affine[2], affine[6], affine[10]) || pixdim[3] || 1;

  const vox_offset = dv.getFloat32(108, true) || 352;
  const scl_slope = dv.getFloat32(112, true);
  const scl_inter = dv.getFloat32(116, true);
  const slope = (scl_slope === 0 || isNaN(scl_slope)) ? 1 : scl_slope;
  const inter = isNaN(scl_inter) ? 0 : scl_inter;

  const voxStart = Math.round(vox_offset);
  const nVox = nx * ny * nz * nt;
  const slice = buf.slice(voxStart, voxStart + (bitpix / 8) * nVox);
  let data;
  if (datatype === 2)        data = new Uint8Array(slice);
  else if (datatype === 4)   data = new Int16Array(slice);
  else if (datatype === 8)   data = new Int32Array(slice);
  else if (datatype === 16)  data = new Float32Array(slice);
  else if (datatype === 64)  data = new Float64Array(slice);
  else if (datatype === 512) data = new Uint16Array(slice);
  else if (datatype === 768) data = new Uint32Array(slice);
  else throw new Error('Unsupported datatype: ' + datatype);

  let outData;
  if (slope === 1 && inter === 0) {
    outData = data;
  } else {
    outData = new Float32Array(nVox);
    for (let i = 0; i < nVox; i++) outData[i] = data[i] * slope + inter;
  }

  let finalData = outData;
  
  if (isRaw) {
    // 1. Transpose from [X, Y, Z] to [Z, Y, X]
    finalData = new Float32Array(nVox);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const oldIdx = x + y * nx + z * nx * ny;
          const newIdx = (z * ny * nx) + (y * nx) + x;
          finalData[newIdx] = outData[oldIdx];
        }
      }
    }
    
    // 2. Reorient to LPS+ (flip axes if affine indicates RAS)
    if (affine[0] < 0) {
      const temp = new Float32Array(nVox);
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            temp[z*ny*nx + y*nx + x] = finalData[z*ny*nx + y*nx + (nx - 1 - x)];
          }
        }
      }
      finalData = temp;
    }
    if (affine[5] < 0) {
      const temp = new Float32Array(nVox);
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            temp[z*ny*nx + y*nx + x] = finalData[z*ny*nx + (ny - 1 - y)*nx + x];
          }
        }
      }
      finalData = temp;
    }
    if (affine[10] < 0) {
      const temp = new Float32Array(nVox);
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            temp[z*ny*nx + y*nx + x] = finalData[(nz - 1 - z)*ny*nx + y*nx + x];
          }
        }
      }
      finalData = temp;
    }
  }

  return { data: finalData, shape: [nz, ny, nx], spacing: [sz, sy, sx], affine };
}

async function loadNiftiFromUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return parseNifti(buf, false); // Preloaded cases are already in [Z, Y, X] and LPS
}

async function loadNiftiFromFile(file) {
  const buf = await file.arrayBuffer();
  return parseNifti(buf, true); // Raw files need transpose and reorient
}
