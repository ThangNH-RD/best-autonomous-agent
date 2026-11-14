// skill.js — fetch and parse the AIProve skill.md.
//
// The agent discovers the API surface from the skill document itself instead
// of hard-coding every path. Parsed values are verified against sane
// expectations; anything missing falls back to the documented defaults so a
// doc reformat never bricks the loop.

const DEFAULT_ENDPOINTS = {
  challenge: '/api/auth/challenge',
  verify: '/api/auth/verify',
  bounties: '/api/bounties',
  bountyDetail: '/api/bounties/:slug',
  enter: '/api/bounties/:slug/enter',
  submit: '/api/bounties/:slug/submit',
  me: '/api/me',
  mySubmissions: '/api/me/submissions',
  leaderboard: '/api/leaderboard',
  health: '/api/health',
};

/**
 * Fetch GET <apiBase>/skill.md and extract what the agent needs:
 *  - apiBase declared in the doc (cross-check vs the configured base)
 *  - endpoint paths from the endpoint reference table
 * Returns { text, declaredApiBase, endpoints, parsed }.
 */
async function fetchSkill(apiBase) {
  const res = await fetch(`${apiBase}/skill.md`);
  if (!res.ok) throw new Error(`skill.md fetch failed: HTTP ${res.status}`);
  const text = await res.text();

  // "API base: `https://aiprove.fun`" — markdown bold markers may sit between
  // the label and the backticked URL, so match lazily up to the first URL.
  const baseMatch = text.match(/API base.*?`(https?:\/\/[^`\s)]+)`/is);
  const declaredApiBase = baseMatch ? baseMatch[1].replace(/\/$/, '') : null;

  // Endpoint reference table rows look like: | GET | `/api/bounties` | — | list |
  const endpoints = { ...DEFAULT_ENDPOINTS };
  let found = 0;
  const rowRe = /\|\s*(GET|POST)\s*\|\s*`?(\/api\/[a-zA-Z0-9/:._?=-]+)`?\s*\|/g;
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const path = m[2].replace(/\?.*$/, ''); // strip query strings
    found++;
    if (path.includes('/auth/challenge')) endpoints.challenge = path;
    else if (path.includes('/auth/verify')) endpoints.verify = path;
    else if (path === '/api/bounties') endpoints.bounties = path;
    else if (path === '/api/bounties/:slug') endpoints.bountyDetail = path;
    else if (path.endsWith('/:slug/enter')) endpoints.enter = path;
    else if (path.endsWith('/:slug/submit')) endpoints.submit = path;
    else if (path === '/api/me') endpoints.me = path;
    else if (path === '/api/me/submissions') endpoints.mySubmissions = path;
    else if (path === '/api/leaderboard') endpoints.leaderboard = path;
    else if (path === '/api/health') endpoints.health = path;
  }

  return {
    text,
    declaredApiBase,
    endpoints,
    parsed: { endpointRowsFound: found, docLength: text.length },
  };
}

module.exports = { fetchSkill, DEFAULT_ENDPOINTS };
