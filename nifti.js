// nifti.js — minimal self-contained NIfTI-1 parser + gzip via DecompressionStream.

async function gunzip(arrayBuffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser lacks DecompressionStream (need Chrome 80+, Firefox 113+, Safari 16.4+)');
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
  const sizeof_hdr_le = dv.getInt32(0, true);
  const sizeof_hdr_be = dv.getInt32(0, false);
  const le = sizeof_hdr_le === 348;
  if (!le && sizeof_hdr_be !== 348) {
    throw new Error('Not a NIfTI-1 file (sizeof_hdr != 348)');
  }
  if (!le) throw new Error('Big-endian NIfTI not supported');

  const dim = [];
  for (let i = 0; i < 8; i++) dim.push(dv.getInt16(40 + i * 2, true));
  const nx = dim[1], ny = dim[2], nz = dim[3], nt = dim[4] || 1;

  const datatype = dv.getInt16(70, true);
  const bitpix = dv.getInt16(72, true);

  const pixdim = [];
  for (let i = 0; i < 8; i++) pixdim.push(dv.getFloat32(76 + i * 4, true));
  const sx = pixdim[1] || 1, sy = pixdim[2] || 1, sz = pixdim[3] || 1;

  const vox_offset = dv.getFloat32(108, true) || 352;
  const scl_slope = dv.getFloat32(112, true);
  const scl_inter = dv.getFloat32(116, true);
  const slope = (scl_slope === 0 || isNaN(scl_slope)) ? 1 : scl_slope;
  const inter = isNaN(scl_inter) ? 0 : scl_inter;

  const voxStart = Math.round(vox_offset);
  const nVox = nx * ny * nz * nt;
  const nBytes = (bitpix / 8) * nVox;

  const slice = buf.slice(voxStart, voxStart + nBytes);
  let data;
  if (datatype === 2)        data = new Uint8Array(slice);
  else if (datatype === 4)   data = new Int16Array(slice);
  else if (datatype === 8)   data = new Int32Array(slice);
  else if (datatype === 16)  data = new Float32Array(slice);
  else if (datatype === 64)  data = new Float64Array(slice);
  else if (datatype === 512) data = new Uint16Array(slice);
  else if (datatype === 768) data = new Uint32Array(slice);
  else throw new Error('Unsupported NIfTI datatype: ' + datatype);

  let outData;
  if (slope === 1 && inter === 0) {
    outData = data;
  } else {
    outData = new Float32Array(nVox);
    for (let i = 0; i < nVox; i++) outData[i] = data[i] * slope + inter;
  }

  let finalData = outData;
  
  // If it's a raw uploaded file, the NIfTI data is [X, Y, Z] flattened.
  // We must transpose it to [Z, Y, X] to match the viewer and python.
  if (isRaw && !(nx === nz && ny === nz)) {
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
  }

  const shape = [nz, ny, nx];   // D, H, W  (zyx order matches Python/SITK)
  const spacing = [sz, sy, sx];

  const affine = new Float64Array(16);
  for (let i = 0; i < 4; i++) affine[i]     = dv.getFloat32(280 + i * 4, true);
  for (let i = 0; i < 4; i++) affine[4 + i] = dv.getFloat32(296 + i * 4, true);
  for (let i = 0; i < 4; i++) affine[8 + i] = dv.getFloat32(312 + i * 4, true);
  affine[15] = 1;

  return { data: finalData, shape, spacing, affine };
}

function base64ToArrayBuffer(payload) {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function loadNiftiFromUrl(url) {
  let buf;
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma < 0) throw new Error('Malformed data URL');
    const header = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (header.endsWith(';base64')) {
      buf = base64ToArrayBuffer(payload);
    } else {
      const text = decodeURIComponent(payload);
      buf = new TextEncoder().encode(text).buffer;
    }
  } else {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch ${url}: ${resp.status}`);
    buf = await resp.arrayBuffer();
  }
  // Preloaded cases are already in [Z, Y, X] order
  return parseNifti(buf, false); 
}

async function loadNiftiFromFile(file) {
  const buf = await file.arrayBuffer();
  // Raw uploaded files need to be transposed from [X, Y, Z] to [Z, Y, X]
  return parseNifti(buf, true);
}
