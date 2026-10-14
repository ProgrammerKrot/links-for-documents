// Left side: up to two documents side by side, highlighting, and connector curves
// between linked items of the two open documents.

const Reader = (() => {
  let slots = [null, null]; // docId per pane
  let activeSlot = 0;
  let pendingKey = null;
  let hoverKey = null;
  let on; // callbacks from app.js
  const freshLinks = new Set(); // links that should play the draw-in animation
  const drawing = new Set();    // PDFs with the area tool switched on (images always draw)
  const imageUrls = new Map();  // docId -> object URL of the stored image, or 'loading'
  const panesEl = document.getElementById('panes');
  const svg = document.getElementById('connectors');
  const workspace = document.getElementById('workspace');

  function init(handlers) {
    on = handlers;
    panesEl.addEventListener('mouseup', onMouseUp);
    panesEl.addEventListener('click', onClick);
    panesEl.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.hl, .area[data-area]');
      const key = el && `hl:${el.dataset.area ?? topHighlight(el)}`;
      if (key !== hoverKey) setHover(key);
    });
    panesEl.addEventListener('mouseleave', () => setHover(null));
    panesEl.addEventListener('pointerdown', startDrawing);
    panesEl.addEventListener('dragstart', (e) => e.target.closest('.img-sheet') && e.preventDefault());
    panesEl.addEventListener('scroll', () => { scheduleConnectors(); on.onScroll(); }, true);
    new ResizeObserver(scheduleConnectors).observe(workspace);
  }

