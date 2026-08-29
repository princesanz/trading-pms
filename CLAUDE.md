# Claude — trading-pms + sanz-brain

This project connects to Sanz's Obsidian second brain via MCP server `sanz-brain`.

Vault path: `C:\Users\SANZ\OneDrive\Dokumen\sanz-brain`

## Session startup (mandatory)

1. Always read `memory/INDEX.md` from sanz-brain first — every session, no exceptions
2. Skim `inbox/claude-inbox.md` for open handoffs
3. Read `[[Trading PMS Project]]` hub for current status / open items
4. Daily brief / market snapshot: **on request only** (run `bash scripts/daily-brief.sh`
   → `generated/LATEST.md`, or `fetch-market-snapshot.sh` for just prices). Run it
   when the session is about trading/analysis or Sanz asks — not automatically.
5. Only open full vault files (MEMORY.md, USER.md) if the task needs deep context

## Session end (mandatory)

Append a brief summary to sanz-brain `inbox/claude-inbox.md`:
- what was done in this session
- any decisions made
- handoffs to cursor/hermes/openclaw/antigravity if needed

Also append significant work to `memory/YYYY-MM-DD.md` (today's date).

## When to write to vault

Write to sanz-brain when:
- Sanz says "save", "remember", or "add to Obsidian"
- You make an important decision about this project
- You finish a meaningful chunk of work
- There is an insight worth reusing in future sessions

## Writing rules

- Write all vault content in English
- Tag entries: `[claude]`
- Never store API keys or passwords
- Follow `protocols/Agent Memory Protocol.md` in the vault
- Project hub note in vault: [[Trading PMS Project]]

## Full agent instructions

See vault file: `C:\Users\SANZ\OneDrive\Dokumen\sanz-brain\CLAUDE.md`
