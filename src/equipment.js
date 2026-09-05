/**
 * Εξοπλισμός/λοιπά αντικείμενα προς χρέωση (εργαλεία, laptops, κινητά κλπ) —
 * κοινή master λίστα, ίδιο μοτίβο με το src/fleet.js (Στόλος). Νέο φύλλο
 * "Εξοπλισμός" στο Sheet — βλ. SETUP.md για τη δομή.
 *
 * Όταν ένα αντικείμενο ανατεθεί σε τεχνικό, ανοίγει αυτόματα χρέωση στο
 * φύλλο Χρεώσεις (ίδιος μηχανισμός με τα οχήματα, βλ. src/assignments.js).
 */

import { readSheetAsObjects, appendRow, updateRow, deleteRow, appendAuditLog } from "./sheets.js";
import { syncEquipmentAssignment, closeOpenAssignmentsForItem } from "./assignments.js";

const SHEET_EQUIPMENT = "Εξοπλισμός";
const SHEET_EMPLOYEES = "Υπάλληλοι";
// SerialNumber προστέθηκε ΣΤΟ ΤΕΛΟΣ (νέα στήλη — χειροκίνητο βήμα στο Sheet,
// βλ. CLAUDE.md) — item #6 "Προς Συζήτηση" (15/08/2026, ρητή απαίτηση
// χρήστη): αρχικά ΕΝΑ γενικό πεδίο μοναδικού κωδικού αναγνώρισης (IMEI για
// κινητά, σειριακός αριθμός για tablet κλπ) με δυναμικό label ανάλογα με
// την Κατηγορία (eqSerialLabel() στο hub.html).
// ΑΝΑΘΕΩΡΗΘΗΚΕ (03/09/2026, ρητή απαίτηση χρήστη): ο ενιαίος μηχανισμός
// δυναμικού label αντικαταστάθηκε από 3 ρητά ξεχωριστά πεδία — Σειριακός
// Αριθμός (SerialNumber, ήδη υπήρχε), Μοντέλο (Model, νέο) και IMEI (νέο).
// Και τα 3 προαιρετικά, κοινά για όλες τις κατηγορίες αντικειμένων (όχι
// μόνο κινητά/tablet) — ο χρήστης ζήτησε ρητά τον διαχωρισμό, όχι πια ένα
// μόνο πεδίο με μεταβαλλόμενο label. Model/IMEI = νέες στήλες στο τέλος
// του Sheet — χειροκίνητο βήμα, βλ. CLAUDE.md.
const EQUIPMENT_HEADER_ORDER = ["ID", "Name", "Category", "AssignedTo", "Status", "Note", "UpdatedBy", "UpdatedAt", "SerialNumber", "Model", "IMEI"];

export async function listEquipment(env) {
  const items = await readSheetAsObjects(env, SHEET_EQUIPMENT);
  return items.sort((a, b) => (a.Name || "").localeCompare(b.Name || "", "el"));
}

/** Λίστα όλων των τεχνικών (για το dropdown "Ανατεθειμένος") — όχι team-scoped, ίδιο με το fleet.js */
export async function listEquipmentDrivers(env) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees
    .map((e) => ({ EmployeeID: e.EmployeeID, Name: e.Name }))
    .filter((e) => e.Name)
    .sort((a, b) => a.Name.localeCompare(b.Name, "el"));
}

/** Μοναδικές τιμές Category ήδη καταχωρημένες — για το dropdown "Κατηγορία" (+ επιλογή "Άλλη κατηγορία..." στο UI, ίδιο μοτίβο με Περιοχή/Team στη φόρμα Νέος Τεχνικός). Χωρίς hardcoded λίστα. */
export async function listEquipmentCategories(env) {
  const items = await readSheetAsObjects(env, SHEET_EQUIPMENT);
  const categories = new Set(items.map((i) => (i.Category || "").trim()).filter(Boolean));
  return Array.from(categories).sort((a, b) => a.localeCompare(b, "el"));
}

export async function addEquipment(env, { name, category, assignedTo, status, note, serialNumber, model, imei, updatedBy }) {
  if (!name) throw new Error("Χρειάζεται όνομα αντικειμένου.");
  const row = {
    ID: crypto.randomUUID(),
    Name: name,
    Category: category || "",
    AssignedTo: assignedTo || "",
    Status: status || "Διαθέσιμο",
    Note: note || "",
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
    SerialNumber: serialNumber || "",
    Model: model || "",
    IMEI: imei || "",
  };
  await appendRow(env, SHEET_EQUIPMENT, row, EQUIPMENT_HEADER_ORDER);
  await appendAuditLog(env, "equipment_add", updatedBy, { name, category });

  // Αν ανατέθηκε ήδη κατά τη δημιουργία, άνοιξε χρέωση + email
  await syncEquipmentAssignment(env, {
    itemId: row.ID,
    itemLabel: row.Name,
    category: row.Category,
    previousDriver: "",
    newDriver: row.AssignedTo,
    actor: updatedBy,
  });

  return { success: true, item: row };
}

export async function updateEquipment(env, itemId, updates, updatedBy) {
  const items = await readSheetAsObjects(env, SHEET_EQUIPMENT);
  const existing = items.find((v) => v.ID === itemId);
  if (!existing) throw new Error("Το αντικείμενο δεν βρέθηκε.");

  const merged = {
    ID: existing.ID,
    Name: updates.name !== undefined ? updates.name : existing.Name,
    Category: updates.category !== undefined ? updates.category : existing.Category,
    AssignedTo: updates.assignedTo !== undefined ? updates.assignedTo : existing.AssignedTo,
    Status: updates.status !== undefined ? updates.status : existing.Status,
    Note: updates.note !== undefined ? updates.note : existing.Note,
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
    SerialNumber: updates.serialNumber !== undefined ? updates.serialNumber : existing.SerialNumber,
    Model: updates.model !== undefined ? updates.model : existing.Model,
    IMEI: updates.imei !== undefined ? updates.imei : existing.IMEI,
  };
  const values = EQUIPMENT_HEADER_ORDER.map((h) => (merged[h] !== undefined ? merged[h] : ""));
  await updateRow(env, SHEET_EQUIPMENT, existing._row, values);
  await appendAuditLog(env, "equipment_update", updatedBy, { itemId, updates });

  // Αλλαγή "ανατεθειμένου" -> κλείσε παλιά χρέωση + άνοιξε νέα + email
  await syncEquipmentAssignment(env, {
    itemId: existing.ID,
    itemLabel: merged.Name,
    category: merged.Category,
    previousDriver: existing.AssignedTo,
    newDriver: merged.AssignedTo,
    actor: updatedBy,
  });

  return { success: true, item: merged };
}

export async function deleteEquipment(env, itemId, updatedBy) {
  const items = await readSheetAsObjects(env, SHEET_EQUIPMENT);
  const existing = items.find((v) => v.ID === itemId);
  if (!existing) throw new Error("Το αντικείμενο δεν βρέθηκε.");

  await closeOpenAssignmentsForItem(env, existing.ID, updatedBy);
  await deleteRow(env, SHEET_EQUIPMENT, existing._row);
  await appendAuditLog(env, "equipment_delete", updatedBy, { itemId, name: existing.Name });
  return { success: true };
}
