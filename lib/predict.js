// predict.js — bounty classification + prediction heuristics.
//
// Classification is deliberately conservative: the agent only attempts a
// bounty when it can produce a well-formed, defensible submission from data
// it actually has. Everything else is skipped with a logged reason — a
// garbage submission is worse than a skip for a "clean loop" score.
//
// Prediction shapes (from skill.md):
//   yes/no      -> { answer: 'yes'|'no', confidence: 0..1 }   (Brier-scored)
//   long/short  -> { answer: 'long'|'short', confidence }     (PnL-scored)
//   numeric     -> { value: number }                          (abs-error-scored)
//
// Heuristic (simple, defensible, documented):
//   - Direction follows short-term momentum: the sign of the last 24h/day
//     change. Momentum is a weak but positive-evidence signal at 1-7 day
//     horizons and beats a coin flip; confidence scales with |change|.
//   - Confidence is capped at 0.65 — the agent never claims high certainty
//     from one momentum input, which also bounds Brier loss when wrong.
//   - Numeric closes anchor on the last close/price and drift at most half
//     of the last move, capped at +/-1%.

const ASSETS = ['BTC', 'ETH', 'SPY', 'GLD', 'NVDA'];

function clampConfidence(x) {
  return Math.min(0.65, Math.max(0.5, Math.round(x * 100) / 100));
}

function momentumConfidence(changePct) {
  if (changePct == null || !Number.isFinite(changePct)) return 0.52;
  return clampConfidence(0.5 + Math.min(Math.abs(changePct), 10) * 0.015);
}

function detectAsset(bounty) {
  const hay = `${bounty.slug || ''} ${bounty.title || ''} ${bounty.brief || ''}`.toUpperCase();
  for (const a of ASSETS) {
    if (new RegExp(`\\b${a}\\b`).test(hay)) return a;
  }
  if (/GOLD/.test(hay)) return 'GLD';
  return null;
}

function predictYesNo(asset, market) {
  const m = market.assets[asset] || {};
  const chg = m.change24hPct ?? m.changeDayPct ?? null;
  const answer = chg != null && chg > 0.5 ? 'yes' : 'no';
  const confidence = momentumConfidence(chg);
  const reason =
    chg == null
      ? `no momentum data for ${asset}; defaulting to "no" at low confidence`
      : `${asset} ${chg >= 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(1)}% over the last period; momentum-following call`;
  return { prediction: { answer, confidence }, reason };
}

function predictLongShort(asset, market) {
  const m = market.assets[asset] || {};
  const chg = m.change24hPct ?? m.changeDayPct ?? null;
  const answer = chg != null && chg > 0 ? 'long' : 'short';
  const confidence = momentumConfidence(chg);
  const reason =
    chg == null
      ? `no momentum data for ${asset}; defaulting to "short" at low confidence`
      : `${asset} ${chg >= 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(1)}% over the last period; momentum-following call`;
  return { prediction: { answer, confidence }, reason };
}

function predictNumeric(asset, market) {
  const m = market.assets[asset] || {};
  const anchor = m.price;
  if (anchor == null || !Number.isFinite(anchor)) {
    return null; // no anchor price -> cannot predict; caller skips
  }
  const chg = m.changeDayPct ?? m.change24hPct ?? 0;
  const driftPct = Math.max(-1, Math.min(1, 0.5 * (Number.isFinite(chg) ? chg : 0)));
  const value = Math.round(anchor * (1 + driftPct / 100) * 10) / 10;
  const reason = `anchor ${asset} last price $${Math.round(anchor * 100) / 100}` +
    (chg ? `, drift ${driftPct >= 0 ? '+' : ''}${driftPct.toFixed(2)}% (half of last move ${chg.toFixed(2)}%)` : ', no recent move data, flat forecast');
  return { prediction: { value }, reason };
}

/**
 * Classify one bounty. Returns:
 *   { action: 'attempt', kind, asset, build: (market) => {prediction, reason} }
 *   { action: 'skip', reason }
 */
function classify(bounty) {
  const brief = (bounty.brief || '').toLowerCase();
  const slug = bounty.slug || '';
  const cat = (bounty.cat || '').toLowerCase();

  // Self-referential: this repo IS the entry for best-autonomous-agent.
  if (slug === 'best-autonomous-agent') {
    return { action: 'skip', reason: 'self-referential: this agent is the entry for this bounty; submitting to itself is circular' };
  }

  // Token-list forecasts need a live source of new launches we do not have.
  if (/name five tokens|top 5 .*tokens|freshly launched/.test(brief)) {
    return { action: 'skip', reason: 'needs a live feed of newly launched tokens (pons); no reliable public source available, a blind guess is not a clean entry' };
  }

  // Long/short directional calls.
  if (/long or short|long\/short/.test(brief)) {
    const asset = detectAsset(bounty) || 'ETH';
    return {
      action: 'attempt', kind: 'long-short', asset,
      build: (market) => predictLongShort(asset, market),
    };
  }

  // Yes/no direction forecasts.
  if (cat === 'forecast' && /yes or no|yes\/no|submit yes or no/.test(brief)) {
    const asset = detectAsset(bounty);
    if (!asset) return { action: 'skip', reason: 'yes/no forecast but no recognizable asset in the brief' };
    return {
      action: 'attempt', kind: 'yes-no', asset,
      build: (market) => predictYesNo(asset, market),
    };
  }

  // Single-number close forecasts.
  if (cat === 'forecast' && /submit (one|a single) number/.test(brief)) {
    const asset = detectAsset(bounty);
    if (!asset) return { action: 'skip', reason: 'numeric forecast but no recognizable asset in the brief' };
    return {
      action: 'attempt', kind: 'numeric', asset,
      build: (market) => predictNumeric(asset, market),
    };
  }

  // Repo / code bounties: submission needs a hosted repoUrl + commit.
  if (cat === 'development' || cat === 'trading' || /submit the repo|repo at one commit|github\.com\/\S+\/aiprove\/tree\/main\/challenges/.test(brief)) {
    return { action: 'skip', reason: 'repo bounty: submission requires a hosted repoUrl + commit, and this agent has no git remote credentials to publish one' };
  }

  // Referral bounties need other agents to arrive via a referral link —
  // not something a single loop run can produce.
  if (/referral/i.test(brief)) {
    return { action: 'skip', reason: 'referral bounty: needs other agents to enter via a referral link; not submittable in a single loop run' };
  }

  // Poster-judged creative / social bounties.
  if (bounty.lane === 'PosterJudge' || ['content', 'design', 'marketing'].includes(cat)) {
    return { action: 'skip', reason: 'PosterJudge creative/social bounty: needs human-judged creative work or a social-media account, outside a fully autonomous loop' };
  }

  return { action: 'skip', reason: `unrecognized bounty shape (cat=${cat || '?'}, lane=${bounty.lane || '?'}) — no safe submission path` };
}

module.exports = { classify, detectAsset, clampConfidence };
