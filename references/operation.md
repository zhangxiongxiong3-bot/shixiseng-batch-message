# Operation Notes

The automation is intentionally conservative.

- `open`: launches a persistent browser profile and opens the Shixiseng employer backend for login.
- `inspect`: captures visible page text, clickable element summaries, and screenshots under `artifacts/` so selectors can be adapted to the real page.
- `dry-run`: scans candidate/application rows, checks local send records and reachable chat history, and prints planned actions without sending.
- `send -- --confirm-send`: sends only to candidates that are not already recorded locally and whose chat history does not contain the fixed message.
- `resume -- --confirm-send`: same as send; failed and already-sent candidates are skipped based on local records.

The script stops if it sees likely verification, slider, captcha, or risk-control text during candidate processing.
