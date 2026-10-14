# LinksDocs

Upload documents, highlight passages, and link highlights, whole documents and topics into a graph — like Obsidian's graph view, but for the documents you read.

<img width="2111" height="847" alt="image" src="https://github.com/user-attachments/assets/b2b36785-60ae-4eb5-aef0-b8f4c9c283a0" />


<img width="1280" height="637" alt="image" src="https://github.com/user-attachments/assets/b62869b5-4f44-4316-8bad-6b1bfe89b809" />



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

