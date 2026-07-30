# AmiTask

> ### ▶︎ 起動 / Launch
> ```bash
> cd ~/ami-task && npm start
> ```
> Or just **double-click `start.command`** (nothing to remember).
>
> **One-time setup** — make a Spotlight-/Dock-launchable **AmiTask** app with the
> bubble icon:
> ```bash
> bash ~/ami-task/scripts/install-mac.command
> ```
> Then launch it with **⌘Space → “AmiTask”**, or pin it to the Dock.

A floating **command post** for people who juggle several vibe-coding projects
across Codex / Claude Code / Manus / GitHub and keep losing the thread of
"wait — where was I on this one?".

Each project is a **black-ink soap-film bubble** that floats on your desktop,
always in front of everything, showing that project's **NOW** (the one thing
you're doing) and glowing with its status colour. Behind them sits a single
**mission-control panel** styled like an Apple Lisa / 80s beige workstation,
where every project carries the fields that actually remove the "where am I?"
cost:

- **Why** — what you're building (1–2 lines)
- **Now** — the one thing you're doing (shown inside the bubble)
- **Next** — up to three next actions
- **Blocker** — what's stuck
- **Branch** — read automatically from the local git repo
- **Links** — GitHub / Claude / Codex / Manus / Docs + the local folder
- **Status** — 🟢 on track · 🟡 on hold · 🔴 blocked (tints the membrane)

The bubble is the eerie, always-present *current position*. The panel is the
full context, one keypress away.

## Run it (on your Mac)

```bash
npm install
npm start
```

- A bubble appears for each project and stays on top, across Spaces and
  full-screen apps.
- **Drag** a bubble anywhere; its position is remembered per project.
- Hover a bubble and click **✎**, or press **⌘⇧Space**, to open mission control.
- **Right-click** a bubble to jump straight to its GitHub / folder / links,
  hide it, or quit.
- **⌘1–9** jumps to a project (and marks it current).
- The app lives in the **menu bar** — no Dock icon.

## Branch & "last touched" — automatic, no token

Register each project's **local repo path** in the panel. AmiTask reads the
current branch from `.git/HEAD` and the last-modified time of the folder — all
offline, no GitHub token or network required.

## Data

Everything (projects, statuses, links, bubble positions) lives in a single JSON
file under the app's Application Support directory.

## Build a .app / .dmg

```bash
npm run dist
```

## Layout

```
src/
  main.js       Electron main: bubbles, mission-control panel, git, tray, IPC
  preload.js    Safe bridge exposed to every window
  float/        The floating soap-film bubble (WebGL shader + project NOW)
  editor/       The Lisa-flavoured mission-control panel
```

## Notes

- Built and iterated on Linux; the transparent always-on-top behaviour and
  Dock-hiding are macOS-targeted. Run it on macOS for the intended experience.
- Requires WebGL (every modern Mac).

## License & credits

- AmiTask is released under the MIT License (see `LICENSE`).
- The bundled **Hina Mincho** typeface (`src/float/fonts/hina-mincho/`) is by
  the Hina Mincho Project Authors, licensed under the SIL Open Font License
  1.1 — see `src/float/fonts/hina-mincho/OFL.txt`.
