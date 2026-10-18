# Where every number comes from

This document exists so you never have to take the app's word for anything.
It is written so that a non-programmer can follow it, and so that an engineer
can check every claim in about ten minutes.

---

## The plain-English version

An Ableton project file (`.als`) is **not** audio. It is a text file that
Ableton compresses when you save it - the same way a `.docx` is a zip full of
text. Remove the compression and you can read it. It contains sentences like:

```
<Tempo> <Manual Value="95" />          ← "the tempo is 95"
<UserName Value="Am/c" />              ← "this track is called Am/c"
<CurrentStart Value="448" />           ← "a clip starts at beat 448"
```

Setlist opens that text and **copies those values**. It never listens to your
music, and it never guesses a tempo from how fast audio sounds. It is closer to
reading the recipe card than tasting the dish - slower to set up, but the number
on the card is exactly the number that was written there.

That is also why it is fast. Opening a big set in Live takes minutes because
Live loads samples, plugins and devices. Reading the text that describes the
set takes about 300 ms per project, because there is nothing to load.

## What the app guarantees

- **Read-only toward your projects.** It opens project files to read them. It
  never saves, renames, moves or deletes anything in your project folders. The
  files it creates are its own index and waveform cache (under `%APPDATA%\FC
  Live Manager 2026`), the MP3 listening copies it keeps for you in
  `Documents\Setlist Captures`, and - unless switched off in Settings - one
  Windows-startup entry so the app can open when you sign in.
- **No network.** No cloud, no account, no telemetry. Your projects never leave
  the machine. (The build script in `scripts/` only generates files locally.)
- **Every displayed value is checkable** with one command - see below.

---

## The table (for whoever asks)

| What you see | Where it comes from | Stored or calculated? |
|---|---|---|
| **BPM** | `<Tempo><Manual Value="…">` - one occurrence, inside `<MainTrack>` | **Stored.** Live's own number. It stores floats like `95.00001`, so the app rounds to 2 decimals. The raw text is printed by the verify tool. |
| **Time signature** | first `<RemoteableTimeSignature>` (`<Numerator>`, `<Denominator>`) | **Stored** |
| **Track count** | count of `<MidiTrack>`, `<AudioTrack>`, `<GroupTrack>`, `<ReturnTrack>` elements | **Stored** (master/return handling: returns are included; the master track is not counted) |
| **Track names** | `<EffectiveName>` (or `<UserName>` when the user renamed the track) | **Stored.** Every displayed name is proved to exist verbatim in the file. |
| **Structure map** | clip positions under `<ArrangerAutomation>` (`<CurrentStart>`/`<CurrentEnd>`) | **Stored.** Arrangement view only - Session clips are not drawn (see limits) |
| **Locators** | `<Locators>` | **Stored** |
| **Ableton version** | `<Ableton MajorVersion Creator …>` header | **Stored** |
| **Last saved, file size, version count** | Windows filesystem metadata, and files in `Backup/` | **Filesystem**, not from the file |
| **Length** | last arrangement clip end × 60 ÷ BPM | **Calculated** - no length is stored in an `.als` (see limits) |
| **Waveform drawing** | decoded from the audio render, for display only | **Calculated** (visual) |
| **Preview audio** | an audio file you drop onto a card / add with Add audio (kept as a `<Set Name>.mp3` listening copy in the captures folder), or one found next to the project and matched by name | **Matched or added by hand, not extracted** - labelled verified/unverified (see limits) |
| **Musical key** | - | **Deliberately not shown.** See below. |
| **Devices / plugins used** | - | **Deliberately not shown.** See below. |

## What is deliberately missing, and why

- **Musical key.** Live 12 stores scale per MIDI clip, not per song, and almost
  every clip in these projects keeps the default root (root C). A "key" column
  would be invented data. It is better to have no field than a wrong one.
- **Devices and plugins.** Extractable in principle, deliberately not attempted
  yet - an empty column is more honest than an unreliable one.

## Prove it yourself, in one command

```powershell
npm run verify -- "ash rap"     # one project, full evidence
npm run verify -- --all         # every indexed project, one line each
```

Real output for `ash rap beat.als`:

