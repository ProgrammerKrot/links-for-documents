// Uploaded file → text. pdf.js and mammoth are pulled from cdnjs on first use.

const Importers = (() => {
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';
  const PDFJS = `${CDN}/pdf.js/3.11.174/pdf.min.js`;
  const PDFJS_WORKER = `${CDN}/pdf.js/3.11.174/pdf.worker.min.js`;
  const MAMMOTH = `${CDN}/mammoth/1.6.0/mammoth.browser.min.js`;

  const scripts = {};
  function loadScript(src) {
    scripts[src] ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
    return scripts[src];
  }

  async function pdfjs() {
    await loadScript(PDFJS);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return pdfjsLib;
  }

  // Pages are joined with a form feed, paragraphs with a blank line.
  async function pdfToText(file) {
    const pdf = await (await pdfjs()).getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const { items } = await (await pdf.getPage(n)).getTextContent();
      pages.push(paragraphs(items));
    }
    return pages.join('\f');
  }

