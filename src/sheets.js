/**
 * Google Sheets API v4 client για το Worker — αυθεντικοποίηση μέσω
 * Workload Identity Federation (WIF), ΧΩΡΙΣ Google-issued service account
 * key. Το Worker είναι ο δικός του OIDC identity provider: υπογράφει ένα
 * JWT με δικό του (Cloudflare-secret) RSA private key, το Google Cloud
 * STS το ανταλλάσσει για ένα federated token, και μετά γίνεται
 * impersonation του πραγματικού service account (IAM Credentials API)
 * για να πάρουμε access token με scope Sheets.
 *
 * Γιατί έτσι: η εταιρεία έχει org policy που μπλοκάρει τη δημιουργία
 * Google-issued service account keys (iam.disableServiceAccountKeyCreation,
 * legacy + managed) και δεν θέλαμε να το πειράξουμε. Το WIF flow δεν
 * δημιουργεί ΚΑΝΕΝΑ Google service account key -> το policy δεν
 * ενεργοποιείται καν, το org policy μένει ανέγγιχτο.
 *
 * Χρειάζεται 3 Worker secrets (βλ. SETUP.md):
 *   WIF_PRIVATE_KEY            (πλήρες PEM, δικό μας keypair — ΟΧΙ Google key)
 *   WIF_PROVIDER_RESOURCE      (π.χ. projects/123456789/locations/global/workloadIdentityPools/optikitec-portal-pool/providers/optikitec-portal-provider)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL (το service account που κάνουμε impersonate, π.χ. optikitec-portal-sheets@optikitec-portal.iam.gserviceaccount.com)
 *   GOOGLE_SHEET_ID             (το ID του spreadsheet από το URL)
 *
 * Το Worker εκθέτει δημόσια (χωρίς auth) 2 endpoints ώστε η Google να
 * μπορεί να επαληθεύσει τα JWTs μας ως OIDC identity provider:
 *   GET /.well-known/openid-configuration
 *   GET /.well-known/jwks.json
 * (βλ. index.js — καλούν getOidcDiscoveryJson/getJwksJson από εδώ)
 */

const ISSUER = "https://optikitec-portal.s-xronis.workers.dev";
const WIF_SUBJECT = "optikitec-portal-worker";
const WIF_KID = "wif-key-1";

// Public RSA modulus/exponent του δικού μας WIF keypair (ασφαλές να είναι
// hardcoded — είναι το PUBLIC key, ταιριάζει με το WIF_PRIVATE_KEY secret).
const WIF_PUBLIC_N =
  "qeHE9d6V9naxlmsKo66kaeiL19psAL2SWuH7kECm_5j6Q5v2Yv7Cd-6it34qqGpdOoRvY6nUrBC9G0lU1GcFhpjTI5tOXlg3lh_Z711Vx2KkplKgGBBPygjMdh5yB8PHjktSr5jpDn0RsH-LvCzJdXlXYty_Hi7S1zmwTP-OoUxXFiQrtqpxSW34h8OmOhpmQshzUHoEYXNRPIAEIlT6ecrbiF3_IzoR0jn_Nc54SPNorRcLIQq7ci8uQ-Q9B5Xuy5xD8fwgmzY6mXwtlPMq9UjwPjq0YGVuffS5W3HXHfDzvaw7Ssa925CLrTUnyh4p6ufvOdpa4BhGdnIT4ph_Fw";
const WIF_PUBLIC_E = "AQAB";

