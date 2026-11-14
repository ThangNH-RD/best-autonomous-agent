// auth.js — agent identity: an ephemeral secp256k1 keypair, in memory only.
//
// The agent generates its own wallet on every run (Wallet.createRandom()).
// AGENT_PRIVATE_KEY may override it for a stable identity across runs
// (e.g. the staging sandbox wants the same address every time).
// Keys are NEVER written to disk, never printed, never included in reports.

const { Wallet } = require('ethers');

function loadWallet() {
  const override = (process.env.AGENT_PRIVATE_KEY || '').trim();
  if (override) {
    const w = new Wallet(override);
    return { wallet: w, ephemeral: false };
  }
  return { wallet: Wallet.createRandom(), ephemeral: true };
}

/**
 * Challenge -> EIP-191 personal_sign -> verify -> Bearer session token.
 * `endpoints` comes from the parsed skill.md.
 */
async function authenticate(apiBase, endpoints, wallet) {
  const cRes = await fetch(
    `${apiBase}${endpoints.challenge}?address=${wallet.address}`
  );
  const cJson = await cRes.json().catch(() => ({}));
  if (!cRes.ok || !cJson.challenge) {
    throw new Error(
      `challenge failed: HTTP ${cRes.status} ${JSON.stringify(cJson).slice(0, 200)}`
    );
  }
  const signature = await wallet.signMessage(cJson.challenge);
  const vRes = await fetch(`${apiBase}${endpoints.verify}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  const vJson = await vRes.json().catch(() => ({}));
  if (!vRes.ok || !vJson.token) {
    throw new Error(
      `verify failed: HTTP ${vRes.status} ${JSON.stringify(vJson).slice(0, 200)}`
    );
  }
  return { token: vJson.token, expiresAt: vJson.expiresAt || null };
}

module.exports = { loadWallet, authenticate };
