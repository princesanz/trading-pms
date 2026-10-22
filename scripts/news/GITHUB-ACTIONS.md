# Activate News Feed Ingestion

The workflow is `.github/workflows/news-ingest.yml` in `princesanz/trading-pms`.
It runs at minute 17 and 47 of every hour (UTC and WIB), plus manual dispatch.
Scheduled runs write to the existing Supabase news tables through the existing
worker RPCs. No migration is run by the workflow.

## 1. Add repository secrets

Open https://github.com/princesanz/trading-pms/settings/secrets/actions .
Select **New repository secret** for each of these names:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | The project URL for the same Supabase project as the applied news migration |
| `SUPABASE_SERVICE_ROLE_KEY` | The server-only service-role key or supported secret API key from that project |

Paste the values directly into GitHub. The existing PowerShell environment and
Vercel frontend variables do not populate GitHub Actions secrets. Neither key
names prefixed with `VITE_` nor the anon/publishable key authorize this worker.
Do not paste keys into YAML, commit messages, issues, screenshots or chat.

## 2. Publish the worker and workflow together

The workflow cannot run files that exist only on the laptop. Its required
runtime files are:

- `.github/workflows/news-ingest.yml`
- `scripts/news/worker.ts`
- `scripts/news/adapters.ts`
- `scripts/news/model.ts`
- `scripts/news/http.ts`
- `package.json` and the matching `package-lock.json`

The local checkout also contains unrelated SQL edits. Review selected files
before committing; do not use `git add .` for this rollout.

From the project directory, the following stages only the scheduler/runtime
files and their documentation, then displays the selection for review:

```powershell
git add -- .github/workflows/news-ingest.yml scripts/news/worker.ts scripts/news/adapters.ts scripts/news/model.ts scripts/news/http.ts scripts/news/README.md scripts/news/GITHUB-ACTIONS.md package.json package-lock.json
git diff --cached --stat
git diff --cached --check
```

Commit and publish that reviewed selection through the repository's normal
branch/PR workflow. The workflow must reach the default branch, currently
`main`, before schedule and manual dispatch are available. An existing Vercel
Git integration may deploy when `main` is updated, including dependency-only
changes. The News Terminal frontend is a separate local change and is not
included by the staging command above.

## 3. Validate manually on GitHub

Open https://github.com/princesanz/trading-pms/actions/workflows/news-ingest.yml .
If prompted, enable GitHub Actions for the repository.

1. Select **Run workflow**, branch `main`, source `all`, and enable `dry_run`.
2. Confirm all eight endpoints are logged with `dryRun: true`, zero rejected
   items, and `written: 0`. This checks connectivity from GitHub's runner;
   providers may treat cloud traffic differently from the laptop.
3. Select **Run workflow** again, branch `main`, source `all`, and disable
   `dry_run`.
4. Confirm each endpoint succeeds. A failed or partial endpoint fails the run.
5. Check the News Terminal sync badges, or run this read-only SQL query:

```sql
select source, status, last_attempt, last_success,
       fetched_count, rejected_count, written_count
from public.feed_sync_state
order by source;
```

Each configured endpoint should have a recent `last_success`. The worker's
`written` count describes accepted upsert inputs, not necessarily newly inserted
or globally unique articles. Skipped endpoints do not prove freshness; inspect
the last-success timestamps if the workflow is green but data is old.

## 4. Confirm the schedule

After the next scheduled run, verify a new Actions run and advancing sync times.
The workflow uses a shared concurrency group and never cancels an active run.
Database leases additionally protect against a laptop worker running at the
same time. Do not manually clear leases for a job that may still be running.

GitHub schedules can be delayed or dropped under load, so this is not a precise
30-minute delivery guarantee. Scheduled workflows run only on the default
branch; public repositories can have schedules disabled after inactivity.
See https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule .

Private repositories consume the account's Actions allowance. Check actual
usage under GitHub billing after several runs; do not assume unlimited free
execution. Failure notifications depend on the account's Actions notification
settings. A workflow that never starts cannot report its own failure; inspect
sync age and Actions history if the page becomes stale.

To pause ingestion, use **Actions → News Feed Ingestion → Disable workflow**.
To retry one source, dispatch manually and choose its endpoint. To change the
cadence, edit the schedule in the workflow and publish to the default branch.

## Runtime decisions

- Node.js 24 on a GitHub-hosted Ubuntu runner.
- Official checkout and Node setup actions pinned to verified v6 commit SHAs.
- Read-only GitHub token; checkout does not retain credentials.
- Locked npm dependencies and npm download cache; dev dependencies are required
  because the worker uses `tsx`.
- Secrets are passed only to the worker step, not install or summary steps.
- Job timeout 40 minutes, including 10 minutes to install and 30 minutes for the
  serial eight-endpoint worker under its worst-case retries.
- No push, PR or fork trigger can start ingestion. Manual runs from a
  non-default branch, and runs in repository forks, are skipped.
- No frontend build, database schema modification or article artifact upload.