const STS_URL = "https://sts.googleapis.com/v1/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function base64UrlEncodeBuf(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeStr(str) {
  return base64UrlEncodeBuf(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .trim();
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Δημόσια OIDC discovery + JWKS — καλούνται από index.js σε public routes */
export function getOidcDiscoveryJson() {
  return {
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

export function getJwksJson() {
  return {
    keys: [
      {
        kty: "RSA",
        alg: "RS256",
        use: "sig",
        kid: WIF_KID,
        n: WIF_PUBLIC_N,
        e: WIF_PUBLIC_E,
      },
    ],
  };
}

/** Υπογράφει το δικό μας "identity" JWT (όχι Google token) με το WIF_PRIVATE_KEY */
async function signWifAssertion(env) {
  const now = Math.floor(Date.now() / 1000);
  const audience = `//iam.googleapis.com/${env.WIF_PROVIDER_RESOURCE}`;
  const header = { alg: "RS256", typ: "JWT", kid: WIF_KID };
  const claims = {
    iss: ISSUER,
    sub: WIF_SUBJECT,
    aud: audience,
    exp: now + 300,
    iat: now,
  };
  const signingInput = `${base64UrlEncodeStr(JSON.stringify(header))}.${base64UrlEncodeStr(JSON.stringify(claims))}`;

  const keyBuf = pemToArrayBuffer(env.WIF_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncodeBuf(sig)}`;
}

/** Βήμα 1: ανταλλάσσει το δικό μας JWT για ένα federated token μέσω Google STS */
async function exchangeForFederatedToken(env) {
  const assertion = await signWifAssertion(env);
  const audience = `//iam.googleapis.com/${env.WIF_PROVIDER_RESOURCE}`;

  const res = await fetch(STS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      audience,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope: CLOUD_PLATFORM_SCOPE,
      subject_token: assertion,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google STS token exchange απέτυχε: ${res.status} ${text}`);
  }
  return res.json(); // { access_token, expires_in, ... }
}

/** Βήμα 2: κάνει impersonate το πραγματικό service account, ζητώντας scope Sheets */
async function impersonateServiceAccount(env, federatedAccessToken) {
  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.GOOGLE_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${federatedAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope: [SHEETS_SCOPE], lifetime: "3600s" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Service account impersonation απέτυχε: ${res.status} ${text}`);
  }
  return res.json(); // { accessToken, expireTime }
}

/**
 * Access token cache στο KV (TECHNICIAN_AUTH namespace) — αποφεύγουμε να
 * κάνουμε ολόκληρο το 2-βημάτων WIF exchange σε κάθε request.
 */
async function getAccessToken(env) {
  const cacheKey = "google:sheets:access_token";
  if (env.TECHNICIAN_AUTH) {
    const cached = await env.TECHNICIAN_AUTH.get(cacheKey, "json");
    if (cached && cached.exp > Math.floor(Date.now() / 1000) + 30) {
      return cached.token;
    }
  }

  const federated = await exchangeForFederatedToken(env);
  const impersonated = await impersonateServiceAccount(env, federated.access_token);

  const token = impersonated.accessToken;
  const expMs = Date.parse(impersonated.expireTime);
  const exp = Number.isFinite(expMs) ? Math.floor(expMs / 1000) : Math.floor(Date.now() / 1000) + 3600;

  if (env.TECHNICIAN_AUTH) {
    const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000) - 60);
    await env.TECHNICIAN_AUTH.put(cacheKey, JSON.stringify({ token, exp }), { expirationTtl: ttl });
  }
  return token;
}

