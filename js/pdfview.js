// Real PDF pages: a pdf.js canvas per page with an invisible, selectable text layer on top.
// Highlight offsets work against the text layer, the same way as for Markdown.
// Canvases are painted only for pages near the viewport and freed when they scroll far away.

const PdfView = (() => {
  const docs = new Map();      // docId -> { status, pdf, pages, template, listeners }
  const canvases = new Map();  // "docId:page" -> { canvas, width }
  const timers = new Map();
  const sheetInfo = new WeakMap();
  const mounted = new Map();   // docId -> sheets currently in the DOM
  const visible = new WeakSet();
  const measure = document.createElement('canvas').getContext('2d');

  const resizeObs = new ResizeObserver((entries) => {
    for (const { target, contentRect } of entries) {
      const { docId, i } = sheetInfo.get(target);
      target.style.setProperty('--k', contentRect.width / docs.get(docId).pages[i].w);
      if (visible.has(target)) schedule(target);
    }
  });

  const viewObs = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) {
        visible.add(target);
        schedule(target);
      } else {
        visible.delete(target);
        drop(target);
      }
    }
  }, { rootMargin: '1200px 0px' });

  const status = (docId) => docs.get(docId)?.status ?? 'idle';

  // Loads the stored original once; status ends as 'ready', 'missing' or 'error'.
  function ensure(docId, onDone) {
    if (docs.has(docId)) {
      const d = docs.get(docId);
      if (d.status === 'loading') d.listeners.push(onDone);
      return;
    }
    const d = { status: 'loading', listeners: [onDone] };
    docs.set(docId, d);
    load(docId, d)
      .catch((err) => {
        d.status = 'error';
        console.warn('PDF view failed', err);
      })
      .finally(() => d.listeners.forEach((fn) => fn()));
  }

