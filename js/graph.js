// Obsidian-style force-directed graph on a canvas.
// nodes: { key, kind: 'doc' | 'hl' | 'topic', label, color, parent?, badge?, shape? ('square' for areas) }
// edges: { a, b, kind: 'link' | 'contains' }

const easeOut = (t) => 1 - (1 - t) ** 3;

class ForceGraph {
  nodes = new Map();
  edges = [];
  neighbors = new Map();
  view = { x: 0, y: 0, k: 1 };
  viewTarget = null;
  alpha = 1;
  hover = null;
  externalHover = null;
  active = new Set();
  pending = null;
  anims = [];
  pulses = [];
  drag = null;
  fitWhenSettled = false;

  constructor(canvas, { onNodeClick, onHover }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick;
    this.onHover = onHover;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bindEvents();
    requestAnimationFrame((t) => this.frame(t));
  }

  setData(nodes, edges) {
    const prev = this.nodes;
    const now = performance.now();
    this.nodes = new Map();
    for (const n of nodes) {
      const existing = prev.get(n.key);
      if (existing) {
        this.nodes.set(n.key, Object.assign(existing, n));
        continue;
      }
      const anchor = this.nodes.get(n.parent) ?? prev.get(n.parent);
      const spread = anchor ? 30 : 160;
      this.nodes.set(n.key, {
        ...n,
        x: (anchor?.x ?? 0) + (Math.random() - 0.5) * spread,
        y: (anchor?.y ?? 0) + (Math.random() - 0.5) * spread,
        vx: 0,
        vy: 0,
        born: prev.size ? now : -Infinity,
      });
    }
    this.edges = edges
      .filter((e) => this.nodes.has(e.a) && this.nodes.has(e.b))
      .map((e) => ({ ...e, seed: hash(e.a + e.b) }));

    this.neighbors = new Map([...this.nodes.keys()].map((k) => [k, new Set([k])]));
    for (const e of this.edges) {
      this.neighbors.get(e.a).add(e.b);
      this.neighbors.get(e.b).add(e.a);
    }
    for (const n of this.nodes.values()) {
      const degree = this.neighbors.get(n.key).size - 1;
      n.r = n.kind === 'hl' ? 3.5 + Math.min(3, degree * 0.6)
        : n.kind === 'topic' ? 7 + Math.min(7, Math.sqrt(degree) * 1.8)
        : 9 + Math.min(9, Math.sqrt(degree) * 2);
    }
    if (!this.nodes.has(this.hover)) this.hover = null;
    this.alpha = Math.max(this.alpha, 0.6);
  }

  animateLink(a, b) {
    this.anims.push({ a, b, start: performance.now() });
    this.alpha = Math.max(this.alpha, 0.4);
  }

  setActive(keys) { this.active = new Set(keys); }
  setPending(key) { this.pending = key; }
  setExternalHover(key) { this.externalHover = key; }
  requestFit() { this.fitWhenSettled = true; }

  focusNode(key) {
    const n = this.nodes.get(key);
    if (!n) return;
    this.viewTarget = { x: -n.x * this.view.k, y: -n.y * this.view.k, k: this.view.k };
    this.pulses.push({ key, start: performance.now() });
  }

  fit() {
    if (!this.nodes.size) return;
    const xs = [...this.nodes.values()].map((n) => n.x);
    const ys = [...this.nodes.values()].map((n) => n.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = clamp(Math.min(this.w / (maxX - minX + 120), this.h / (maxY - minY + 120)), 0.15, 2);
    this.viewTarget = { x: -k * (minX + maxX) / 2, y: -k * (minY + maxY) / 2, k };
  }

  tick() {
    if (this.alpha < 0.003) return;
    const a = this.alpha;
    const ns = [...this.nodes.values()];
    const charge = (n) => (n.kind === 'hl' ? 0.35 : 1);

    for (let i = 0; i < ns.length; i++) {
      const p = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const q = ns[j];
        let dx = q.x - p.x, dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 360000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2);
        const fx = (dx / d) * (4200 * a) / d2, fy = (dy / d) * (4200 * a) / d2;
        p.vx -= fx * charge(q); p.vy -= fy * charge(q);
        q.vx += fx * charge(p); q.vy += fy * charge(p);
      }
    }

