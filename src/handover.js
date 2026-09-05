/**
 * Ψηφιακή υπογραφή στο έγγραφο παράδοσης/παραλαβής — σχεδιάστηκε μέσω
 * διευκρινιστικών ερωτήσεων (15/08/2026, ρητή απαίτηση χρήστη): η αξία της
 * ψηφιακής υπογραφής είναι να ΜΗΝ χρειάζεται φυσική παρουσία TL+τεχνικού
 * μαζί. Ροή:
 *   1) Ο TL/Director δημιουργεί ΕΝΑ "έγγραφο παράδοσης" από το τρέχον
 *      σύνολο κατοχής του τεχνικού (snapshot, όπως το ήδη υπάρχον PDF
 *      «Αναζήτηση τεχνικού» — βλ. src/assignments.js, getTechnicianHoldings).
 *      Η ίδια η authenticated ενέργεια (Google SSO) ΕΙΝΑΙ η επιβεβαίωση του
 *      TL — καμία σχεδιασμένη υπογραφή χρειάζεται από τη μεριά του.
 *   2) Ο τεχνικός βλέπει το εκκρεμές έγγραφο στο δικό του tab «Στην Κατοχή
 *      μου» και υπογράφει με το δάχτυλο σε canvas, από το δικό του κινητό,
 *      όποτε βολεύει — ΔΕΝ χρειάζεται να είναι δίπλα στον TL.
 *   3) Το έγγραφο κλειδώνει μετά την υπογραφή (immutable, καμία επανα-
 *      υπογραφή/ακύρωση) — ίδιο μοτίβο idempotent-lock με τα ερωτήματα
 *      διαθεσιμότητας.
 *
 * Νέο φύλλο "ΕγγραφαΠαράδοσης":
 *   ID | EmployeeID | EmployeeName | HoldingsJSON | Status | CreatedBy |
 *   CreatedByName | CreatedAt | SignatureFileKey | SignatureFileName |
 *   SignatureFileType | SignedAt
 *
 * Status: "Εκκρεμεί" -> "Υπογεγραμμένο". HoldingsJSON = "παγωμένο"
 * στιγμιότυπο (array από {Type, ItemLabel, ChargedAt}) τη στιγμή της
 * δημιουργίας — ΔΕΝ ενημερώνεται αν αλλάξουν οι χρεώσεις μετά (ρητή
 * απόφαση χρήστη: "το τρέχον σύνολο κατοχής" σημαίνει τη στιγμή της
 * δημιουργίας, ίδιο ιστορικό-snapshot μοτίβο με το src/crews.js). Αν
 * χρειαστεί νέο έγγραφο για ενημερωμένη κατοχή, ο TL φτιάχνει καινούριο —
 * τα παλιά μένουν ως ιστορικό.
 *
 * Η υπογραφή αποθηκεύεται ως εικόνα (canvas PNG) σε ΝΕΟ KV namespace
 * HANDOVER_FILES (ίδιο μοτίβο/όριο 20MB με LEAVE_FILES/EMPLOYEE_FILES/
 * FLEET_FILES/ANNOUNCEMENTS_FILES) — ξεχωριστό namespace γιατί το access-
 * scope εδώ είναι ίδιο με τις φωτογραφίες παραλαβής οχήματος (ο τεχνικός
 * owner Ή TL/Director) αλλά διαφορετικό concern.
 */

import { readSheetAsObjects, appendRow, updateCell, appendAuditLog } from "./sheets.js";
import { sendEmail, emailTemplate, resolveActorName, PORTAL_URL, logEmailFailure } from "./email.js";
import { getEmployeeById } from "./leaves.js";
import { getTechnicianHoldings } from "./assignments.js";

const SHEET_HANDOVER = "ΕγγραφαΠαράδοσης";
const HANDOVER_HEADER_ORDER = [
  "ID", "EmployeeID", "EmployeeName", "HoldingsJSON", "Status",
  "CreatedBy", "CreatedByName", "CreatedAt",
  "SignatureFileKey", "SignatureFileName", "SignatureFileType", "SignedAt",
];

/** Επιτρεπόμενοι τύποι αρχείου για την εικόνα υπογραφής — canvas PNG (προεπιλογή toBlob), JPEG fallback */
export const SIGNATURE_ALLOWED_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

