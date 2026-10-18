# HANDOFF BRIEF - FC Live Manager 2026 ("Setlist")

You are taking over a real, working Windows desktop app at **`C:\Users\Utsav\Downloads\ab`**. The owner (Utsav, a music producer) uses it daily and verifies claims himself. **One mission:**

## → Visual/UX redesign + polish, with full design freedom

The owner's words: it must **not look "vibe coded."** You have full freedom as a product designer - layout, typography, hierarchy, motion, everything - within the constraints in section 4.

Read this whole brief first.

---

## 1. What the product is

**Setlist / FC Live Manager 2026** - a self-managing library for Ableton Live projects. It reads `.als` files directly (gzipped XML, custom targeted scanner, ~0.5 s/project, cached), so the owner can browse **tempo, time signature, length, tracks, locators, a per-track arrangement minimap** and **one audio preview per song** - without opening Live.

- Previews are audio files, added by hand: **drag an MP3/WAV onto a project's card** or use **Add audio…** in the detail sheet. The app keeps one small listening copy per song (`<Set Name>.mp3`, ~320 kbps for converted WAVs) in `Documents\Setlist Captures`, and never touches the file you added.
- It also *matches* audio already sitting near a project (project folder, `Renders/`, `Exports/`, Desktop/Downloads/Music/Documents at root only - name-match required). Matching rules: `README.md` + `npm run test:matching`.
- Data roots: `Desktop`, `Documents\Ableton`, `Music`. Captures folder: `Documents\Setlist Captures` (exact string matters - the app and the docs agree on it).
- Honesty is a core product value: every displayed value is labeled as copied / calculated / matched, documented in `docs/PROVENANCE.md`. **Never invent data.**
- 78 projects on this machine; the user's live data is the demo set for design work.

## 2. Repo map, stack, how to run

Stack: **Electron 33 + React 19 + Vite 8 + Tailwind CSS 4** (shadcn-style components: radix + cva + clsx + tailwind-merge), sonner toasts, lucide icons, cmdk command palette, chokidar watcher, lamejs (MP3 encode in the main process).

```
src/main/       main.js (shell, IPC, range-aware media protocol), als.js (.als parser - the core),
                library.js (discovery, caching, preview selection), previews.js (dropped/added
                files → MP3 listening copies), mp3.js (lamejs 320 kbps), peaks.js (WAV/AIFF →
                waveform peaks), store.js (one-file JSON persistence), watcher.js
src/preload/    preload.js (contextBridge; renderer has NO node access)
src/renderer/   index.html loads the built bundle; sources in src/renderer/src/** (React),
                built by `npm run build:ui` (vite.config.mjs) into src/renderer/dist/**
                as a single IIFE for file:// loading; CSP script-src 'self'; Inter font bundled locally
scripts/        selftest.js, test-matching.js, test-previews.js, test-drop.js, index-cli.js,
                verify-set.js, crosscheck.js, probe-refs.js, build-icons.js
docs/           PROVENANCE.md et al.
```

Commands:

```powershell
npm install
npm start         # launch the app
npm run dev       # launch with devtools
npm run build:ui  # REQUIRED after any renderer edit (Vite build → src/renderer/dist)
npm run selftest  # headless Electron smoke test (must print SELFTEST_ERRORS [] and "selftest: OK")
npm run test:matching && npm run test:previews && npm run test:drop   # node gates
npm run verify -- "ash rap" / --all    # proof tool: raw .als bytes behind every displayed value
npm run index / check:renders / check:lengths                          # parser + provenance diagnostics
```

Rebuild-and-relaunch loop (Windows PowerShell; the owner often leaves the app running):

```powershell
npm run build:ui; Get-Process electron | Stop-Process -Force; Start-Process npm.cmd 'start'
```

Persisted user state (store.js + renderer): `sort`, `sortDir`, `view`, `pinned[]`, `hiddenPreviews{}`. "Remove audio from preview" only hides - never deletes (that contract must survive the redesign; a newer file comes back by itself).

## 3. How previews work now (the contract the UI must keep)

