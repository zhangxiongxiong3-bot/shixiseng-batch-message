# shixiseng-batch-message

Codex Skill for previewing and batch-sending one fixed recruitment communication message to Shixiseng employer-side candidates.

## Safety Defaults

- Dry-run preview is the default.
- Formal sending requires the user to explicitly say `开始批量发送` or `确认发送`.
- The script also requires `--confirm-send` for send mode.
- Browser login state, screenshots, local send records, caches, and Playwright browser binaries are not committed.

## Commands

```powershell
npm install
npm run open
npm run inspect
npm run dry-run
npm run send -- --confirm-send
```

See `SKILL.md` for the operating rules and authorization boundary.
