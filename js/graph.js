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

