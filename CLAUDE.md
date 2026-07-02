# Claude — trading-pms + sanz-brain

This project connects to Sanz's Obsidian second brain via MCP server `sanz-brain`.

Vault path: `C:\Users\SANZ\OneDrive\Dokumen\sanz-brain`

## Session startup (mandatory)

1. Always read `memory/INDEX.md` from sanz-brain first — every session, no exceptions
2. Check `inbox/claude-inbox.md` for pending tasks from other agents
3. AUTO-RUN market snapshot:
   - Run: `cd "C:\Users\SANZ\OneDrive\Dokumen\sanz-brain" && bash projects/sanz-capital/research/fetch-market-snapshot.sh`
   - Read the generated snapshot from `projects/sanz-capital/analysis/`
   - Report current prices to Sanz at session start
   - Only skip if Sanz explicitly says "no snapshot" or "skip market"
4. Only open full vault files (MEMORY.md, USER.md) if task requires deep context; read this project's code context as needed

## Market analysis protocol

After snapshot is loaded:
- Flag any XAUUSD move >0.5% from previous session
- Note BTC dominance direction if crypto prices available
- Check USD/IDR for IDX session relevance (threshold: >100 pip move)
- Append snapshot summary to `inbox/claude-inbox.md` with tag [MARKET]

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