function parseHoldings(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDocView(row) {
  return {
    ID: row.ID,
    EmployeeID: row.EmployeeID,
    EmployeeName: row.EmployeeName,
    holdings: parseHoldings(row.HoldingsJSON),
    Status: row.Status || "Εκκρεμεί",
    CreatedBy: row.CreatedBy || "",
    CreatedByName: row.CreatedByName || "",
    CreatedAt: row.CreatedAt || "",
    SignedAt: row.SignedAt || "",
    hasSignature: !!row.SignatureFileKey,
  };
}

/**
 * Δημιουργεί νέο έγγραφο παράδοσης από το ΤΡΕΧΟΝ σύνολο κατοχής του
 * τεχνικού (reuse getTechnicianHoldings, καμία νέα λογική υπολογισμού
 * κατοχής). Στέλνει email στον τεχνικό (αν έχει email) ενημερώνοντάς τον
 * ότι έχει νέο έγγραφο προς υπογραφή στο «Στην Κατοχή μου».
 */
export async function createHandoverDocument(env, { employeeId, createdBy }) {
  const employee = await getEmployeeById(env, employeeId);
  if (!employee) throw new Error("Ο τεχνικός δεν βρέθηκε.");

  const { holdings } = await getTechnicianHoldings(env, employeeId);
  if (!holdings.length) throw new Error("Ο τεχνικός δεν έχει τίποτα πάνω του αυτή τη στιγμή.");

  const snapshot = holdings.map((h) => ({
    Type: h.Type || "",
    ItemLabel: h.ItemLabel || "",
    ChargedAt: h.ChargedAt || "",
  }));

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const createdByName = await resolveActorName(env, createdBy);

  const row = {
    ID: id,
    EmployeeID: employee.EmployeeID,
    EmployeeName: employee.Name,
    HoldingsJSON: JSON.stringify(snapshot),
    Status: "Εκκρεμεί",
    CreatedBy: createdBy || "",
    CreatedByName: createdByName || "",
    CreatedAt: createdAt,
    SignatureFileKey: "",
    SignatureFileName: "",
    SignatureFileType: "",
    SignedAt: "",
  };
  await appendRow(env, SHEET_HANDOVER, row, HANDOVER_HEADER_ORDER);
  await appendAuditLog(env, "handover_document_created", createdBy, {
    employeeId: employee.EmployeeID,
    employeeName: employee.Name,
    itemCount: snapshot.length,
  });

  if (employee.Email) {
    const emailResult = await sendEmail(env, {
      to: [employee.Email],
      subject: "Νέο έγγραφο παράδοσης προς υπογραφή",
      html: emailTemplate({
        badge: "Προς υπογραφή",
        badgeColor: "blue",
        title: "Έγγραφο παράδοσης προς υπογραφή",
        intro: `Δημιουργήθηκε νέο έγγραφο παράδοσης/παραλαβής με ${snapshot.length} αντικείμενα που έχεις πάνω σου. Μπορείς να το υπογράψεις ψηφιακά από το κινητό σου, όποτε σου βολεύει.`,
        rows: [
          ["Αντικείμενα", String(snapshot.length)],
          ["Δημιουργήθηκε από", createdByName || "—"],
          ["Ημερομηνία", createdAt.slice(0, 10)],
        ],
        ctaText: "Υπογραφή στο Portal",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Βρίσκεις το έγγραφο στο tab «Στην Κατοχή μου» του OptikiTec Portal.",
      }),
      replyTo: createdBy,
      replyToName: createdByName,
    });
    await logEmailFailure(env, "handover_email_failed", createdBy, emailResult, { id, to: employee.Email });
  }

  return { success: true, id };
}

/** Όλα τα έγγραφα ενός τεχνικού (πιο πρόσφατα πρώτα) — ίδια συνάρτηση χρησιμοποιείται ΚΑΙ από τον ίδιο τον τεχνικό (Στην Κατοχή μου) ΚΑΙ από TL/Director (Αναζήτηση τεχνικού) */
export async function listHandoverDocumentsForEmployee(env, employeeId) {
  const rows = await readSheetAsObjects(env, SHEET_HANDOVER);
  return rows
    .filter((r) => String(r.EmployeeID) === String(employeeId))
    .map(toDocView)
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
}

/** Ένα έγγραφο — raw row (με _row για updateCell), για χρήση από sign/getSignature */
async function findHandoverRow(env, id) {
  const rows = await readSheetAsObjects(env, SHEET_HANDOVER);
  return rows.find((r) => r.ID === id) || null;
}

export async function getHandoverDocument(env, id) {
  const row = await findHandoverRow(env, id);
  return row ? toDocView(row) : null;
}

const COL_STATUS = HANDOVER_HEADER_ORDER.indexOf("Status") + 1;
const COL_SIG_KEY = HANDOVER_HEADER_ORDER.indexOf("SignatureFileKey") + 1;
const COL_SIG_NAME = HANDOVER_HEADER_ORDER.indexOf("SignatureFileName") + 1;
const COL_SIG_TYPE = HANDOVER_HEADER_ORDER.indexOf("SignatureFileType") + 1;
const COL_SIGNED_AT = HANDOVER_HEADER_ORDER.indexOf("SignedAt") + 1;

/**
 * Ο ΙΔΙΟΣ ο τεχνικός υπογράφει το δικό του εκκρεμές έγγραφο — idempotent
 * lock: μόλις υπογραφεί, ΔΕΝ επιτρέπεται ξανά (immutable, ίδιο μοτίβο με
 * τα ερωτήματα διαθεσιμότητας μετά την προθεσμία).
 */
export async function signHandoverDocument(env, { id, employeeId, bytes, fileName, contentType }) {
  if (!SIGNATURE_ALLOWED_TYPES[contentType]) {
    throw new Error("Μη έγκυρη μορφή υπογραφής.");
  }
  if (!env.HANDOVER_FILES) {
    throw new Error("Η αποθήκευση υπογραφών δεν είναι ρυθμισμένη (λείπει το KV binding HANDOVER_FILES).");
  }
  const row = await findHandoverRow(env, id);
  if (!row) throw new Error("Το έγγραφο δεν βρέθηκε.");
  if (String(row.EmployeeID) !== String(employeeId)) throw new Error("Αυτό το έγγραφο δεν είναι δικό σου.");
  if (row.Status === "Υπογεγραμμένο") throw new Error("Το έγγραφο έχει ήδη υπογραφεί.");

  const fileKey = `handover:signature:${crypto.randomUUID()}`;
  await env.HANDOVER_FILES.put(fileKey, bytes);

  const signedAt = new Date().toISOString();
  await updateCell(env, SHEET_HANDOVER, row._row, COL_SIG_KEY, fileKey);
  await updateCell(env, SHEET_HANDOVER, row._row, COL_SIG_NAME, fileName || "υπογραφή.png");
  await updateCell(env, SHEET_HANDOVER, row._row, COL_SIG_TYPE, contentType);
  await updateCell(env, SHEET_HANDOVER, row._row, COL_SIGNED_AT, signedAt);
  await updateCell(env, SHEET_HANDOVER, row._row, COL_STATUS, "Υπογεγραμμένο");

  await appendAuditLog(env, "handover_document_signed", employeeId, { id, employeeId });
  return { success: true, signedAt };
}

/**
 * Λήψη της εικόνας υπογραφής — επιστρέφει και το EmployeeID του εγγράφου
 * ώστε ο caller (index.js) να ελέγξει δικαίωμα πρόσβασης (owner τεχνικός Ή
 * TL/Director), ίδιο μοτίβο caller-authorizes με τις φωτογραφίες παραλαβής
 * οχήματος. Επιστρέφεται με Content-Disposition "inline" από το index.js
 * (όχι "attachment") ώστε να μπορεί να ενσωματωθεί ως <img> στο PDF preview.
 */
export async function getHandoverSignature(env, id) {
  if (!env.HANDOVER_FILES) return null;
  const row = await findHandoverRow(env, id);
  if (!row || !row.SignatureFileKey) return null;

  const bytes = await env.HANDOVER_FILES.get(row.SignatureFileKey, "arrayBuffer");
  if (!bytes) return null;
  return {
    bytes,
    fileName: row.SignatureFileName || "υπογραφή.png",
    contentType: row.SignatureFileType || "image/png",
    docEmployeeId: row.EmployeeID,
  };
}
