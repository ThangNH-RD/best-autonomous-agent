# Build transcript — AIProve autonomous agent

Entry for the **best-autonomous-agent** bounty (0.3 GLD, closes 2026-11-15
20:49 +07). Built 2026-11-14 by an AI agent (Muse) for operator 0xair.ai.
No secrets in this file: the agent's keypair is ephemeral, generated in
memory at runtime, never written to disk, and discarded when the process
exits. The addresses below are throwaway run identities.

## What was built

A Node.js (CommonJS, ethers v6) agent that runs the full AIProve loop with
no human in the loop:

```
skill.md ──> keypair ──> challenge/sign/verify ──> list bounties
     ──> market data ──> classify each bounty ──> submit or skip ──> report.json
```

| file | role |
|---|---|
| `agent.js` | orchestrator: the loop, logging, `report.json`, exit codes |
| `lib/skill.js` | fetch + parse `skill.md` (API base + endpoint table) |
| `lib/auth.js` | ephemeral wallet (`Wallet.createRandom()`), `AGENT_PRIVATE_KEY` override, challenge/sign/verify |
| `lib/client.js` | thin REST client over the parsed endpoints |
| `lib/market.js` | live prices: CoinGecko, Yahoo, Nasdaq, Stooq, then a flagged stale fallback |
| `lib/predict.js` | bounty classification + prediction heuristics |

## Design decisions

1. **Dry-run is the default.** Submissions are only sent with `--live`.
   This protects the production arena from accidental submits while the
   sandbox grades the loop, and it is documented in the README.
2. **API discovery from skill.md, not hard-coded paths.** The agent parses
   the endpoint reference table (11 rows found) and the declared API base
   from the live doc; hard-coded paths exist only as a fallback.
3. **Conservative classification.** The agent attempts only bounties it can
   answer defensibly from data it has. A garbage submission is worse than
   a skip for a "clean loop" score, so repo, creative/social, referral and
   token-list bounties are skipped with a logged reason each.
4. **Simple, honest predictions.** One momentum input (24h/day change),
   confidence capped at 0.65, numeric closes anchored on the last price
   with drift capped at ±1%. No fabricated precision.
5. **Layered market-data fallbacks.** Four keyless sources, merged per
   symbol; if all fail, last-known reference closes are used and flagged
   `stale: true` in the report. The loop never dies on a price fetch.

## Test log (honest)

Three dry-runs against the real production API
(`https://aiprove.fun`), all with no `--live` flag — **no submission was
ever sent to the production arena**. Auth + bounty listing are free and
harmless; each run used a fresh ephemeral wallet.

### Run 1 — first end-to-end (2026-11-14 ~11:3x +07)

Loop completed, exit 0, 7 attempted / 15 skipped. But all three market
sources failed: the 10s fetch timeout was too short behind this VM's slow
egress proxy (CoinGecko alone takes ~19s), so every asset fell back to the
stale reference closes. The skill.md base regex also missed the declared
base (markdown `**` between the label and the URL), and the referral
bounty got a slightly wrong skip reason.

### Run 2 — after fixes (~11:4x +07)

Fixes: fetch timeout 10s → 30s; browser User-Agent on market calls
(Yahoo 429s bare clients); stock sources reordered to Yahoo → Nasdaq →
Stooq and merged per symbol in parallel; Stooq URL corrected to
`/q/d/l/` (still JS-challenge gated from this VM, kept as last resort);
skill.md base regex fixed; referral-specific skip reason added.

Result: live market data from CoinGecko + Yahoo, 7 attempted / 15
skipped, exit 0.

### Run 3 — final verification (~11:5x +07)

Full output (verbatim):

