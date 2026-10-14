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

  async function load(docId, d) {
    const blob = await Store.getFile(docId);
    if (!blob) {
      d.status = 'missing';
      return;
    }
    const lib = await Importers.pdfjs();
    const pdf = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const { items, styles } = await page.getTextContent();
      pages.push({
        w: vp.width,
        h: vp.height,
        items: items.filter((it) => 'str' in it && (it.str || it.hasEOL)).map((it) => layout(lib, vp, styles, it)),
      });
    }
    Object.assign(d, { status: 'ready', pdf, pages, template: template(pages) });
  }

  // Text run position in page units at scale 1 — the same maths as pdf.js' own text layer.
  function layout(lib, vp, styles, it) {
    const tx = lib.Util.transform(vp.transform, it.transform);
    const fh = Math.hypot(tx[2], tx[3]) || 1;
    const angle = Math.atan2(tx[1], tx[0]);
    const style = styles[it.fontName] ?? {};
    const family = style.fontFamily ?? 'sans-serif';
    const ascent = fh * (style.ascent || (style.descent ? 1 + style.descent : 0.8));
    let scaleX = 1;
    if (it.str && it.width > 0) {
      measure.font = `${fh}px ${family}`;
      scaleX = it.width / (measure.measureText(it.str).width || it.width);
    }
    return {
      str: it.str,
      eol: it.hasEOL,
      left: tx[4] + ascent * Math.sin(angle),
      top: tx[5] - ascent * Math.cos(angle),
      fh, angle, family, scaleX,
    };
  }