```
ash rap beat.als
  on disk   0.7 MB, last saved 2/12/2025 - this is Windows file info, not read from the .als
  inside    7.9 MB of text once the gzip wrapper is removed

  Tempo  (app shows: 95)
    proof      95 (raw text "95")
    byte 6,785,387 of the decompressed file
    raw text   …<SendsListWrapper LomId="0" /> <Tempo> <LomId Value="0" /> <Manual Value="95"…
    PASS
  ...
  Arrangement map  (app shows: 334 clips across 32 tracks)
    proof      every bar position exists in the file (334 starts + 334 ends checked verbatim)
    the card draws 28 rows of up to 120 bars, in file order; x is time in beats
    raw text   file holds 349 clips in total: 334 in the arrangement, 15 in Session-view slots (deliberately not drawn)
    PASS
  ...
```

Full sweep on this machine:

```
78 sets checked · 624 values compared against the raw XML · all agree · 25.7s
```

Zero disagreements means: for every project, the value the app displays was
found next to the exact XML tag it claims to come from.

### The version with no trust in my code at all

1. Copy any `.als` somewhere safe.
2. Rename it to `song.als.gz`, right-click → **Extract All** (Windows does gzip natively).
3. Open the extracted text in VS Code (Notepad will choke on large sets).
4. Search for `<Tempo>` - you will see the same `<Manual Value="95">` the app shows.

That is the whole data path for BPM. The rest is the same trick with different
tags.

## What could still be wrong

Volunteering this list is the point of the document:

1. **Length is a calculation**, not a stored value: it is where the last clip in
   the arrangement ends, converted to seconds at the set's tempo. A stray clip
   parked far to the right inflates it - two projects in this library show
   silly values (61:06, 47:37) for exactly that reason. Every other number is
   copied.
2. **The structure map is an arrangement view, not a screenshot.** Every bar is
   drawn from a stored start/end position (a "floor plan", not a photo), which
   has one consequence: clips living in **Session view** are not drawn, and the
   Length field ignores them too. Measured across this library: 45 of 78
   projects use Session clips at all, the heaviest is `jam love Project` at 41%
   of its clips, and **no project is Session-dominant** - so the map is
   meaningful for every project here. For a set built to be *played* from
   Session view, the map would look nearly empty and Length would be
   meaningless.
3. **The preview audio is a match, not a certainty.** A file is labelled
   verified only when its name matches the set name or the project folder name
   (`Ash Rap Beat_95BPM_D#minor Key Master File.wav` for `ash rap beat.als`;
   `demo 10.wav` for the folder `demo 10`, whose set inside is `ep 2`).
   Anything else - a slowed edit, a promo cut, a stray file - is shown with an
   amber badge naming the exact file, because the app cannot prove which song
   it is. Loose files in `Desktop`/`Downloads`/`Music`/`Documents` are only
   accepted when the name matches; anything else there is ignored outright
   (a `dialog.wav` on the Desktop is not shown as the preview of 78 projects -
   that mistake was made during development and is now guarded by
   `npm run test:matching`). When one file matches several projects (three sets
   are literally called `Untitled`), it goes to the one whose last save is
   closest in time to the file, and the app marks the match as contested.
   Right now: 12 of 15 previews are verified by name, 3 are unverified
   project-folder audio.
4. **Non-4/4 sets are untested in practice.** All 78 projects here are 4/4. The
   formula for other signatures is documented in `src/main/als.js` but has never
   been exercised on a real odd-meter set.
5. **No comparison against Ableton itself has been done.** The values match the
   bytes in the files, and one of the user's own bounces is named
   `…_95BPM_…` while its `.als` reads 95 - but nobody has yet opened the same
   project in Live and compared the two windows side by side.
6. **Previews are matches or hand-added files, not renderings.** The app never
   renders a set itself: you add audio by hand (drag a file onto a card, or use
   **Add audio**) and the app keeps one `<Set Name>.mp3` listening copy, or it
   matches audio already sitting near the project. Both paths are covered by
   `npm run test:previews` and `npm run test:drop`.

## The code to audit, if you want to go deep

| File | Lines | What it does |
|---|---|---|
| `src/main/als.js` | 190 | the entire `.als` reader - decompress, then read the tags |
| `scripts/verify-set.js` | 298 | the proof tool: raw string searches vs the app's values |
| `src/main/library.js` | 482 | which files count as projects, and preview selection |
| `src/main/previews.js` | 52 | dropped/added files → one MP3 listening copy per song |
| `src/main/mp3.js` | 114 | WAV → ~320 kbps MP3 listening copies (lamejs), chunked so the app stays responsive |

Nothing else in the app touches project files. There is no database, no native
module, no background service.
