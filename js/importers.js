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

  // Lines come from item y-positions, paragraphs from vertical gaps between lines.
  function paragraphs(items) {
    const lines = [];
    for (const it of items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      const h = it.height || Math.abs(it.transform[3]) || 10;
      const line = lines.at(-1);
      if (line && Math.abs(y - line.y) <= h / 2) {
        line.text += it.str;
        line.h = Math.max(line.h, h);
      } else {
        lines.push({ text: it.str, y, h });
      }
    }

    const paras = [];
    let para = '';
    let prev;
    for (const line of lines) {
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // a big gap down, or a jump back up (next column), starts a paragraph
      if (prev && (prev.y - line.y > prev.h * 1.7 || line.y - prev.y > prev.h)) {
        paras.push(para);
        para = '';
      }
      if (!para) para = text;
      else if (/\p{L}-$/u.test(para)) para = para.slice(0, -1) + text;
      else para += ' ' + text;
      prev = line;
    }
    if (para) paras.push(para);
    return fixAccents(paras.join('\n\n'));
  }

  async function docxToText(file) {
    await loadScript(MAMMOTH);
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach((el) => el.remove());
    return doc.body.textContent.replace(/\n{3,}/g, '\n\n');
  }

  // LaTeX PDFs store accents as separate spacing characters before the letter
  // ("matem´atica", "indu¸c˜ao"); turn them back into composed letters.
  const COMBINING = { '´': '́', '`': '̀', 'ˆ': '̂', '˜': '̃', '¨': '̈', '¸': '̧', 'ˇ': '̌', '˚': '̊' };
  const fixAccents = (text) => text
    .replace(/([´`ˆ˜¨¸ˇ˚]) ?(\p{L})/gu, (_, accent, letter) => (letter === 'ı' ? 'i' : letter) + COMBINING[accent])
    .replace(/(\p{L})¸/gu, '$1̧')
    .normalize('NFC');

  const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

  async function read(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, '');
    // images have no text; the original file is the document
    if (IMAGES.includes(ext)) return { name, kind: 'image', content: '', original: file };
    let content;
    if (ext === 'pdf') content = await pdfToText(file);
    else if (ext === 'docx') content = await docxToText(file);
    else if (ext === 'html' || ext === 'htm') content = htmlToText(await file.text());
    else content = await file.text();
    return {
      name,
      kind: ext === 'markdown' ? 'md' : ext,
      content: content.trim(),
      original: ext === 'pdf' ? file : null,
    };
  }

  return { read, fixAccents, pdfjs };
})();
