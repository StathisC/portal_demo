/**
 * Tab «Έγγραφα» — αυτοματοποιημένα, επίσημα έγγραφα προσωπικού (π.χ. Αίτηση
 * Άδειας Άνευ Αποδοχών) που ο TL/Director δημιουργεί επιλέγοντας τεχνικό
 * (αυτόματη συμπλήρωση στοιχείων από το Υπάλληλοι) + συμπληρώνοντας τα
 * υπόλοιπα πεδία με το χέρι (π.χ. ημερομηνίες/λόγος) — ρητή απαίτηση
 * χρήστη 31/08/2026, preview εγκρίθηκε πριν την υλοποίηση.
 *
 * Αρχιτεκτονική σκόπιμα EXTENSIBLE (ρητή απαίτηση χρήστη "ό,τι άλλο
 * χρειαστεί να προσθέσουμε") — DOCUMENT_TYPES registry στο hub.html ορίζει
 * ανά τύπο εγγράφου ποια πεδία είναι auto (από το προφίλ τεχνικού) και ποια
 * manual (τα συμπληρώνει ο TL/Director), και το δικό του render() που
 * παράγει το ακριβές HTML/CSS προς εκτύπωση — το backend εδώ είναι πλήρως
 * agnostic ως προς τον τύπο, αποθηκεύει απλά {docType, fields} ως JSON.
 *
 * Νέο φύλλο "Έγγραφα":
 *   ID | EmployeeID | EmployeeName | DocType | FieldsJSON | CreatedBy |
 *   CreatedByName | CreatedAt
 *
 * Πρόσβαση (δημιουργία/ιστορικό): ΜΟΝΟ TL + Director (requireTeamLeader στο
 * src/index.js, ίδιο gate με το tab Προφίλ Τεχνικού — Backoffice δεν έχει
 * καν πρόσβαση στο tab). Ρητή απόφαση χρήστη.
 *
 * Καμία υπογραφή/email — το έγγραφο τυπώνεται (browser print, ίδιο μοτίβο
 * με το Δελτίο Παράδοσης/Παραλαβής) και υπογράφεται ΦΥΣΙΚΑ (χαρτί/σφραγίδα),
 * ρητή απόφαση χρήστη — διαφορετικό από τον ψηφιακό μηχανισμό canvas του
 * src/handover.js (εκείνο λύνει ένα διαφορετικό πρόβλημα: απομακρυσμένη
 * υπογραφή χωρίς φυσική παρουσία TL+τεχνικού μαζί).
 */

import { readSheetAsObjects, appendRow, appendAuditLog } from "./sheets.js";
import { resolveActorName } from "./email.js";
import { getEmployeeById } from "./leaves.js";

const SHEET_DOCUMENTS = "Έγγραφα";
const DOCUMENT_HEADER_ORDER = [
  "ID", "EmployeeID", "EmployeeName", "DocType", "FieldsJSON",
  "CreatedBy", "CreatedByName", "CreatedAt",
];

function parseFields(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toDocView(row) {
  return {
    ID: row.ID,
    EmployeeID: row.EmployeeID,
    EmployeeName: row.EmployeeName,
    DocType: row.DocType,
    fields: parseFields(row.FieldsJSON),
    CreatedBy: row.CreatedBy || "",
    CreatedByName: row.CreatedByName || "",
    CreatedAt: row.CreatedAt || "",
  };
}

/**
 * Δημιουργεί/αποθηκεύει ένα νέο συμπληρωμένο έγγραφο — καθαρή αποθήκευση
 * ό,τι στοιχεία έστειλε το UI (fields), καμία επικύρωση περιεχομένου εδώ
 * (ο κάθε τύπος έχει δικά του, διαφορετικά πεδία, βλ. DOCUMENT_TYPES στο
 * hub.html) — μόνο ότι υπάρχει τεχνικός/τύπος.
 */
export async function createDocument(env, { employeeId, docType, fields, createdBy }) {
  const employee = await getEmployeeById(env, employeeId);
  if (!employee) throw new Error("Ο τεχνικός δεν βρέθηκε.");
  if (!docType) throw new Error("Χρειάζεται τύπος εγγράφου.");

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const createdByName = await resolveActorName(env, createdBy);

  const row = {
    ID: id,
    EmployeeID: employee.EmployeeID,
    EmployeeName: employee.Name,
    DocType: docType,
    FieldsJSON: JSON.stringify(fields || {}),
    CreatedBy: createdBy || "",
    CreatedByName: createdByName || "",
    CreatedAt: createdAt,
  };
  await appendRow(env, SHEET_DOCUMENTS, row, DOCUMENT_HEADER_ORDER);
  await appendAuditLog(env, "document_created", createdBy, {
    employeeId: employee.EmployeeID,
    employeeName: employee.Name,
    docType,
  });

  return toDocView(row);
}

/** Ιστορικό εγγράφων ενός τεχνικού (πιο πρόσφατα πρώτα) — «Αναζήτηση τεχνικού» ισοδύναμο για το tab Έγγραφα */
export async function listDocumentsForEmployee(env, employeeId) {
  const rows = await readSheetAsObjects(env, SHEET_DOCUMENTS);
  return rows
    .filter((r) => String(r.EmployeeID) === String(employeeId))
    .map(toDocView)
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
}

/** Όλα τα έγγραφα, πιο πρόσφατα πρώτα — γενικό ιστορικό στο κάτω μέρος του tab, cap 200 (ίδιο πνεύμα με AuditLog) */
export async function listAllDocuments(env) {
  const rows = await readSheetAsObjects(env, SHEET_DOCUMENTS);
  return rows
    .map(toDocView)
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)))
    .slice(0, 200);
}

/** Ένα έγγραφο — για επανα-εκτύπωση/προβολή από το ιστορικό */
export async function getDocumentById(env, id) {
  const rows = await readSheetAsObjects(env, SHEET_DOCUMENTS);
  const row = rows.find((r) => r.ID === id);
  return row ? toDocView(row) : null;
}
