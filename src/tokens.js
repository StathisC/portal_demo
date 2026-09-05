/**
 * Απλό signed-payload σχήμα: base64url(JSON) + "." + base64url(HMAC-SHA256).
 * Μεταφέρθηκε εδώ από το src/index.js (ήταν module-scoped εκεί) ώστε να
 * μπορεί να το χρησιμοποιήσει ΚΑΙ το src/leaves.js — για τα one-click
 * links έγκρισης/απόρριψης άδειας μέσω email (βλ. buildDecideLinkToken στο
 * leaves.js) — χωρίς κυκλική εξάρτηση index.js <-> leaves.js.
 *
 * Ίδιο σχήμα με τα session cookies (SESSION_SECRET) και το integration
 * token (LINK_SECRET) — μοιράζονται τον ίδιο μηχανισμό, διαφορετικό secret
 * ανά χρήση. Κάθε payload πρέπει να έχει δικό του `type` πεδίο ώστε ένα
 * token μιας χρήσης να μην μπορεί να γίνει replay για άλλο σκοπό.
 */

export async function signPayload(payload, secret) {
  const enc = new TextEncoder();
  const body = base64UrlEncode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `${body}.${bufToBase64Url(sig)}`;
}

export async function verifyPayload(token, secret) {
  const parts = (token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBuf(sig),
    enc.encode(body)
  );
  if (!valid) return null;
  try {
    return JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return decodeURIComponent(escape(atob(str)));
}
function bufToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBuf(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
