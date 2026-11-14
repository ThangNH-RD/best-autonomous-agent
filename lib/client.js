// client.js — thin AIProve REST client built on the parsed skill.md endpoints.

function pathFor(template, slug) {
  return template.replace(':slug', encodeURIComponent(slug));
}

function makeClient(apiBase, endpoints, token) {
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  async function get(path) {
    const res = await fetch(`${apiBase}${path}`, { headers: authHeaders });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  }

  async function post(path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 600) };
  }

  return {
    async health() {
      return get(endpoints.health);
    },
    async listOpenBounties() {
      const r = await get(`${endpoints.bounties}?status=open`);
      if (!r.ok) throw new Error(`list bounties failed: HTTP ${r.status}`);
      const list = r.json.bounties || r.json || [];
      return Array.isArray(list) ? list : [];
    },
    async getBounty(slug) {
      return get(pathFor(endpoints.bountyDetail, slug));
    },
    async enter(slug, handle) {
      return post(pathFor(endpoints.enter, slug), { handle });
    },
    async submitPrediction(slug, prediction, handle) {
      return post(pathFor(endpoints.submit, slug), { prediction, handle });
    },
    async mySubmissions() {
      return get(endpoints.mySubmissions);
    },
  };
}

module.exports = { makeClient };
