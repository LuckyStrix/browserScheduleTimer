# Browser Schedule Timer

A tiny, no-dependency single-page app for tracking a weekly recurring schedule in the browser. The header shows a live countdown to the next event, or a countdown to the end of whatever's happening right now.

Everything lives in three files (`index.html`, `style.css`, `script.js`) and persists to `localStorage` — no build step, no backend.

## Features

- Add time blocks (start, end, label) per day of the week
- Live status header: counts down to the next block, or down to the end of the current one
- Copy a block from one day to another
- Delete blocks
- Overnight blocks (e.g. `23:00`–`07:00`) are handled correctly
- Import/export your schedule as JSON, for backup or moving between browsers

## Usage

Open `index.html` in a browser. That's it.

## Known limitations

- Single weekly recurrence only — no one-off dates or holidays
- No overlap detection between blocks on the same day
- Schedule is stored per-browser (`localStorage`); export/import is the way to move it elsewhere
