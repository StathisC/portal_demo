/**
 * SIMs — κάρτες SIM (αριθμός κάρτας, PIN, PUK, σε ποιο tablet είναι
 * τοποθετημένη) — νέο φύλλο "SIMs" στο Sheet (βλ. CLAUDE.md §Χειροκίνητα
 * βήματα). Ίδιο απλό CRUD μοτίβο με το src/equipment.js, ΑΛΛΑ χωρίς κανένα
 * μηχανισμό χρέωσης/ανάθεσης σε τεχνικό (src/assignments.js) — το "Tablet"
 * είναι απλά ένα πεδίο ελεύθερου κειμένου (dropdown από ήδη καταχωρημένες
 * τιμές + "Άλλο tablet...", ίδιο μοτίβο με το Category του Εξοπλισμού/Type
 * του Στόλου, χωρίς hardcoded λίστα και χωρίς εξάρτηση από το φύλλο
 * Εξοπλισμός) — καθαρά πληροφοριακό ποια SIM είναι μέσα σε ποιο tablet.
 */

import { readSheetAsObjects, appendRow, updateRow, deleteRow, appendAuditLog } from "./sheets.js";

const SHEET_SIMS = "SIMs";
const SIMS_HEADER_ORDER = ["ID", "CardNumber", "PIN", "PUK", "Tablet", "Note", "UpdatedBy", "UpdatedAt"];

export async function listSims(env) {
  const items = await readSheetAsObjects(env, SHEET_SIMS);
  return items.sort((a, b) => (a.CardNumber || "").localeCompare(b.CardNumber || "", "el"));
}

/** Μοναδικές τιμές Tablet ήδη καταχωρημένες — για το dropdown "Tablet" (+ επιλογή "Άλλο tablet..." στο UI). Χωρίς hardcoded λίστα, ίδιο μοτίβο με listEquipmentCategories()/listVehicleTypes(). */
export async function listSimTablets(env) {
  const items = await readSheetAsObjects(env, SHEET_SIMS);
  const tablets = new Set(items.map((i) => (i.Tablet || "").trim()).filter(Boolean));
  return Array.from(tablets).sort((a, b) => a.localeCompare(b, "el"));
}

/** Αναγκάζει το Sheets API (valueInputOption=USER_ENTERED) να αποθηκεύσει την
 * τιμή ως ΚΕΙΜΕΝΟ αντί να την ερμηνεύσει ως αριθμό — χωρίς αυτό, τιμές με
 * αρχικά μηδενικά (π.χ. PIN "0424", PUK "0391...") χάνουν σιωπηλά το
 * αρχικό "0" (το Sheets τις αποθηκεύει σαν αριθμό 424). Το μπροστινό `'`
 * είναι το ίδιο σημάδι "force text" που χρησιμοποιεί το Sheets UI όταν
 * κάποιος πληκτρολογεί χειροκίνητα '0424 — ΔΕΝ αποθηκεύεται/εμφανίζεται
 * ποτέ ως μέρος της τιμής, το Sheets το αφαιρεί αυτόματα κατά την εγγραφή. */
function forceSheetText(v) {
  if (v === undefined || v === null || v === "") return "";
  const s = String(v);
  return s.startsWith("'") ? s : "'" + s;
}
const SIMS_TEXT_FIELDS = new Set(["CardNumber", "PIN", "PUK"]);

export async function addSim(env, { cardNumber, pin, puk, tablet, note, updatedBy }) {
  if (!cardNumber) throw new Error("Χρειάζεται αριθμός κάρτας.");
  const row = {
    ID: crypto.randomUUID(),
    CardNumber: cardNumber,
    PIN: pin || "",
    PUK: puk || "",
    Tablet: tablet || "",
    Note: note || "",
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
  };
  const sheetRow = { ...row };
  for (const f of SIMS_TEXT_FIELDS) sheetRow[f] = forceSheetText(row[f]);
  await appendRow(env, SHEET_SIMS, sheetRow, SIMS_HEADER_ORDER);
  await appendAuditLog(env, "sim_add", updatedBy, { cardNumber, tablet });
  return { success: true, item: row };
}

export async function updateSim(env, simId, updates, updatedBy) {
  const items = await readSheetAsObjects(env, SHEET_SIMS);
  const existing = items.find((v) => v.ID === simId);
  if (!existing) throw new Error("Η κάρτα SIM δεν βρέθηκε.");

  const merged = {
    ID: existing.ID,
    CardNumber: updates.cardNumber !== undefined ? updates.cardNumber : existing.CardNumber,
    PIN: updates.pin !== undefined ? updates.pin : existing.PIN,
    PUK: updates.puk !== undefined ? updates.puk : existing.PUK,
    Tablet: updates.tablet !== undefined ? updates.tablet : existing.Tablet,
    Note: updates.note !== undefined ? updates.note : existing.Note,
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
  };
  const values = SIMS_HEADER_ORDER.map((h) => {
    const v = merged[h] !== undefined ? merged[h] : "";
    return SIMS_TEXT_FIELDS.has(h) ? forceSheetText(v) : v;
  });
  await updateRow(env, SHEET_SIMS, existing._row, values);
  await appendAuditLog(env, "sim_update", updatedBy, { simId, updates });
  return { success: true, item: merged };
}

export async function deleteSim(env, simId, updatedBy) {
  const items = await readSheetAsObjects(env, SHEET_SIMS);
  const existing = items.find((v) => v.ID === simId);
  if (!existing) throw new Error("Η κάρτα SIM δεν βρέθηκε.");

  await deleteRow(env, SHEET_SIMS, existing._row);
  await appendAuditLog(env, "sim_delete", updatedBy, { simId, cardNumber: existing.CardNumber });
  return { success: true };
}
