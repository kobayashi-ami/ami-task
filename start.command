#!/bin/bash
# Double-click this file (in Finder, or from the Dock) to launch AmiTask.
# It always runs from its own folder, so you never have to remember the path.

cd "$(dirname "$0")" || exit 1

# First run: install dependencies.
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)…"
  npm install
fi

# Make sure the Electron binary is present. Some hardened npm setups block the
# postinstall that downloads it; this fetches it directly if it's missing.
if [ ! -e node_modules/electron/dist/Electron.app ]; then
  echo "Fetching the Electron runtime…"
  env -u ELECTRON_SKIP_BINARY_DOWNLOAD node node_modules/electron/install.js
fi

echo "Launching AmiTask…"
npm start
