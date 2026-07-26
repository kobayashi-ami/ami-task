# AmiTask

One task, written once, floating on your desktop inside an eerie black-ink soap
film — always in front of everything.

Two surfaces, deliberately at odds with each other:

- **The bubble** — a frameless, transparent, always-on-top window rendered with a
  WebGL shader: a near-black soap membrane with thin-film iridescence, a Fresnel
  rim, a slow wet glint, and oil-on-water flow. It hovers above every window and
  follows you across Spaces and full-screen apps. Your task glows faintly from
  inside it.
- **The note** — an Apple Lisa / 80s beige-workstation writing panel. A putty
  plastic enclosure with corner screws, 1-bit striped title chrome, a recessed
  phosphor display, and chunky beveled controls. It's meant to feel like a real
  object sitting on the desk in front of you.

## Run it (on your Mac)

```bash
npm install
npm start
```

- The bubble appears near the top-right of your screen and stays on top.
- **Drag** the bubble anywhere; its position is remembered.
- Hover it and click the **✎** to edit, or press **⌘⇧Space** anywhere.
- **Right-click** the bubble for Edit / Hide / Quit.
- In the note: **Enter** saves, **Shift+Enter** adds a new line, **Esc** cancels.
- The app lives in the **menu bar** (no Dock icon).

Your task is stored in a single JSON file under the app's Application Support
directory, along with the bubble's last position.

## Build a .app / .dmg

```bash
npm run dist
```

Produces a macOS build via `electron-builder` in `dist/`.

## Layout

```
src/
  main.js            Electron main process: windows, tray, persistence, IPC
  preload.js         Safe bridge exposed to both windows
  float/             The floating soap-film bubble (WebGL shader + task text)
  editor/            The Lisa-flavoured writing panel
```

## Notes

- Built and iterated on Linux; the transparent always-on-top behaviour and the
  Dock-hiding are macOS-targeted. Run it on macOS for the intended experience.
- Requires a GPU with WebGL (every modern Mac). If WebGL is unavailable the
  bubble degrades to transparent.
