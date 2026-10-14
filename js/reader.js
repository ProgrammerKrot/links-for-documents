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

  const openDocs = () => slots.filter(Boolean);

  function open(docId) {
    let slot = slots.indexOf(docId);
    if (slot >= 0) {
      activeSlot = slot;
      render();
      restartAnimation(panesEl.querySelector(`.pane[data-slot="${slot}"]`), 'flash');
      return;
    }
    slot = slots.indexOf(null);
    if (slot < 0) slot = 1 - activeSlot; // replace the pane you're not working in
    slots[slot] = docId;
    activeSlot = slot;
    render();
  }

  function close(slot) {
    slots[slot] = null;
    activeSlot = 0;
    render();
  }

  function render() {
    // keep panes left-aligned and drop documents that were deleted
    slots = [...slots.filter((id) => id && Store.doc(id)), null, null].slice(0, 2);

    const scroll = Object.fromEntries([...panesEl.querySelectorAll('.pane')]
      .map((p) => [p.dataset.doc, p.querySelector('.pane-scroll').scrollTop]));

    const docs = openDocs();
    panesEl.className = `panes count-${docs.length}`;
    panesEl.replaceChildren(...docs.flatMap((docId, i) => {
      const pane = renderPane(docId, i);
      return i ? [Object.assign(document.createElement('div'), { className: 'gutter' }), pane] : [pane];
    }));
    for (const pane of panesEl.querySelectorAll('.pane')) {
      pane.querySelector('.pane-scroll').scrollTop = scroll[pane.dataset.doc] ?? 0;
    }
    on.onRender();
    scheduleConnectors();
  }

