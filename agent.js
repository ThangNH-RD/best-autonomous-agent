#!/usr/bin/env node
// agent.js — fully autonomous AIProve agent.
//
// The loop, end to end, with no human in the loop:
//   1. Fetch + parse skill.md from the arena (API discovery).
//   2. Generate an ephemeral wallet keypair in memory
//      (AGENT_PRIVATE_KEY env override for a stable identity).
//   3. Authenticate: challenge -> EIP-191 sign -> verify -> Bearer token.
//   4. List open bounties.
//   5. Fetch live market data (CoinGecko / Stooq / Yahoo, with fallbacks).
//   6. For each bounty: classify -> attempt (predict + submit) or skip
//      with a logged reason.
//   7. Write report.json and exit 0.
//
// Safety: DRY-RUN IS THE DEFAULT. Submissions are only sent with --live.
//   node agent.js            -> dry run (auth + list are real, submits logged only)
//   node agent.js --live     -> real run (submits for real)
//   API_BASE_URL=https://staging.example.com node agent.js --live
//
// Env: API_BASE_URL (default https://aiprove.fun), AGENT_PRIVATE_KEY (optional).
// Keys are never written to disk and never appear in logs or report.json.

const fs = require('fs');
const path = require('path');
const { fetchSkill } = require('./lib/skill');
const { loadWallet, authenticate } = require('./lib/auth');
const { makeClient } = require('./lib/client');
const { getMarketData } = require('./lib/market');
const { classify } = require('./lib/predict');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { live: false, reportPath: path.join(__dirname, 'report.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--live') args.live = true;
    else if (argv[i] === '--dry-run') args.live = false;
    else if (argv[i] === '--report' && argv[i + 1]) args.reportPath = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'usage: node agent.js [--live] [--dry-run] [--report <path>]\n' +
          '  default is --dry-run: submits are logged, never sent.\n' +
          '  --live sends real submissions to API_BASE_URL (default https://aiprove.fun).\n' +
          '  env: API_BASE_URL, AGENT_PRIVATE_KEY (optional stable identity).'
      );
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.live ? 'live' : 'dry-run';
  const apiBase = (process.env.API_BASE_URL || 'https://aiprove.fun').replace(/\/$/, '');
  const startedAt = new Date().toISOString();

  const report = {
    agent: null,
    handle: null,
    apiBase,
    mode,
    startedAt,
    finishedAt: null,
    skillMd: null,
    marketData: null,
    attempted: [],
    skipped: [],
    error: null,
    summary: null,
  };

  console.log(`[agent] starting in ${mode} mode against ${apiBase}`);

  try {
    // 1. Discover the API from skill.md.
    const skill = await fetchSkill(apiBase);
    report.skillMd = {
      fetched: true,
      declaredApiBase: skill.declaredApiBase,
      endpointsFound: skill.parsed.endpointRowsFound,
      docLength: skill.parsed.docLength,
    };
    console.log(
      `[skill] fetched skill.md (${skill.parsed.docLength} chars, ` +
        `${skill.parsed.endpointRowsFound} endpoint rows; doc declares base ${skill.declaredApiBase || 'n/a'})`
    );
    if (skill.declaredApiBase && skill.declaredApiBase !== apiBase) {
      console.log(`[skill] note: configured API_BASE_URL differs from the doc's declared base; using configured base`);
    }

    // 2. Identity: ephemeral wallet, in memory only.
    const { wallet, ephemeral } = loadWallet();
    report.agent = wallet.address;
    const handle = `auto-${wallet.address.slice(2, 10)}`;
    report.handle = handle;
    console.log(`[auth] agent address ${wallet.address} (${ephemeral ? 'ephemeral keypair, in-memory only' : 'AGENT_PRIVATE_KEY override'})`);

    // 3. Authenticate.
    const { token, expiresAt } = await authenticate(apiBase, skill.endpoints, wallet);
    console.log(`[auth] authenticated, token expires ${expiresAt || 'n/a'}`);
    const client = makeClient(apiBase, skill.endpoints, token);

    // 4. List open bounties.
    const bounties = await client.listOpenBounties();
    console.log(`[list] ${bounties.length} open bounties`);

    // 5. Market data (one fetch, shared by all predictions).
    const market = await getMarketData();
    report.marketData = {
      source: market.source,
      stale: market.stale,
      fetchedAt: market.fetchedAt,
      assets: market.assets,
    };
    console.log(
      `[market] source=${market.source}${market.stale ? ' (STALE fallback in use for some assets)' : ''} ` +
        Object.entries(market.assets).map(([k, v]) => `${k}=$${v.price}`).join(' ')
    );

    // 6. Classify + attempt/skip each bounty.
    for (const bounty of bounties) {
      const slug = bounty.slug;
      const decision = classify(bounty);
      if (decision.action === 'skip') {
        console.log(`[skip] ${slug}: ${decision.reason}`);
        report.skipped.push({ slug, title: bounty.title || null, reason: decision.reason });
        continue;
      }
      const built = decision.build(market);
      if (!built) {
        const reason = `no usable market anchor for ${decision.asset}; cannot build a ${decision.kind} prediction`;
        console.log(`[skip] ${slug}: ${reason}`);
        report.skipped.push({ slug, title: bounty.title || null, reason });
        continue;
      }
      const entry = {
        slug,
        title: bounty.title || null,
        kind: decision.kind,
        asset: decision.asset,
        prediction: built.prediction,
        reason: built.reason,
        status: null,
        httpStatus: null,
        submissionId: null,
        note: null,
      };
      if (!args.live) {
        entry.status = 'dry-run';
        entry.note = 'would submit (dry-run default; pass --live to send)';
        console.log(`[dry-run] ${slug}: would submit ${JSON.stringify(built.prediction)} — ${built.reason}`);
      } else {
        // Enter first (free; submit auto-enters, but explicit enter proves the full loop).
        try {
          const e = await client.enter(slug, handle);
          console.log(`[enter] ${slug}: HTTP ${e.status}`);
        } catch (e) {
          console.log(`[enter] ${slug}: failed (${e.message}); continuing to submit anyway`);
        }
        await sleep(300);
        const r = await client.submitPrediction(slug, built.prediction, handle);
        entry.httpStatus = r.status;
        entry.submissionId = r.json?.id || r.json?.submissionId || null;
        entry.status = r.ok ? 'submitted' : 'failed';
        entry.note = r.ok
          ? `HTTP ${r.status}${entry.submissionId ? ` id=${entry.submissionId}` : ''}`
          : `HTTP ${r.status}: ${r.text}`;
        console.log(`[submit] ${slug}: ${entry.note} — ${built.reason}`);
        await sleep(300);
      }
      report.attempted.push(entry);
    }

    // 7. In live mode, verify what the board recorded for us.
    if (args.live) {
      try {
        const mine = await client.mySubmissions();
        const count = Array.isArray(mine.json?.submissions)
          ? mine.json.submissions.length
          : Array.isArray(mine.json) ? mine.json.length : '?';
        console.log(`[verify] /api/me/submissions: HTTP ${mine.status}, ${count} submissions on record`);
      } catch (e) {
        console.log(`[verify] my-submissions check failed (${e.message})`);
      }
    }
  } catch (err) {
    report.error = err.message;
    console.error(`[fatal] ${err.message}`);
    report.finishedAt = new Date().toISOString();
    report.summary = summarize(report);
    fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2));
    console.log(`[report] wrote ${args.reportPath}`);
    process.exit(1);
  }

  report.finishedAt = new Date().toISOString();
  report.summary = summarize(report);
  fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2));
  console.log(`[report] wrote ${args.reportPath}`);
  console.log(
    `[done] open=${report.summary.open} attempted=${report.summary.attempted} ` +
      `submitted=${report.summary.submitted} skipped=${report.summary.skipped} (${mode})`
  );
  process.exit(0);
}

function summarize(report) {
  return {
    open: report.attempted.length + report.skipped.length,
    attempted: report.attempted.length,
    submitted: report.attempted.filter((a) => a.status === 'submitted').length,
    dryRunWouldSubmit: report.attempted.filter((a) => a.status === 'dry-run').length,
    failed: report.attempted.filter((a) => a.status === 'failed').length,
    skipped: report.skipped.length,
  };
}

main();