1. **Add:** drag an MP3/WAV onto a card (grid view) **or** onto the player in the detail sheet, **or** click **Add audio / Replace** → file picker. All three routes go through `attachPreview()` (`src/renderer/src/lib/attach-preview.js`) → IPC `preview:drop` → `importDroppedPreview()` (`src/main/previews.js`).
2. **Copy, never move:** the app writes `<Set Name>.mp3` (`.part` → rename) into the captures folder; the source file stays where it was. WAVs are converted with lamejs (~320 kbps, any PCM flavor); MP3s are copied byte-for-byte. One listening copy per song - a newer file replaces the old copy; there is never a pile-up.
3. **Verified vs unverified:** a listening copy is named after the set, so it counts as verified. Files matched elsewhere keep the amber/unverified treatment with plain-words provenance (`src/renderer/src/lib/provenance.js`). Keep that language honest.
4. **Remove:** hides the preview for that project (`hiddenPreviews` timestamp) without touching the file; anything newer than the removal comes back automatically.
5. **Stale ⟳:** preview older than the current `.als` save → amber ⟳ badge with an explanation tooltip.
6. **Waveforms:** WAV/AIFF peaks are computed in the main process and cached by path+mtime (`peaks.js`); MP3/M4A are decoded in the renderer on first open (`src/renderer/src/lib/peaks-client.js`) - every preview draws a real waveform.

## 4. The visual redesign (full freedom, with guardrails)

Current UI: dark zinc + amber accent (tokens in `src/renderer/src/index.css`, dark-only, Inter + mono numerals), grid/list of project cards (slow sheen on the minimap), a player with waveform, detail sheet, settings sheet, command palette, status bar. Components in `src/renderer/src/components/**`.

**Non-negotiable constraints**

- Offline app: **no remote assets/fonts**; CSP stays `script-src 'self'`; keep the Vite single-IIFE build for `file://` (`npm run build:ui`).
- Performance: 78 (hundreds of) projects must stay instant; 60 fps scrolling (virtualize if needed); waveform drawing stays cheap.
- `prefers-reduced-motion` honored in every animation.
- All existing features, behaviors, persisted keys and gates survive (`selftest`, `test:matching`, `test:previews`, `test:drop`).
- Dark-first (a light theme is optional). Keyboard accessible (command palette, focus states, "/" search, Space to play).
- The preview-listening experience is the heart: one song at a time, waveform seeking over the range-aware media protocol, drag-a-file-to-set-preview - don't degrade any of it.
- Keep the data-testid hooks the self-test probes (`project-card`, `detail-sheet`, `wave`, `play-btn`, …) or update `main.js` `runSelfTest()` in the same change.

**Directions (fuel, not a cage)**

- A precision-instrument / "studio hardware" aesthetic (Ableton / Teenage Engineering energy): strong typographic scale, tight grid discipline, quiet chrome, data-dense but breathable, waveform as the hero.
- Real design system: spacing/type/color/motion tokens, consistent radii, deliberate states (hover/focus/active/disabled/loading/empty/error).
- Designed details: card composition (BPM/tracks/length readouts, arrangement minimap as the visual signature, verified/unverified/stale badges), a distinctive player/transport, beautiful empty & first-run states, toasts that match the system, a tasteful "new preview landed" flash.
- Micro-interactions that inform - subtle, tasteful, reduced-motion-safe.
- Welcome feature polish (optional): continue-listening, auto-play-next, volume/mute memory, window-size memory, date-added sort, search tokens (`bpm:120-130`), drag-a-file-anywhere-to-pick-a-project affordance.

**Deliverables** - redesigned library view (grid + list), player, detail sheet, settings, command palette, plus a short written design rationale (tokens, type scale, motion choices). Verify by running the app with the real library and screenshotting real states.

## 5. Engineering rules

- Windows + PowerShell. No git: keep `.bak` copies before risky rewrites (a full pre-cleanup copy exists in `_backup-before-manual-previews/`).
- After renderer edits: `npm run build:ui`, then relaunch Electron (command in section 2).
- Gates that must stay green after ANY change: `npm run selftest`, `test:matching`, `test:previews`, `test:drop`.
- Never claim something was verified unless it was; when reporting, be precise about what was checked mechanically vs. by eye.
- The owner communicates short and direct; report honestly, with exact evidence (file paths, command output).

## 6. Definition of done

The app looks and feels designed by a product designer (the bar: "doesn't look vibe-coded"); every screen state polished; all features work; all gates green; `npm start` works; the preview flow (drop / Add audio / play / seek / remove / stale) survives untouched.

## 7. Reference files to read before touching anything

- `README.md` (app: features, matching rules, `.als` format notes) - keep its claims true.
- `docs/PROVENANCE.md` (the honesty contract).
- `src/renderer/src/index.css` (current design tokens) and `src/renderer/src/app.jsx` + `components/**`.
- `src/main/previews.js` + `src/main/library.js` (how a file becomes a preview / how previews are matched).
- Live data to test against: `C:\Users\Utsav\Documents\Setlist Captures` (listening copies), the 78 indexed projects under Desktop / Documents\Ableton / Music.