```
[agent] starting in dry-run mode against https://aiprove.fun
[skill] fetched skill.md (6722 chars, 11 endpoint rows; doc declares base https://aiprove.fun)
[auth] agent address 0x1b3020508a14b3e2A5f2f2903130fc6b88C502B0 (ephemeral keypair, in-memory only)
[auth] authenticated, token expires 1794717043595
[list] 22 open bounties
[market] source=coingecko+yahoo BTC=$66872 ETH=$1893.71 SPY=$754.37 GLD=$355.45 NVDA=$162.85
[skip] write-article-aiprove: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[skip] make-art-aiprove: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[skip] make-meme-aiprove: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[skip] refer-most-agents: referral bounty: needs other agents to enter via a referral link; not submittable in a single loop run
[skip] post-on-x-aiprove: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[dry-run] btc-tomorrow: would submit {"answer":"no","confidence":0.54} — BTC down 2.9% over the last period; momentum-following call
[skip] eth-pnl-fixed: repo bounty: submission requires a hosted repoUrl + commit, and this agent has no git remote credentials to publish one
[skip] aiprove-mascot: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[skip] explainer-video-aiprove: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[skip] sample-agent-skillmd: repo bounty: submission requires a hosted repoUrl + commit, and this agent has no git remote credentials to publish one
[dry-run] forecast-btc-7d: would submit {"answer":"no","confidence":0.54} — BTC down 2.9% over the last period; momentum-following call
[dry-run] spy-close-1dollar: would submit {"value":753} — anchor SPY last price $754.37, drift -0.18% (half of last move -0.36%)
[skip] top5-pons-24h: needs a live feed of newly launched tokens (pons); no reliable public source available, a blind guess is not a clean entry
[dry-run] forecast-eth-24h: would submit {"answer":"no","confidence":0.53} — ETH down 1.9% over the last period; momentum-following call
[dry-run] forecast-nvda-3d: would submit {"value":161.2} — anchor NVDA last price $162.85, drift -1.00% (half of last move -2.01%)
[dry-run] signal-eth-pnl-24h: would submit {"answer":"short","confidence":0.53} — ETH down 1.9% over the last period; momentum-following call
[dry-run] forecast-gold-tomorrow: would submit {"value":355.7} — anchor GLD last price $355.45, drift +0.08% (half of last move 0.16%)
[skip] code-golf-expr: repo bounty: submission requires a hosted repoUrl + commit, and this agent has no git remote credentials to publish one
[skip] fastest-primes: repo bounty: submission requires a hosted repoUrl + commit, and this agent has no git remote credentials to publish one
[skip] bug-hunt-utils: repo bounty: submission requires a hosted repoUrl + commit, and this agent has no git remote credentials to publish one
[skip] best-autonomous-agent: self-referential: this agent is the entry for this bounty; submitting to itself is circular
[skip] retweet-and-quote-the-launch-post: PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop
[report] wrote /home/hatch/workspace/aiprove/entries/best-autonomous-agent/report.json
[done] open=22 attempted=7 submitted=0 skipped=15 (dry-run)
EXIT=0
```

`report.json` summary verified after the run:

```json
{"open": 22, "attempted": 7, "submitted": 0, "dryRunWouldSubmit": 7, "failed": 0, "skipped": 15}
```

Market data in that run was fully live (`source: coingecko+yahoo`,
`stale: false`). The report was checked for key leakage (no 64-hex
private key material anywhere in it).

## What was NOT run

- **No live submission to the production arena.** The `--live` path
  (enter + submit + `/api/me/submissions` verification) is implemented
  and code-reviewed but has never been executed against production —
  deliberately, to avoid spending the operator's entries on a test run.
  The staging sandbox is expected to exercise it with `--live` against
  its own arena.
- **No test against a staging arena.** No staging URL was available at
  build time; `API_BASE_URL` exists for exactly that purpose.
- **Repo bounties were not attempted**, for the structural reason above
  (no git remote credentials in an autonomous loop). This is a known
  limitation, documented in the README.

## Environment notes

- Node v24.22.1, ethers v6.17.0 (installed locally, never global).
- This VM routes outbound HTTPS through an egress proxy; Node needs
  `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/hatch-egress-ca.pem` here. That is
  an environment quirk of the build machine, not a requirement of the
  agent itself.
- Total build time: ~35 minutes including three dry-runs and the market
  source debugging.
