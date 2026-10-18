# Setlist - design rationale ("console")

The brief bar: *it must not look vibe-coded*. The system below is the answer -
one idea, applied everywhere, so the app reads as a designed object rather
than a pile of defaults.

## The one idea

**The app is a piece of studio hardware.** A dark chassis holds panels; each
project card carries a little screen (the arrangement minimap); the preview
player is the main display; data reads like an LCD - mono tabular numerals,
uppercase micro-labels. Chrome stays quiet so the two things that carry
information - the waveform and the minimap - are the heroes. This is the
Ableton / Teenage Engineering register: precision-instrument, not dashboard.

## Tokens (`src/renderer/src/index.css`)

Layers, dark → light: `--background` (the chassis, oklch 0.135) → `--card`
(a panel set into it, 0.178) → `--popover` (floating), and the one inverted
layer `--well` (0.115) - *darker than the chassis* - for inset displays only
(minimap, waveform, the search field). Panels are distinguished by hairlines
(`--border` at white/8%) and the well's inset shadow, not by heavy fills, so
hundreds of cards breathe at 60 fps.

Signal colors, exactly two, always meaning the same thing: amber `--primary`
= *live/active/attention* (playing, selected, BPM readouts, progress), green
`--audio` = *audio exists* (preview badges, the Watching dot). Blue `--midi`
marks MIDI clips inside the arrangement maps; red only for read errors. Everything else
is zinc. The previous theme let amber and green mean several things; now a
color is a fact, not a decoration.

Type: Inter (variable, local file - no remote fonts, CSP untouched). One
micro-label primitive `.label-micro` (9.5px, +0.14em tracking, uppercase,
muted) is the *only* label voice in the app - column heads, "BPM", stat keys,
section titles. Body is 12–13px; every number that could be compared is
`font-mono` + `tabular-nums`.

Radius: `--radius: 0.5rem`, cards `rounded-lg`, chips and wells `rounded-md`,
state chips squared (`rounded-sm`) - screens are rectangular, toggles are
round. Motion: one ease for everything, `--ease-out-soft`
`cubic-bezier(0.22,1,0.36,1)`, 150 ms for state changes; the two signature
animations (fresh-preview glow, card sheen) keep their longer timings and
both collapse under `prefers-reduced-motion`, as do spin/ping/pulse.

## What changed, surface by surface

- **Top bar** - three zones: nameplate (mark in a bordered chip, wordmark,
  "2026" as a micro-label), the search well, and one *connected control
  cluster*: sort, filters, view, rescan, settings share a single bordered
  group with hairline dividers - controls on a panel, not buttons floating
  in space.
- **Project card** - recomposed as faceplate + screen + data strip. The BPM
  moved into a small LCD window (hairline left rule, mono, micro-label); the
  minimap sits in a `.well` with faint scanlines and an inset shadow; the
  meta row is a mono readout (`3d ago · 4:32 · 12 trk · 3 ver`) instead of
  mixed text. State chips are squared and keep their plain-words tooltips.
- **Grid / skeleton / empty** - the skeleton mirrors the new card footprint;
  the empty state sits on a dashed panel with the mark, so first run looks
  staged, not broken.
- **List** - micro-label column heads (active sort in amber), sticky header
  gains blur so rows slide under it, the playing row tints amber at 5%.
- **Player (detail sheet)** - the heart. Wave grew from h-16 to h-24 in a
  real well with scanlines; the cursor carries an amber glow; the transport
  button is a proper 36px round control; time reads `elapsed / duration`
  with elapsed in foreground mono. Seeking, range-audio, and the bus
  (one song at a time) are untouched.
- **Detail sheet / settings** - stat grid keys and section titles all speak
  `.label-micro`; nothing structural moved.
- **Status bar** - matches the top bar's faceplate tint; the Watching pulse
  is the one green heartbeat.

## Constraints honored

Offline (fonts local, no new assets, CSP unchanged), all `data-testid`s,
aria-labels, keyboard handlers, persisted keys and behaviors preserved;
`prefers-reduced-motion` collapses every animation; no new dependencies.
Verify with `npm run build:ui`, then the gate suite in `package.json`.
