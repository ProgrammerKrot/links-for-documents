# LinksDocs

Upload documents, highlight passages, and link highlights, whole documents and topics into a graph — like Obsidian's graph view, but for the documents you read.

## Run

Needs [Node.js](https://nodejs.org) (no other dependencies, no build step).

**Double-click to start** — the server starts and the app opens in your browser:

- **Windows:** `start.bat`
- **Linux:** `LinksDocs.desktop` (or `start.sh`). Some file managers ask once to allow launching it; on GNOME right-click → *Allow Launching*. If the files lost their executable bit (e.g. after unzipping), run `chmod +x start.sh LinksDocs.desktop`.

Keep the terminal window open while you work; closing it stops the server. Starting it again while it's already running just opens the browser tab.

Or from a terminal:

```bash
node server.js --open
```

then open http://localhost:5173.

## links.tr

The link network is saved to **`links.tr`** in the app folder, after every change (indicator in the top bar). It is JSON with:

- `documents` — id, name and type of each document
- `topics`
- `highlights` — which document, position, text and colour
- `links` — the two endpoints (`doc:…`, `hl:…`, `topic:…`) plus readable `from` / `to` descriptions

Several browser windows can work on the same `links.tr`: each checks the file every few seconds and picks up changes made elsewhere (or by hand in an editor), and a save that would overwrite changes it hasn't seen is refused by the server and merged instead. A tab still running an older version of the app can't save — reload it.

`links.tr` wins when the app starts, so you can edit it, version it in git or copy it to another machine. Document text and original PDFs stay in the browser (IndexedDB); if `links.tr` mentions a document this browser doesn't have, its highlights and links are kept and re-attach when you upload a file with the same name and type.

If the app is served by something other than `server.js`, it still works but keeps links only in the browser (“Browser only” in the top bar).

## How to use

- **Upload** Markdown (`.md`) and PDF files — `.txt`, `.docx` and `.html` work too (button or drag & drop).
  - Markdown is rendered formatted (headings, lists, code, tables, `[[wikilinks]]`) by the built-in renderer in `js/markdown.js`.
  - PDFs are shown as real pages (pdf.js canvas) with a selectable text layer on top, so you highlight right on the page. The original file is stored in the browser; ↗ opens it in a new tab. PDFs uploaded before originals were stored fall back to extracted text — re-upload them to get the page view. Detached LaTeX accents (`matem´atica`) are shown merged (`matemática`).
- **Images** (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, …) can be uploaded as documents too.
- **Areas**: drag a rectangle on an image, or on a PDF page with the ▭ button in the pane header switched on (Alt+drag works any time). An area is a highlight like any other — colour, caption (Rename), links, connector curves, a square node in the graph — and keeps a small thumbnail of the marked region that shows in its menu and in the graph tooltip.
- Documents appear in the graph as file icons, coloured by type (red PDF, purple Markdown).
- Notion-style look: each document is a page with an icon, title and properties (type, highlights, linked documents/topics — click a chip to open it). Light and dark themes follow the system; ◐ in the top bar switches.
- **Click a document node** in the graph (right) to open it. Click another one to open it **alongside**; a third replaces the pane you're not working in.
- **Select text** → pick a colour to highlight it, or *Highlight & start link*.
- **Link**: start a link from a highlight, the ⛓ button in a pane header (whole document), or a topic. Then click the target — a highlight, selected text, another ⛓, a library item, or any graph node. `Esc` cancels.
- Links between the two open documents are drawn as animated curves between the panes; new links animate in the graph too.
- **+ Topic** creates a topic node you can link anything to.
- Toggle **Highlights** in the graph toolbar to collapse highlights into their documents.
- Everything is saved in the browser (IndexedDB). Use **Export / Import** for backups or to move between machines.

## Code layout

| File | Purpose |
| --- | --- |
| `server.js` | Static server + `/api/links` read/write of links.tr |
| `start.bat`, `start.sh`, `LinksDocs.desktop` | Double-click launchers (Windows / Linux) |
| `js/store.js` | Data model, IndexedDB persistence, links.tr sync, change events |
| `js/importers.js` | File → text (PDF via pdf.js, DOCX via mammoth) |
| `js/markdown.js` | Dependency-free Markdown renderer |
| `js/pdfview.js` | PDF pages + text layer, lazy canvas rendering |
| `js/graph.js` | Canvas force-directed graph, link animations |
| `js/reader.js` | Side-by-side panes, highlighting, connector curves |
| `js/app.js` | UI wiring: linking flow, popups, library, upload |
| `js/samples.js` | Demo workspace |
