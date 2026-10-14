#!/usr/bin/env sh
# Double-click (or run ./start.sh) to start LinksDocs: runs the local server and opens the app
# in your browser. Close the terminal window or press Ctrl+C to stop it.

cd "$(dirname "$0")" || exit 1

# Started from a file manager without a terminal? Reopen in one so the server can be stopped.
if [ ! -t 1 ] && [ -z "$LINKSDOCS_IN_TERMINAL" ]; then
  export LINKSDOCS_IN_TERMINAL=1
  for term in x-terminal-emulator gnome-terminal konsole xfce4-terminal mate-terminal lxterminal alacritty xterm; do
    if command -v "$term" >/dev/null 2>&1; then
      case "$term" in
        gnome-terminal) exec gnome-terminal -- sh "$0" ;;
        *) exec "$term" -e sh "$0" ;;
      esac
    fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  msg="Node.js is not installed. Install it (for example: sudo apt install nodejs) and run start.sh again."
  echo "$msg"
  command -v notify-send >/dev/null 2>&1 && notify-send "LinksDocs" "$msg"
  [ -t 0 ] && read -r _
  exit 1
fi

node server.js --open
[ -t 0 ] && { echo "Press Enter to close."; read -r _; }
