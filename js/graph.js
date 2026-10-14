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

