// viewer.js — vertically-stacked 3-plane viewer with anatomical orientation icons.

class Viewer {
  constructor(container) {
    this.container = container;
    this.setupDom();
  }

  setupDom() {
    // Small SVG icons — schematic views of the human head from each plane
    const iconAxial = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:middle;margin-right:4px;">
        <ellipse cx="12" cy="12" rx="9" ry="7" fill="#c9d9f0" stroke="#4a90e2" stroke-width="1"/>
        <line x1="3" y1="12" x2="21" y2="12" stroke="#4a90e2" stroke-width="0.7" stroke-dasharray="2,2"/>
      </svg>`;
    const iconCoronal = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:middle;margin-right:4px;">
        <ellipse cx="12" cy="12" rx="7" ry="9" fill="#c9d9f0" stroke="#4a90e2" stroke-width="1"/>
        <line x1="12" y1="3" x2="12" y2="21" stroke="#4a90e2" stroke-width="0.7" stroke-dasharray="2,2"/>
      </svg>`;
    const iconSagittal = `
      <svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:middle;margin-right:4px;">
        <ellipse cx="12" cy="12" rx="7" ry="9" fill="#c9d9f0" stroke="#4a90e2" stroke-width="1"/>
        <path d="M5 12 Q12 8 19 12" fill="none" stroke="#4a90e2" stroke-width="0.9"/>
      </svg>`;

    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <div style="display:flex;align-items:center;font-size:12px;margin-bottom:4px;color:#333;">
            ${iconAxial}<strong>Axial</strong>
            <span style="color:#888;margin-left:6px;font-size:11px;">top–down view</span>
            <span id="ax-idx" style="margin-left:auto;color:#333;font-size:12px;">-</span>
          </div>
          <canvas id="ax" style="width:100%;aspect-ratio:1;display:block;background:#000;border-radius:6px;"></canvas>
          <input id="ax-slice" type="range" min="0" max="100" value="50" style="width:100%;margin-top:4px;">
        </div>
        <div>
          <div style="display:flex;align-items:center;font-size:12px;margin-bottom:4px;color:#333;">
            ${iconCoronal}<strong>Coronal</strong>
            <span style="color:#888;margin-left:6px;font-size:11px;">front view</span>
            <span id="cor-idx" style="margin-left:auto;color:#333;font-size:12px;">-</span>
          </div>
          <canvas id="cor" style="width:100%;aspect-ratio:1;display:block;background:#000;border-radius:6px;"></canvas>
          <input id="cor-slice" type="range" min="0" max="100" value="50" style="width:100%;margin-top:4px;">
        </div>
        <div>
          <div style="display:flex;align-items:center;font-size:12px;margin-bottom:4px;color:#333;">
            ${iconSagittal}<strong>Sagittal</strong>
            <span style="color:#888;margin-left:6px;font-size:11px;">side view</span>
            <span id="sag-idx" style="margin-left:auto;color:#333;font-size:12px;">-</span>
          </div>
          <canvas id="sag" style="width:100%;aspect-ratio:1;display:block;background:#000;border-radius:6px;"></canvas>
          <input id="sag-slice" type="range" min="0" max="100" value="50" style="width:100%;margin-top:4px;">
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;font-size:13px;align-items:center;">
        <label><input id="show-gt" type="checkbox" checked> <span style="color:#e25c5c;">GT</span></label>
        <label><input id="show-tea" type="checkbox" checked> <span style="color:#4a90e2;">Teacher</span></label>
        <label><input id="show-stu" type="checkbox" checked> <span style="color:#0a7d2c;">Student</span></label>
        <label style="flex:1;">Opacity: <input id="opac" type="range" min="0" max="100" value="50" style="width:100%;max-width:120px;vertical-align:middle;"></label>
      </div>
    `;
    this.ax = this.container.querySelector('#ax');
    this.cor = this.container.querySelector('#cor');
    this.sag = this.container.querySelector('#sag');
    this.axSlider = this.container.querySelector('#ax-slice');
    this.corSlider = this.container.querySelector('#cor-slice');
    this.sagSlider = this.container.querySelector('#sag-slice');
    this.axIdx = this.container.querySelector('#ax-idx');
    this.corIdx = this.container.querySelector('#cor-idx');
    this.sagIdx = this.container.querySelector('#sag-idx');

    [this.axSlider, this.corSlider, this.sagSlider].forEach(s => {
      s.addEventListener('input', () => this.render());
    });
    ['show-gt','show-tea','show-stu','opac'].forEach(id => {
      this.container.querySelector('#'+id).addEventListener('input', () => this.render());
    });
  }

  setData({ img, gt, teacher, student, defaultSlice }) {
    this.img = img;
    this.gt = gt;
    this.teacher = teacher;
    this.student = student;
    const [D, H, W] = img.shape;

    this.axSlider.max = D - 1;
    this.corSlider.max = H - 1;
    this.sagSlider.max = W - 1;

    this.axSlider.value = (defaultSlice !== undefined) ? defaultSlice : Math.floor(D / 2);
    this.corSlider.value = Math.floor(H / 2);
    this.sagSlider.value = Math.floor(W / 2);

    this.render();
  }

  render() {
    if (!this.img) return;
    const [D, H, W] = this.img.shape;
    const axSlice = parseInt(this.axSlider.value);
    const corSlice = parseInt(this.corSlider.value);
    const sagSlice = parseInt(this.sagSlider.value);

    this.axIdx.textContent = `${axSlice} / ${D-1}`;
    this.corIdx.textContent = `${corSlice} / ${H-1}`;
    this.sagIdx.textContent = `${sagSlice} / ${W-1}`;

    const opacity = parseInt(this.container.querySelector('#opac').value) / 100;
    const showGt = this.container.querySelector('#show-gt').checked;
    const showTea = this.container.querySelector('#show-tea').checked;
    const showStu = this.container.querySelector('#show-stu').checked;
    const opts = { showGt, showTea, showStu, opacity };

    this.drawPlane(this.ax, W, H,
      (x, y) => this.img.data[axSlice * H * W + y * W + x],
      (x, y) => this.getOverlayLabels('ax', axSlice, x, y),
      opts);

    this.drawPlane(this.cor, W, D,
      (x, z) => this.img.data[z * H * W + corSlice * W + x],
      (x, z) => this.getOverlayLabels('cor', corSlice, x, z),
      opts);

    this.drawPlane(this.sag, H, D,
      (y, z) => this.img.data[z * H * W + y * W + sagSlice],
      (y, z) => this.getOverlayLabels('sag', sagSlice, y, z),
      opts);
  }

  getOverlayLabels(axis, fixed, a, b) {
    const [D, H, W] = this.img.shape;
    let idx;
    if (axis === 'ax') {
      idx = fixed * H * W + b * W + a;
    } else if (axis === 'cor') {
      idx = b * H * W + fixed * W + a;
    } else {
      idx = b * H * W + a * W + fixed;
    }
    return {
      gt: this.gt.data[idx],
      tea: this.teacher.data[idx],
      stu: this.student.data[idx],
    };
  }

  drawPlane(canvas, w, h, getBase, getOverlay, opts) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const im = ctx.createImageData(w, h);

    const vals = new Float32Array(w * h);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const v = getBase(i, j);
        vals[j * w + i] = v;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    const range = hi - lo || 1;

    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const px = (j * w + i) * 4;
        let g = Math.floor(((vals[j * w + i] - lo) / range) * 255);
        if (g < 0) g = 0; if (g > 255) g = 255;
        let r = g, gr = g, b = g;

        const ov = getOverlay(i, j);
        const op = opts.opacity;
        if (opts.showStu && ov.stu > 0) { r = r*(1-op) + 0*op; gr = gr*(1-op) + 200*op; b = b*(1-op) + 0*op; }
        if (opts.showTea && ov.tea > 0) { r = r*(1-op*0.7) + 0*op*0.7; gr = gr*(1-op*0.7) + 100*op*0.7; b = b*(1-op*0.7) + 255*op*0.7; }
        if (opts.showGt && ov.gt > 0)  { r = r*(1-op*0.6) + 255*op*0.6; gr = gr*(1-op*0.6) + 50*op*0.6; b = b*(1-op*0.6) + 50*op*0.6; }

        im.data[px] = r; im.data[px+1] = gr; im.data[px+2] = b; im.data[px+3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
  }
}
