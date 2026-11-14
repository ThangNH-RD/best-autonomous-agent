# AIProve Autonomous Agent

A fully autonomous agent for the [AIProve](https://aiprove.fun) bounty board —
no human in the loop. It reads `skill.md` from the arena, signs in with its
own keypair, and enters and completes as many open bounties as it can on its
own. This repo is the entry for the **best-autonomous-agent** bounty
(0.3 GLD).

## How it works

```
skill.md ──> keypair ──> challenge/sign/verify ──> list bounties
                                                        │
                                              market data (CoinGecko / Stooq / Yahoo)
                                                        │
                              ┌──────────── classify each bounty ────────────┐
                              │ forecast yes/no, numeric, long/short → submit │
                              │ repo / creative / social / unknown → skip     │
                              └───────────────────────────────────────────────┘
                                                        │
                                                  report.json
```

1. **Discover** — `lib/skill.js` fetches `GET /skill.md` from the arena and
   parses the API base + endpoint table. Hard-coded defaults exist only as a
   fallback if the doc format changes.
2. **Identity** — `lib/auth.js` generates an ephemeral secp256k1 wallet in
   memory (`Wallet.createRandom()`). `AGENT_PRIVATE_KEY` may override it for
   a stable identity. Keys are never written to disk, never logged.
3. **Authenticate** — challenge → EIP-191 `personal_sign` → verify → Bearer
   session token.
4. **List** — `GET /api/bounties?status=open`.
5. **Market data** — `lib/market.js` fetches live prices from free keyless
   APIs: CoinGecko (BTC/ETH spot + 24h change); Yahoo chart API, Nasdaq
   quote API and Stooq daily CSV (SPY/GLD/NVDA closes, tried in that order
   and merged per symbol). If every source fails it uses last-known
   reference closes, flagged `stale: true` in the report.
6. **Classify + act** — `lib/predict.js` routes each bounty:
   - **yes/no** forecasts → `{ answer, confidence }` (momentum-following,
     confidence capped at 0.65)
   - **numeric** close forecasts → `{ value }` (anchored on last price,
     drift at most half the last move, capped ±1%)
   - **long/short** calls → `{ answer, confidence }` (same momentum rule)
   - **repo/code bounties** → skipped: submission needs a hosted `repoUrl` +
     commit and the agent has no git remote credentials
   - **PosterJudge creative/social bounties** (article, art, meme, video,
     X posts, referrals) → skipped: need human-judged creative work or a
     social account
   - **token-list forecasts** (e.g. top-5 new pons tokens) → skipped: no
     reliable public feed of new launches; a blind guess is not a clean entry
   - **best-autonomous-agent itself** → skipped: self-referential
7. **Report** — every attempt/skip is logged to stdout and written to
   `report.json` with HTTP status + submission id for each submit.

## Setup

Requires Node.js 18+ (uses native `fetch`).

```bash
npm install
```

## Running

**Dry-run is the default.** In dry-run mode the agent does the full loop —
auth and listing are real — but submissions are only logged, never sent.

```bash
node agent.js            # dry-run (default)
node agent.js --dry-run  # same, explicit
```

To submit for real, pass `--live`:

```bash
node agent.js --live
```

Options:

| flag / env | effect |
|---|---|
| `--live` | send real submissions (default is dry-run) |
| `--dry-run` | log submissions instead of sending (default) |
| `--report <path>` | where to write the run report (default `report.json`) |
| `API_BASE_URL` | arena base URL (default `https://aiprove.fun`) |
| `AGENT_PRIVATE_KEY` | stable identity instead of an ephemeral keypair |

Exit code is `0` when the loop completes. A fatal failure (skill.md
unreachable, auth rejected, bounty list failed) exits `1` and still writes
`report.json` with the error recorded.

## How the sandbox should run it

```bash
git clone <this repo>
cd <this repo>
npm install
API_BASE_URL=https://<staging-arena> node agent.js --live
# then inspect report.json:
#   summary.attempted / submitted / skipped, per-bounty status + submission ids
```

Notes for the sandbox:

- The agent needs outbound HTTPS to the arena plus CoinGecko, Stooq and
  Yahoo for market data. If market APIs are blocked, it falls back to
  reference closes and keeps going (flagged `stale` in the report).
- Each run generates a fresh ephemeral wallet unless `AGENT_PRIVATE_KEY`
  is set, so re-runs get a fresh agent identity.
- The agent only ever submits prediction payloads. It never posts bounties,
  never grades, never touches escrow, and never spends anything (entry is
  free; there is no payment step in the loop).
- `report.json` is the machine-readable record of the run; stdout is the
  human-readable log.

## Files

| file | what it does |
|---|---|
| `agent.js` | orchestrator: the full loop + report writing |
| `lib/skill.js` | fetch + parse `skill.md` (API discovery) |
| `lib/auth.js` | ephemeral wallet + challenge/sign/verify |
| `lib/client.js` | thin REST client over the parsed endpoints |
| `lib/market.js` | live prices with layered fallbacks |
| `lib/predict.js` | bounty classification + prediction heuristics |
| `transcript.md` | honest build log (architecture, test output, limits) |
| `report.json` | run report (generated, gitignored) |

## Known limitations

- **Repo bounties are out of reach for a fully autonomous loop.** The
  submission shape requires a hosted `repoUrl` + commit, and an agent with
  no git remote credentials cannot publish one. A sandbox could close this
  gap by providing a git remote + credentials via env; the agent would then
  need a code-generation stage per challenge.
- **Creative/social bounties need a human or a social account** (article,
  art, video, X posts, referrals). Skipped by design.
- **Prediction quality is intentionally simple** — one momentum input,
  confidence capped at 0.65. The goal of this entry is the autonomous loop,
  not a trading edge.
