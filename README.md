> **Κλώνος/demo** — αντίγραφο του OptikiTec Portal για δοκιμές/πειραματισμό σε ξεχωριστό Cloudflare Worker + Google Sheet. Δεν έχει ακόμα δικό του deployment/Sheet/secrets — βλ. SETUP.md.

# OptikiTec — Σύστημα Αδειών (Portal)

Cloudflare Worker: login (τεχνικοί με PIN, TL/backoffice με Google SSO), hub UI,
και όλη η business logic των αδειών. Μιλάει απευθείας με ένα Google Sheet
(data store) μέσω Sheets API v4 — χωρίς Apps Script.

## Αρχεία

| Αρχείο/φάκελος | Τι είναι |
|---|---|
| `src/index.js` | Worker entry point — routing, auth (technician PIN + Cloudflare Access), API handlers |
| `src/sheets.js` | Google Sheets API v4 client — auth μέσω Workload Identity Federation (χωρίς service account key) |
| `src/leaves.js` | Business logic: ισοζύγιο ημερών, υποβολή/έγκριση/απόρριψη αιτήσεων, team-scoped operations |
| `src/fleet.js` | Στόλος οχημάτων — CRUD, κοινό για όλους τους TL (όχι team-scoped) |
| `src/assignments.js` | Χρεώσεις τεχνικών — άνοιγμα/κλείσιμο χρέωσης, auto-sync με αναθέσεις οχημάτων |
| `src/email.js` | Αποστολή email μέσω μικρού Apps Script mail relay (ειδοποιήσεις χρέωσης) |
| `index.html` | Login σελίδα (tab τεχνικός/PIN + tab Google SSO) |
| `hub.html` | Κεντρικό UI μετά το login — inline φόρμες/πίνακες, καλεί `/api/leaves/*` |
| `wrangler.toml` | Worker config, KV binding, λίστα secrets (comments) |
| `SETUP.md` | Πλήρης οδηγός εγκατάστασης (Sheet δομή, Worker secrets, Cloudflare Access, WIF) |

## Auth αρχιτεκτονική

**Τεχνικοί** (δεν έχουν όλοι Google Workspace): employeeID + 4ψήφιο PIN →
session cookie (HMAC signed) μέσω `TECHNICIAN_AUTH` KV namespace.

**Team Leaders / Backoffice** (έχουν `@optikitec.gr` Workspace): Cloudflare
Access (Zero Trust) με Google SSO, μόνο στα staff-only endpoints
(`/api/leaves/team`, `/decide`, `/submit-for-team`) — βλ. `SETUP.md` §2.3
για το γιατί η σελίδα/κοινά endpoints ΔΕΝ πρέπει να προστατεύονται εκεί.

**Google Sheets σύνδεση**: Workload Identity Federation (`src/sheets.js`) —
ο Worker είναι δικός του OIDC provider, χωρίς κανένα downloadable Google
service account key. Βλ. `SETUP.md` §3.

## Ξεκίνημα

Βλ. `SETUP.md` — Sheet δομή → Worker secrets → Cloudflare Access → WIF setup → deploy.