    for (const e of this.edges) {
      const p = this.nodes.get(e.a), q = this.nodes.get(e.b);
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const [len, k] = e.kind === 'contains' ? [42, 0.12] : [150, 0.04];
      const f = ((d - len) * k * a) / d;
      p.vx += dx * f; p.vy += dy * f;
      q.vx -= dx * f; q.vy -= dy * f;
    }

    for (const n of ns) {
      if (n === this.drag?.node) { n.vx = n.vy = 0; continue; }
      n.vx = (n.vx - n.x * 0.008 * a) * 0.62;
      n.vy = (n.vy - n.y * 0.008 * a) * 0.62;
      n.x += n.vx;
      n.y += n.vy;
    }
    this.alpha *= 0.993;
  }

  frame(t) {
    this.tick();
    if (this.fitWhenSettled && this.alpha < 0.08) {
      this.fitWhenSettled = false;
      this.fit();
    }
    if (this.viewTarget) {
      const v = this.view, g = this.viewTarget;
      v.x += (g.x - v.x) * 0.15;
      v.y += (g.y - v.y) * 0.15;
      v.k += (g.k - v.k) * 0.15;
      if (Math.abs(g.x - v.x) + Math.abs(g.y - v.y) + Math.abs(g.k - v.k) * 100 < 0.5) this.viewTarget = null;
    }
    this.draw(t);
    requestAnimationFrame((t) => this.frame(t));
  }

  readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    this.theme = {
      link: v('--link'),
      edge: v('--g-edge'),
      edgeHot: v('--g-edge-hot'),
      particle: v('--g-particle'),
      ring: v('--g-ring'),
      docFill: v('--g-doc-fill'),
      label: v('--g-label'),
    };
  }

  draw(t) {
    const { ctx, view, dpr } = this;
    this.readTheme();
    const theme = this.theme;
    const px = 1 / Math.max(view.k, 0.6); // keeps strokes readable when zoomed out

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.translate(this.w / 2 + view.x, this.h / 2 + view.y);
    ctx.scale(view.k, view.k);

    const focus = this.hover ?? this.externalHover;
    const near = focus && this.neighbors.get(focus);
    const animating = new Set(this.anims.map((an) => pairKey(an.a, an.b)));

    for (const e of this.edges) {
      if (e.kind === 'link' && animating.has(pairKey(e.a, e.b))) continue;
      const p = this.nodes.get(e.a), q = this.nodes.get(e.b);
      const touches = focus && (e.a === focus || e.b === focus);
      const dim = focus && !touches;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      if (e.kind === 'contains') {
        ctx.globalAlpha = dim ? 0.08 : 1;
        ctx.strokeStyle = touches ? theme.edgeHot : theme.edge;
        ctx.lineWidth = px;
        ctx.stroke();
        continue;
      }
      ctx.globalAlpha = dim ? 0.08 : touches ? 0.95 : 0.45;
      ctx.strokeStyle = theme.link;
      ctx.lineWidth = (touches ? 2.2 : 1.4) * px;
      ctx.stroke();
      if (dim) continue;
      const s = (t / 2200 + e.seed) % 1;
      ctx.globalAlpha = touches ? 1 : 0.8;
      ctx.fillStyle = theme.particle;
      this.dot(p.x + (q.x - p.x) * s, p.y + (q.y - p.y) * s, 1.8 * px);
    }
    ctx.globalAlpha = 1;

    // a new link shoots from a to b, then both ends pulse
    this.anims = this.anims.filter((an) => {
      const p = this.nodes.get(an.a), q = this.nodes.get(an.b);
      if (!p || !q) return false;
      const progress = (t - an.start) / 900;
      if (progress >= 1) {
        this.pulses.push({ key: an.a, start: t }, { key: an.b, start: t });
        return false;
      }
      const s = easeOut(Math.max(0, progress));
      const x = p.x + (q.x - p.x) * s, y = p.y + (q.y - p.y) * s;
      ctx.save();
      ctx.shadowColor = ctx.strokeStyle = theme.link;
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = theme.particle;
      this.dot(x, y, 4 * px);
      ctx.restore();
      return true;
    });

    this.pulses = this.pulses.filter((pl) => {
      const n = this.nodes.get(pl.key);
      const s = (t - pl.start) / 700;
      if (!n || s >= 1) return false;
      ctx.globalAlpha = 1 - s;
      ctx.strokeStyle = theme.link;
      ctx.lineWidth = 2 * px;
      this.ring(n.x, n.y, n.r + 4 + s * 22);
      return true;
    });

    for (const n of this.nodes.values()) {
      const grow = Math.min(1, (t - n.born) / 450);
      const r = n.r * (easeOut(grow) + Math.sin(grow * Math.PI) * 0.25);
      ctx.globalAlpha = near && !near.has(n.key) ? 0.15 : 1;
      if (n.kind === 'doc') {
        this.drawDoc(n, r, focus, t, px);
        continue;
      }
      ctx.fillStyle = n.color;
      ctx.beginPath();
      if (n.shape === 'square') {
        ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
      } else if (n.kind === 'topic') {
        const d = r * 1.2;
        ctx.moveTo(n.x, n.y - d);
        ctx.lineTo(n.x + d, n.y);
        ctx.lineTo(n.x, n.y + d);
        ctx.lineTo(n.x - d, n.y);
        ctx.closePath();
      } else {
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (n.key === focus) {
        ctx.strokeStyle = theme.ring;
        ctx.lineWidth = 1.5 / view.k;
        ctx.stroke();
      }
      if (this.active.has(n.key)) {
        ctx.strokeStyle = theme.ring;
        ctx.lineWidth = 2 * px;
        this.ring(n.x, n.y, r + 4);
      }
      if (this.pending === n.key) {
        const s = (t % 1200) / 1200;
        ctx.globalAlpha = 1 - s;
        ctx.strokeStyle = theme.link;
        ctx.lineWidth = 2.5 * px;
        this.ring(n.x, n.y, r + 4 + s * 14);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.label;
    for (const n of this.nodes.values()) {
      const inFocus = near?.has(n.key);
      if (near && !inFocus) continue;
      if (!inFocus && view.k <= (n.kind === 'hl' ? 1.7 : 0.55)) continue;
      const size = (n.kind === 'hl' ? 10 : 12) / Math.max(view.k, 0.8);
      ctx.font = `${n.key === focus ? 600 : 400} ${size}px Inter, system-ui, sans-serif`;
      ctx.globalAlpha = n.kind === 'hl' ? 0.75 : 0.9;
      const text = n.label.length > 32 ? n.label.slice(0, 30) + '…' : n.label;
      ctx.fillText(text, n.x, n.y + (n.kind === 'doc' ? n.r * 1.15 + 5 : n.r + 4));
    }
    ctx.globalAlpha = 1;
  }

  dot(x, y, r) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  ring(x, y, r) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  // Page outline with a folded top-right corner.
  pagePath(x0, y0, w, h, fold) {
    const ctx = this.ctx;
    const rr = Math.min(w, h) * 0.12;
    ctx.beginPath();
    ctx.moveTo(x0 + rr, y0);
    ctx.lineTo(x0 + w - fold, y0);
    ctx.lineTo(x0 + w, y0 + fold);
    ctx.lineTo(x0 + w, y0 + h - rr);
    ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - rr, y0 + h);
    ctx.lineTo(x0 + rr, y0 + h);
    ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
    ctx.lineTo(x0, y0 + rr);
    ctx.quadraticCurveTo(x0, y0, x0 + rr, y0);
    ctx.closePath();
  }

  drawDoc(n, r, focus, t, px) {
    const { ctx, view, theme } = this;
    const w = r * 1.7, h = r * 2.2, fold = w * 0.32;
    const x0 = n.x - w / 2, y0 = n.y - h / 2;

    this.pagePath(x0, y0, w, h, fold);
    ctx.fillStyle = theme.docFill;
    ctx.fill();
    ctx.save();
    ctx.globalAlpha *= 0.14;
    ctx.fillStyle = n.color;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = n.color;
    ctx.lineWidth = (n.key === focus ? 2.2 : 1.5) * px;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x0 + w - fold, y0);
    ctx.lineTo(x0 + w - fold, y0 + fold);
    ctx.lineTo(x0 + w, y0 + fold);
    ctx.closePath();
    ctx.fillStyle = n.color;
    ctx.fill();

    // type badge when there is room, otherwise a few "text lines"
    if (r * view.k > 9) {
      ctx.font = `700 ${Math.max(5, r * 0.62)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.badge, n.x, n.y + h * 0.16);
    } else {
      ctx.strokeStyle = n.color;
      ctx.lineWidth = Math.max(0.6, r * 0.12);
      ctx.lineCap = 'round';
      for (const [fy, fw] of [[0.45, 0.6], [0.62, 0.6], [0.79, 0.4]]) {
        ctx.beginPath();
        ctx.moveTo(x0 + w * 0.2, y0 + h * fy);
        ctx.lineTo(x0 + w * (0.2 + fw), y0 + h * fy);
        ctx.stroke();
      }
    }

    if (this.active.has(n.key)) {
      const g = 4 * px + 2;
      ctx.strokeStyle = theme.ring;
      ctx.lineWidth = 2 * px;
      this.pagePath(x0 - g, y0 - g, w + g * 2, h + g * 2, fold + 3);
      ctx.stroke();
    }
    if (this.pending === n.key) {
      const s = (t % 1200) / 1200;
      const g = 4 + s * 14;
      ctx.save();
      ctx.globalAlpha = 1 - s;
      ctx.strokeStyle = theme.link;
      ctx.lineWidth = 2.5 * px;
      this.pagePath(x0 - g, y0 - g, w + g * 2, h + g * 2, fold + g * 0.6);
      ctx.stroke();
      ctx.restore();
    }
  }

  resize() {
    const { width, height } = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = devicePixelRatio;
    this.w = width;
    this.h = height;
    this.canvas.width = Math.max(1, width * this.dpr);
    this.canvas.height = Math.max(1, height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return {
      sx, sy,
      x: (sx - this.w / 2 - this.view.x) / this.view.k,
      y: (sy - this.h / 2 - this.view.y) / this.view.k,
    };
  }

  // Closest node under the pointer; documents use their page shape rather than a circle.
  hit(p) {
    let best = null, bestGap = Infinity;
    for (const n of this.nodes.values()) {
      const d = n.kind === 'doc'
        ? Math.max(Math.abs(n.x - p.x) / 0.85, Math.abs(n.y - p.y) / 1.1)
        : Math.hypot(n.x - p.x, n.y - p.y);
      const gap = d - n.r - 4 / this.view.k;
      if (gap < 0 && gap <= bestGap) { best = n; bestGap = gap; }
    }
    return best;
  }

  bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.drag = { node: this.hit(this.toWorld(e)), sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
      this.viewTarget = null;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.toWorld(e);
      const drag = this.drag;
      if (drag) {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        drag.moved ||= Math.hypot(dx, dy) > 3;
        if (!drag.moved) return;
        if (drag.node) {
          drag.node.x = p.x;
          drag.node.y = p.y;
          this.alpha = Math.max(this.alpha, 0.3);
        } else {
          this.view.x = drag.vx + dx;
          this.view.y = drag.vy + dy;
        }
        c.style.cursor = 'grabbing';
        return;
      }
      const node = this.hit(p);
      this.hover = node?.key ?? null;
      c.style.cursor = node ? 'pointer' : 'grab';
      this.onHover(this.hover, e);
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.drag) return; // press started outside the canvas
      const { node, moved } = this.drag;
      this.drag = null;
      c.style.cursor = 'grab';
      if (node && !moved) this.onNodeClick(node.key, e);
    });
    c.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = null;
      this.onHover(null);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.viewTarget = null;
      const p = this.toWorld(e);
      const k = clamp(this.view.k * Math.exp(-e.deltaY * 0.0015), 0.15, 4);
      this.view = { k, x: p.sx - this.w / 2 - p.x * k, y: p.sy - this.h / 2 - p.y * k };
    }, { passive: false });
  }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}
