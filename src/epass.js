/**
 * e-pass (κάρτες διοδίων Αττικής Οδού) — ίδιο μοτίβο με src/equipment.js,
 * ΑΛΛΑ κάθε κάρτα μπορεί να είναι ανατεθειμένη ΚΑΙ σε τεχνικό ΚΑΙ σε
 * όχημα ταυτόχρονα (ρητή απαίτηση χρήστη) — π.χ. φυσικά μέσα στο αυτοκίνητο,
 * με συγκεκριμένο τεχνικό ως υπεύθυνο. Νέο φύλλο "EPass" στο Sheet — βλ.
 * SETUP.md για τη δομή.
 *
 * Όταν αλλάζει ο ανατεθειμένος τεχνικός Ή/ΚΑΙ το ανατεθειμένο όχημα, ανοίγει
 * αυτόματα χρέωση στο φύλλο Χρεώσεις (src/assignments.js, syncEpassAssignment).
 */

import { readSheetAsObjects, appendRow, updateRow, deleteRow, appendAuditLog } from "./sheets.js";
import { syncEpassAssignment, closeOpenAssignmentsForItem } from "./assignments.js";

const SHEET_EPASS = "EPass";
const SHEET_EMPLOYEES = "Υπάλληλοι";
const SHEET_FLEET = "Στόλος";
const EPASS_HEADER_ORDER = [
  "ID", "Label", "AssignedTechnicianId", "AssignedTechnicianName",
  "AssignedVehicleId", "AssignedVehiclePlate", "Status", "Note", "UpdatedBy", "UpdatedAt",
];

export async function listEpass(env) {
  const items = await readSheetAsObjects(env, SHEET_EPASS);
  return items.sort((a, b) => (a.Label || "").localeCompare(b.Label || "", "el"));
}

/** Λίστες για τα dropdowns "Τεχνικός"/"Όχημα" της φόρμας ανάθεσης */
export async function listEpassDrivers(env) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees
    .map((e) => ({ EmployeeID: e.EmployeeID, Name: e.Name }))
    .filter((e) => e.Name)
    .sort((a, b) => a.Name.localeCompare(b.Name, "el"));
}

export async function listEpassVehicles(env) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  return vehicles
    .map((v) => ({ ID: v.ID, Plate: v.Plate }))
    .filter((v) => v.Plate)
    .sort((a, b) => a.Plate.localeCompare(b.Plate, "el"));
}

export async function addEpass(env, { label, technicianId, vehiclePlate, status, note, updatedBy }) {
  if (!label) throw new Error("Χρειάζεται ετικέτα/κωδικός e-pass.");

  const technician = technicianId ? (await readSheetAsObjects(env, SHEET_EMPLOYEES)).find((e) => e.EmployeeID === technicianId) : null;

  const row = {
    ID: crypto.randomUUID(),
    Label: label,
    AssignedTechnicianId: technician ? technician.EmployeeID : "",
    AssignedTechnicianName: technician ? technician.Name : "",
    AssignedVehicleId: "",
    AssignedVehiclePlate: vehiclePlate || "",
    Status: status || "Ενεργό",
    Note: note || "",
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
  };
  // Βρες το ID οχήματος από την πινακίδα, αν δόθηκε
  if (vehiclePlate) {
    const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
    const vehicle = vehicles.find((v) => v.Plate === vehiclePlate);
    if (vehicle) row.AssignedVehicleId = vehicle.ID;
  }

  await appendRow(env, SHEET_EPASS, row, EPASS_HEADER_ORDER);
  await appendAuditLog(env, "epass_add", updatedBy, { label, technicianId, vehiclePlate });

  await syncEpassAssignment(env, {
    itemId: row.ID,
    itemLabel: row.Label,
    previousTechnician: "",
    newTechnician: row.AssignedTechnicianName,
    previousVehiclePlate: "",
    newVehiclePlate: row.AssignedVehiclePlate,
    actor: updatedBy,
  });

  return { success: true, item: row };
}

export async function updateEpass(env, itemId, updates, updatedBy) {
  const items = await readSheetAsObjects(env, SHEET_EPASS);
  const existing = items.find((v) => v.ID === itemId);
  if (!existing) throw new Error("Το e-pass δεν βρέθηκε.");

  let technicianId = updates.technicianId !== undefined ? updates.technicianId : existing.AssignedTechnicianId;
  let technicianName = existing.AssignedTechnicianName;
  if (updates.technicianId !== undefined) {
    const technician = technicianId
      ? (await readSheetAsObjects(env, SHEET_EMPLOYEES)).find((e) => e.EmployeeID === technicianId)
      : null;
    technicianId = technician ? technician.EmployeeID : "";
    technicianName = technician ? technician.Name : "";
  }

  let vehiclePlate = updates.vehiclePlate !== undefined ? updates.vehiclePlate : existing.AssignedVehiclePlate;
  let vehicleId = existing.AssignedVehicleId;
  if (updates.vehiclePlate !== undefined) {
    const vehicle = vehiclePlate
      ? (await readSheetAsObjects(env, SHEET_FLEET)).find((v) => v.Plate === vehiclePlate)
      : null;
    vehicleId = vehicle ? vehicle.ID : "";
  }

  const merged = {
    ID: existing.ID,
    Label: updates.label !== undefined ? updates.label : existing.Label,
    AssignedTechnicianId: technicianId || "",
    AssignedTechnicianName: technicianName || "",
    AssignedVehicleId: vehicleId || "",
    AssignedVehiclePlate: vehiclePlate || "",
    Status: updates.status !== undefined ? updates.status : existing.Status,
    Note: updates.note !== undefined ? updates.note : existing.Note,
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
  };
  const values = EPASS_HEADER_ORDER.map((h) => (merged[h] !== undefined ? merged[h] : ""));
  await updateRow(env, SHEET_EPASS, existing._row, values);
  await appendAuditLog(env, "epass_update", updatedBy, { itemId, updates });

  await syncEpassAssignment(env, {
    itemId: existing.ID,
    itemLabel: merged.Label,
    previousTechnician: existing.AssignedTechnicianName,
    newTechnician: merged.AssignedTechnicianName,
    previousVehiclePlate: existing.AssignedVehiclePlate,
    newVehiclePlate: merged.AssignedVehiclePlate,
    actor: updatedBy,
  });

  return { success: true, item: merged };
}

export async function deleteEpass(env, itemId, updatedBy) {
  const items = await readSheetAsObjects(env, SHEET_EPASS);
  const existing = items.find((v) => v.ID === itemId);
  if (!existing) throw new Error("Το e-pass δεν βρέθηκε.");

  await closeOpenAssignmentsForItem(env, existing.ID, updatedBy);
  await deleteRow(env, SHEET_EPASS, existing._row);
  await appendAuditLog(env, "epass_delete", updatedBy, { itemId, label: existing.Label });
  return { success: true };
}
