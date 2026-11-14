// market.js — live price data from free public APIs, with layered fallbacks.
//
// Sources (all keyless; a browser User-Agent is sent because several of
// these edge-gate bare programmatic clients):
//   1. CoinGecko simple/price — BTC + ETH spot and 24h change.
//   2. Yahoo Finance chart API (query2) — SPY / GLD / NVDA last close + day change.
//   3. Nasdaq quote API — same stocks, different provider.
//   4. Stooq daily CSV — same stocks (JS-challenge gated from some networks).
//   5. FALLBACK_REFERENCE — last-known closes, flagged `stale: true`.
//      A stale fallback still lets the loop complete; the report says so.
// Stock sources are tried in order and merged per symbol: the first source
// that returns a symbol wins it, so a partial failure costs nothing.
//
// Output shape:
//   {
//     source: 'coingecko+stooq' | 'coingecko+yahoo' | ... | 'fallback-reference',
//     stale: boolean,
//     fetchedAt: ISO string,
//     assets: {
//       BTC:  { price, change24hPct },   // change may be null
//       ETH:  { price, change24hPct },
//       SPY:  { price, changeDayPct },
//       GLD:  { price, changeDayPct },
//       NVDA: { price, changeDayPct },
//     }
//   }

const FALLBACK_REFERENCE = {
  // Last-known closes (2026-11-14, recorded when this agent was built).
  // Only used when every live source fails; flagged stale in the report.
  BTC: { price: 67400, change24hPct: -2.8 },
  ETH: { price: 1920, change24hPct: -3.7 },
  SPY: { price: 754.37, changeDayPct: null },
  GLD: { price: 355.45, changeDayPct: null },
  NVDA: { price: 162.85, changeDayPct: null },
};

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' };
const TIMEOUT_MS = 30000; // public APIs behind slow proxies can take >10s

async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function coingeckoCrypto() {
  const j = await fetchJson(
    'https://api.coingecko.com/api/v3/simple/price' +
      '?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true'
  );
  const out = {};
  if (j.bitcoin?.usd) {
    out.BTC = { price: j.bitcoin.usd, change24hPct: j.bitcoin.usd_24h_change ?? null };
  }
  if (j.ethereum?.usd) {
    out.ETH = { price: j.ethereum.usd, change24hPct: j.ethereum.usd_24h_change ?? null };
  }
  if (!out.BTC && !out.ETH) throw new Error('CoinGecko returned no prices');
  return out;
}

// Stooq daily CSV: "Date,Open,High,Low,Close,Volume" — last two rows give the
// latest close and the day-over-day change. Symbols: spy.us, gld.us, nvda.us.
// Note: Stooq serves a JS proof-of-work challenge from some networks; a
// non-CSV response simply yields no symbols here.
async function stooqStocks() {
  const jobs = [['spy.us', 'SPY'], ['gld.us', 'GLD'], ['nvda.us', 'NVDA']].map(
    async ([sym, key]) => {
      const csv = await fetchText(`https://stooq.com/q/d/l/?s=${sym}&i=d`);
      const rows = csv.trim().split('\n').slice(1).filter((r) => r.includes(','));
      if (rows.length < 1) return null;
      const last = rows[rows.length - 1].split(',');
      const close = parseFloat(last[4]);
      if (!Number.isFinite(close)) return null;
      let changeDayPct = null;
      if (rows.length >= 2) {
        const prev = parseFloat(rows[rows.length - 2].split(',')[4]);
        if (Number.isFinite(prev) && prev > 0) {
          changeDayPct = ((close - prev) / prev) * 100;
        }
      }
      return [key, { price: close, changeDayPct }];
    }
  );
  const out = {};
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'fulfilled' && r.value) out[r.value[0]] = r.value[1];
  }
  if (Object.keys(out).length === 0) throw new Error('Stooq returned no closes');
  return out;
}

// Yahoo chart API (no key): 5-day daily bars, last close + day change.
async function yahooStocks() {
  const jobs = ['SPY', 'GLD', 'NVDA'].map(async (key) => {
    const j = await fetchJson(
      `https://query2.finance.yahoo.com/v8/finance/chart/${key}?range=5d&interval=1d`
    );
    const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const valid = closes.filter((c) => typeof c === 'number');
    if (valid.length < 1) return null;
    const close = valid[valid.length - 1];
    let changeDayPct = null;
    if (valid.length >= 2) {
      changeDayPct = ((close - valid[valid.length - 2]) / valid[valid.length - 2]) * 100;
    }
    return [key, { price: close, changeDayPct }];
  });
  const out = {};
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'fulfilled' && r.value) out[r.value[0]] = r.value[1];
  }
  if (Object.keys(out).length === 0) throw new Error('Yahoo returned no closes');
  return out;
}

// Nasdaq quote API (no key): lastSalePrice + percentageChange.
async function nasdaqStocks() {
  const jobs = [['SPY', 'etf'], ['GLD', 'etf'], ['NVDA', 'stocks']].map(async ([key, assetclass]) => {
    const j = await fetchJson(`https://api.nasdaq.com/api/quote/${key}/info?assetclass=${assetclass}`);
    const pd = j?.data?.primaryData;
    if (!pd?.lastSalePrice) return null;
    const price = parseFloat(String(pd.lastSalePrice).replace(/[$,]/g, ''));
    if (!Number.isFinite(price)) return null;
    const changeDayPct = pd.percentageChange != null
      ? parseFloat(String(pd.percentageChange).replace('%', ''))
      : null;
    return [key, { price, changeDayPct: Number.isFinite(changeDayPct) ? changeDayPct : null }];
  });
  const out = {};
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'fulfilled' && r.value) out[r.value[0]] = r.value[1];
  }
  if (Object.keys(out).length === 0) throw new Error('Nasdaq returned no closes');
  return out;
}

async function getMarketData() {
  const assets = {};
  const sources = [];
  let stale = false;

  try {
    Object.assign(assets, await coingeckoCrypto());
    sources.push('coingecko');
  } catch (e) {
    console.log(`[market] CoinGecko failed (${e.message}); crypto falls back`);
  }

  // Stock sources in order; each fills only the symbols still missing.
  for (const [name, fn] of [['yahoo', yahooStocks], ['nasdaq', nasdaqStocks], ['stooq', stooqStocks]]) {
    if (assets.SPY && assets.GLD && assets.NVDA) break;
    try {
      const got = await fn();
      let added = 0;
      for (const [k, v] of Object.entries(got)) {
        if (!assets[k]) { assets[k] = v; added++; }
      }
      if (added > 0) sources.push(name);
    } catch (e) {
      console.log(`[market] ${name} failed (${e.message})`);
    }
  }

  for (const key of Object.keys(FALLBACK_REFERENCE)) {
    if (!assets[key]) {
      assets[key] = { ...FALLBACK_REFERENCE[key] };
      stale = true;
    }
  }

  return {
    source: sources.length ? sources.join('+') : 'fallback-reference',
    stale,
    fetchedAt: new Date().toISOString(),
    assets,
  };
}

module.exports = { getMarketData, FALLBACK_REFERENCE };