async function sheetsFetch(env, path, options = {}) {
  const token = await getAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API error (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Διαβάζει ολόκληρο φύλλο και το μετατρέπει σε array από objects (πρώτη
 * γραμμή = headers).
 *
 * BUG εντοπίστηκε 24/08/2026 (αναφορά χρήστη: νέες στήλες HuskiesUsername/
 * HuskiesPassword στο Υπάλληλοι δεν εμφανίζονταν ΚΑΘΟΛΟΥ στο Προφίλ
 * Τεχνικού, παρότι υπήρχαν ήδη τιμές στο ίδιο το Sheet): το εύρος ήταν
 * hardcoded σε `A1:Z10000` (μόνο 26 στήλες, μέχρι τη στήλη Z). Το φύλλο
 * `Υπάλληλοι` είχε ΗΔΗ ακριβώς 26 στήλες (μέχρι το `AFM`) — η προσθήκη 2
 * ακόμα στηλών (`HuskiesUsername`/`HuskiesPassword`, AA/AB) τις έσπρωξε
 * ΕΞΩ από το εύρος ανάγνωσης, σιωπηλά (καμία exception — απλά απουσίαζαν
 * από κάθε επιστρεφόμενο object). Το ίδιο όριο υπήρχε και στο
 * `getSheetRawValues()`/`getHeaderRow()` παρακάτω — άρα και το καθημερινό
 * backup (`src/backup.js`) έκοβε σιωπηλά οποιοδήποτε φύλλο με >26 στήλες.
 * Fix: εύρος πλατύτερο σε `ZZ` (702 στήλες) — αρκετά γενναιόδωρο ώστε να
 * μην ξαναχτυπήσει το ίδιο όριο στο ορατό μέλλον, χωρίς κόστος (το Sheets
 * API επιστρέφει μόνο ό,τι υπάρχει πραγματικά, ανεξαρτήτως πλάτους εύρους).
 */
export async function readSheetAsObjects(env, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1:ZZ10000`);
  const data = await sheetsFetch(env, `/values/${range}`);
  const rows = data.values || [];
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows
    .slice(1)
    .filter((row) => row.join("") !== "")
    .map((row, i) => {
      const obj = { _row: i + 2 }; // +2: header row + 1-index
      headers.forEach((h, idx) => (obj[h] = row[idx] !== undefined ? row[idx] : ""));
      return obj;
    });
}

/**
 * Διαβάζει ολόκληρο φύλλο ως raw 2D array (χωρίς μετατροπή σε objects, χωρίς
 * να θεωρεί την πρώτη γραμμή headers) — για ΠΛΗΡΗ πιστότητα σε backup/εξαγωγή
 * (βλ. src/backup.js). Ίδιο εύρος A1:ZZ10000 με το readSheetAsObjects (βλ.
 * σχόλιο bugfix 24/08/2026 εκεί).
 */
export async function getSheetRawValues(env, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1:ZZ10000`);
  const data = await sheetsFetch(env, `/values/${range}`);
  return data.values || [];
}

/**
 * Διαβάζει ΑΝΕΠΕΞΕΡΓΑΣΤΕΣ τιμές (valueRenderOption=UNFORMATTED_VALUE) για
 * συγκεκριμένες στήλες (βάσει header name) ενός φύλλου — λύνει οριστικά
 * την ασάφεια ημερομηνιών που προκύπτει από τη FORMATTED_VALUE προεπιλογή
 * (βλ. src/dateutil.js): αν ένα κελί έχει π.χ. custom μορφή "yyyy-dd-mm",
 * η FORMATTED_VALUE επιστρέφει την τιμή ήδη "λάθος-σειράς" ΚΑΙ, όταν και οι
 * δύο θέσεις (ημέρα/μήνας) είναι ≤12, καμία ευρετική δεν μπορεί να μαντέψει
 * με σιγουριά ποια θέση είναι ποια (π.χ. "02" vs "09" — θα μπορούσε να είναι
 * είτε 2/9 είτε 9/2). Με UNFORMATTED_VALUE, ένα πραγματικό date-typed κελί
 * επιστρέφει ΠΑΝΤΑ τον σειριακό αριθμό ημέρας (days από 30/12/1899) ως
 * αριθμό — καμία εξάρτηση από μορφοποίηση/locale, καμία ασάφεια.
 *
 * Επιστρέφει `{ [headerName]: rawValue }[]` ευθυγραμμισμένο ανά γραμμή με
 * το `_row` (index 2) που ήδη επιστρέφει το readSheetAsObjects() για το
 * ΙΔΙΟ φύλλο/εύρος — δηλαδή `result[0]` αντιστοιχεί σε `_row: 2`,
 * `result[1]` σε `_row: 3`, κ.ο.κ. Επιστρέφει `null` αν κάποιο από τα
 * ζητούμενα headers δεν βρεθεί (caller κάνει fallback στη FORMATTED_VALUE
 * τιμή του readSheetAsObjects()).
 */
export async function getUnformattedColumns(env, sheetName, headerNames) {
  const headers = await getHeaderRow(env, sheetName);
  const indices = headerNames.map((h) => headers.indexOf(h));
  if (indices.some((i) => i === -1)) return null;

  const minIdx = Math.min(...indices);
  const maxIdx = Math.max(...indices);
  const range = encodeURIComponent(`${sheetName}!${columnToLetter(minIdx + 1)}2:${columnToLetter(maxIdx + 1)}10000`);
  const data = await sheetsFetch(env, `/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = data.values || [];

  return rows.map((row) => {
    const obj = {};
    headerNames.forEach((h, i) => {
      const relIdx = indices[i] - minIdx;
      obj[h] = row[relIdx] !== undefined ? row[relIdx] : "";
    });
    return obj;
  });
}

/** Προσθέτει νέα γραμμή στο τέλος του φύλλου, με τιμές στη σειρά του headerOrder */
export async function appendRow(env, sheetName, obj, headerOrder) {
  const values = [headerOrder.map((h) => (obj[h] !== undefined ? obj[h] : ""))];
  const range = encodeURIComponent(`${sheetName}!A1`);
  return sheetsFetch(env, `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values }),
  });
}

/** Επιστρέφει την πρώτη γραμμή (επικεφαλίδες) ενός φύλλου, για δυναμική εύρεση στήλης by name. Ίδιο εύρος ZZ με readSheetAsObjects (βλ. σχόλιο bugfix 24/08/2026 εκεί). */
export async function getHeaderRow(env, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1:ZZ1`);
  const data = await sheetsFetch(env, `/values/${range}`);
  return (data.values && data.values[0]) || [];
}

/** Ενημερώνει συγκεκριμένο κελί (1-indexed row/col) */
export async function updateCell(env, sheetName, row, col, value) {
  const colLetter = columnToLetter(col);
  const range = encodeURIComponent(`${sheetName}!${colLetter}${row}`);
  return sheetsFetch(env, `/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[value]] }),
  });
}

/** Ενημερώνει ολόκληρη γραμμή μονομιάς (1-indexed row), values = array στη σειρά του headerOrder */
export async function updateRow(env, sheetName, row, values) {
  const lastCol = columnToLetter(values.length);
  const range = encodeURIComponent(`${sheetName}!A${row}:${lastCol}${row}`);
  return sheetsFetch(env, `/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [values] }),
  });
}

/**
 * Βρίσκει το εσωτερικό numeric sheetId ενός tab (χρειάζεται για batchUpdate
 * operations όπως deleteDimension — διαφορετικό από το όνομα του φύλλου).
 * Cache στο KV (σπάνια αλλάζει η δομή του spreadsheet).
 */
async function getSheetIdByName(env, sheetName) {
  const cacheKey = `google:sheets:sheetid:${sheetName}`;
  if (env.TECHNICIAN_AUTH) {
    const cached = await env.TECHNICIAN_AUTH.get(cacheKey);
    if (cached !== null) return Number(cached);
  }
  const data = await sheetsFetch(env, `?fields=sheets.properties(sheetId,title)`);
  const match = (data.sheets || []).find((s) => s.properties.title === sheetName);
  if (!match) throw new Error(`Δεν βρέθηκε φύλλο με όνομα "${sheetName}"`);
  const sheetId = match.properties.sheetId;
  if (env.TECHNICIAN_AUTH) {
    await env.TECHNICIAN_AUTH.put(cacheKey, String(sheetId), { expirationTtl: 3600 });
  }
  return sheetId;
}

/** Διαγράφει ολόκληρη γραμμή (1-indexed) από το φύλλο */
export async function deleteRow(env, sheetName, row) {
  const sheetId = await getSheetIdByName(env, sheetName);
  return sheetsFetch(env, `:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: row - 1,
              endIndex: row,
            },
          },
        },
      ],
    }),
  });
}

/** Επιστρέφει την τρέχουσα τιμή ενός κελιού (για re-check πριν από write, race-condition guard) */
export async function readCell(env, sheetName, row, col) {
  const colLetter = columnToLetter(col);
  const range = encodeURIComponent(`${sheetName}!${colLetter}${row}`);
  const data = await sheetsFetch(env, `/values/${range}`);
  return data.values && data.values[0] ? data.values[0][0] : "";
}

function columnToLetter(col) {
  let letter = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

export async function appendAuditLog(env, action, who, details) {
  try {
    await appendRow(
      env,
      "AuditLog",
      { Timestamp: new Date().toISOString(), User: who || "system", Action: action, Details: JSON.stringify(details) },
      ["Timestamp", "User", "Action", "Details"]
    );
  } catch (err) {
    // Το audit log δεν πρέπει ποτέ να μπλοκάρει την κύρια λειτουργία
  }
}

/**
 * Διάβασμα του AuditLog για προβολή στο UI (μόνο Director, βλ. src/index.js
 * handleAuditLog) — read-only, πιο πρόσφατα πρώτα. Χωρίς αυτό το tab, οι
 * καταγραφές (reset PIN, εγκρίσεις αδειών, χρεώσεις κλπ.) υπήρχαν μόνο
 * μέσα στο raw Sheet, αόρατες στο portal.
 */
export async function getAuditLog(env, { limit = 300 } = {}) {
  const rows = await readSheetAsObjects(env, "AuditLog");
  return rows.slice(-limit).reverse();
}
