/**
 * Στόλος οχημάτων — business logic. Κοινός για όλους τους Team Leaders
 * (όχι team-scoped, βλ. απόφαση χρήστη), πλήρες CRUD (add/edit/delete).
 * Χρησιμοποιεί το ίδιο Google Sheet με τις άδειες, νέο tab "Στόλος".
 */

import { readSheetAsObjects, appendRow, updateRow, updateCell, deleteRow, appendAuditLog } from "./sheets.js";
import { syncVehicleAssignment, closeOpenAssignmentsForItem } from "./assignments.js";
import { listEpass } from "./epass.js";

const SHEET_FLEET = "Στόλος";
const SHEET_EMPLOYEES = "Υπάλληλοι";
const SHEET_ACCIDENTS = "ΑτυχήματαΟχημάτων";
// KteoDate/ServiceDate/Deductible προστέθηκαν στο τέλος (ΟΧΙ ανάμεσα σε
// υπάρχουσες στήλες) ώστε να μη μετατοπιστούν οι στήλες με ήδη υπάρχοντα
// δεδομένα. ΑΠΑΙΤΕΙΤΑΙ να υπάρχουν οι αντίστοιχες επικεφαλίδες στο Google
// Sheet — αλλιώς readSheetAsObjects() δεν θα τις διαβάζει πίσω σωστά (βλ.
// CLAUDE.md/SETUP.md). Deductible = απαλλακτικό ασφάλισης σε €, σταθερή
// τιμή ανά όχημα (ρητή απόφαση χρήστη) — καθαρά πληροφοριακό πεδίο, καμία
// λογική ασφάλισης/υπολογισμού.
// CurrentMileage = "τρέχοντα χιλιόμετρα" του οχήματος — ρητή απαίτηση
// χρήστη: ο TL το καταχωρεί/διορθώνει από τη φόρμα οχήματος (αρχική τιμή
// αναφοράς), και ενημερώνεται αυτόματα κάθε φορά που ένας τεχνικός
// καταγράφει επιστροφή οχήματος (βλ. setVehicleReturnMileage στο
// src/assignments.js) — ώστε να είναι πάντα η πιο πρόσφατη γνωστή ένδειξη,
// χωρίς να χρειάζεται χειροκίνητο συγχρονισμό ανάμεσα σε TL/τεχνικούς.
// InsuranceCompany/PolicyNumber/InsuranceRenewalDate προστέθηκαν ΣΤΟ ΤΕΛΟΣ
// (νέες στήλες — χειροκίνητο βήμα στο Sheet, βλ. CLAUDE.md), item #119
// «Στοιχεία ασφάλισης οχήματος» (15/08/2026) — καθαρά πληροφοριακά πεδία
// (εταιρεία ασφάλισης, αριθμός συμβολαίου, ημερομηνία ανανέωσης), ίδιο
// μοτίβο με το ήδη υπάρχον Deductible· καμία λογική υπολογισμού/ειδοποίησης
// λήξης εδώ (δεν ζητήθηκε — αν χρειαστεί ποτέ alert σαν το ΚΤΕΟ/Service, να
// ζητηθεί ρητά).
// ServiceEnteredAt (04/09/2026, ρητή απαίτηση χρήστη) — ημερομηνία που το
// όχημα μπήκε σε κατάσταση "Σε service" (συνεργείο) — αυτόματα διαχειριζόμενο
// πεδίο (ΟΧΙ επεξεργάσιμο από φόρμα): γράφεται server-side τη στιγμή που το
// Status αλλάζει ΣΕ "Σε service", καθαρίζεται όταν το Status αλλάζει ΕΞΩ από
// αυτό — βλ. addVehicle()/updateVehicle() παρακάτω. Επιτρέπει στο UI να δείχνει
// "Σε συνεργείο από <ημερομηνία> · X ημέρες" με ζωντανό μετρητή (υπολογισμός
// client-side σε κάθε render, καμία επιπλέον αποθήκευση).
const FLEET_HEADER_ORDER = ["ID", "Plate", "Type", "AssignedTo", "Status", "ServiceNote", "UpdatedBy", "UpdatedAt", "KteoDate", "ServiceDate", "Deductible", "CurrentMileage", "InsuranceCompany", "PolicyNumber", "InsuranceRenewalDate", "ServiceEnteredAt"];
const STATUS_IN_SERVICE = "Σε service";
const todayIso = () => new Date().toISOString().slice(0, 10);
const COL_CURRENT_MILEAGE = FLEET_HEADER_ORDER.indexOf("CurrentMileage") + 1;

/** Επιτρεπόμενοι τύποι αρχείου για συνημμένο ατυχήματος — PDF ή εικόνα, ίδιο μέγιστο μέγεθος (20MB) με τα υπόλοιπα συνημμένα */
export const ACCIDENT_ATTACHMENT_ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function listVehicles(env) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  return vehicles.sort((a, b) => (a.Plate || "").localeCompare(b.Plate || "", "el"));
}

/** Λίστα όλων των τεχνικών (για το dropdown "Ανατεθειμένος οδηγός") — όχι team-scoped, ο στόλος είναι κοινός */
export async function listDrivers(env) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees
    .map((e) => ({ EmployeeID: e.EmployeeID, Name: e.Name }))
    .filter((e) => e.Name)
    .sort((a, b) => a.Name.localeCompare(b.Name, "el"));
}

/** Μοναδικές τιμές Type ήδη καταχωρημένες στα οχήματα — για το dropdown "Τύπος" (+ επιλογή "Άλλος τύπος..." στο UI, ίδιο μοτίβο με Κατηγορία στο Εξοπλισμό). Χωρίς hardcoded λίστα. */
export async function listVehicleTypes(env) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  const types = new Set(vehicles.map((v) => (v.Type || "").trim()).filter(Boolean));
  return Array.from(types).sort((a, b) => a.localeCompare(b, "el"));
}

/**
 * Χάρτης vehicleId -> label ενεργού e-pass ανατεθειμένου σε αυτό — για τη
 * στήλη "e-pass" στη λίστα οχημάτων (ρητό αίτημα χρήστη). Πηγή είναι
 * απευθείας το φύλλο EPass (AssignedVehicleId), ίδιο πεδίο που ήδη
 * καθορίζει το ποιο όχημα έχει "πάνω του" ένα e-pass — όχι το φύλλο
 * Χρεώσεις (που είναι απλά το ιστορικό/ειδοποιήσεις).
 */
export async function listVehicleEpassMap(env) {
  const items = await listEpass(env);
  const map = {};
  for (const it of items) {
    if (it.AssignedVehicleId) map[it.AssignedVehicleId] = it.Label;
  }
  return map;
}

export async function addVehicle(env, { plate, type, assignedTo, status, serviceNote, kteoDate, serviceDate, deductible, currentMileage, insuranceCompany, policyNumber, insuranceRenewalDate, updatedBy }) {
  if (!plate) throw new Error("Χρειάζεται πινακίδα.");
  const row = {
    ID: crypto.randomUUID(),
    Plate: plate,
    Type: type || "",
    AssignedTo: assignedTo || "",
    Status: status || "Ενεργό",
    ServiceNote: serviceNote || "",
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
    KteoDate: kteoDate || "",
    ServiceDate: serviceDate || "",
    Deductible: deductible !== undefined && deductible !== "" && deductible !== null ? Number(deductible) : "",
    CurrentMileage: currentMileage !== undefined && currentMileage !== "" && currentMileage !== null ? Number(currentMileage) : "",
    InsuranceCompany: insuranceCompany || "",
    PolicyNumber: policyNumber || "",
    InsuranceRenewalDate: insuranceRenewalDate || "",
    ServiceEnteredAt: (status || "Ενεργό") === STATUS_IN_SERVICE ? todayIso() : "",
  };
  await appendRow(env, SHEET_FLEET, row, FLEET_HEADER_ORDER);
  await appendAuditLog(env, "fleet_add", updatedBy, { plate, type });

  // Αν το όχημα ανατέθηκε ήδη κατά τη δημιουργία, άνοιξε χρέωση + email
  await syncVehicleAssignment(env, {
    vehicleId: row.ID,
    plate: row.Plate,
    previousDriver: "",
    newDriver: row.AssignedTo,
    actor: updatedBy,
  });

  return { success: true, vehicle: row };
}

export async function updateVehicle(env, vehicleId, updates, updatedBy) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  const existing = vehicles.find((v) => v.ID === vehicleId);
  if (!existing) throw new Error("Το όχημα δεν βρέθηκε.");

  const merged = {
    ID: existing.ID,
    Plate: updates.plate !== undefined ? updates.plate : existing.Plate,
    Type: updates.type !== undefined ? updates.type : existing.Type,
    AssignedTo: updates.assignedTo !== undefined ? updates.assignedTo : existing.AssignedTo,
    Status: updates.status !== undefined ? updates.status : existing.Status,
    ServiceNote: updates.serviceNote !== undefined ? updates.serviceNote : existing.ServiceNote,
    UpdatedBy: updatedBy || "",
    UpdatedAt: new Date().toISOString(),
    KteoDate: updates.kteoDate !== undefined ? updates.kteoDate : existing.KteoDate,
    ServiceDate: updates.serviceDate !== undefined ? updates.serviceDate : existing.ServiceDate,
    Deductible: updates.deductible !== undefined ? (updates.deductible !== "" ? Number(updates.deductible) : "") : existing.Deductible,
    CurrentMileage: updates.currentMileage !== undefined ? (updates.currentMileage !== "" ? Number(updates.currentMileage) : "") : existing.CurrentMileage,
    InsuranceCompany: updates.insuranceCompany !== undefined ? updates.insuranceCompany : existing.InsuranceCompany,
    PolicyNumber: updates.policyNumber !== undefined ? updates.policyNumber : existing.PolicyNumber,
    InsuranceRenewalDate: updates.insuranceRenewalDate !== undefined ? updates.insuranceRenewalDate : existing.InsuranceRenewalDate,
  };
  // ServiceEnteredAt — αγνοεί ΟΠΟΙΑΔΗΠΟΤΕ τιμή σταλεί από το client (δεν
  // εκτίθεται καν σε φόρμα) — παράγεται αποκλειστικά από τη μετάβαση
  // κατάστασης: μπαίνει τώρα όταν το Status μόλις έγινε "Σε service" (δεν
  // ήταν ήδη), καθαρίζει όταν βγαίνει από "Σε service", αλλιώς μένει όπως
  // ήταν (π.χ. επεξεργασία άλλου πεδίου ενώ είναι ήδη σε service δεν
  // μηδενίζει τον μετρητή ημερών).
  if (merged.Status === STATUS_IN_SERVICE && existing.Status !== STATUS_IN_SERVICE) {
    merged.ServiceEnteredAt = todayIso();
  } else if (merged.Status !== STATUS_IN_SERVICE && existing.Status === STATUS_IN_SERVICE) {
    merged.ServiceEnteredAt = "";
  } else {
    merged.ServiceEnteredAt = existing.ServiceEnteredAt || "";
  }
  const values = FLEET_HEADER_ORDER.map((h) => merged[h] !== undefined ? merged[h] : "");
  await updateRow(env, SHEET_FLEET, existing._row, values);
  await appendAuditLog(env, "fleet_update", updatedBy, { vehicleId, updates });

  // Αλλαγή οδηγού -> κλείσε παλιά χρέωση (ημ/νία αποχρέωσης) + άνοιξε νέα + email
  await syncVehicleAssignment(env, {
    vehicleId: existing.ID,
    plate: merged.Plate,
    previousDriver: existing.AssignedTo,
    newDriver: merged.AssignedTo,
    actor: updatedBy,
  });

  return { success: true, vehicle: merged };
}

export async function deleteVehicle(env, vehicleId, updatedBy) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  const existing = vehicles.find((v) => v.ID === vehicleId);
  if (!existing) throw new Error("Το όχημα δεν βρέθηκε.");

  await closeOpenAssignmentsForItem(env, existing.ID, updatedBy);
  await deleteRow(env, SHEET_FLEET, existing._row);
  await appendAuditLog(env, "fleet_delete", updatedBy, { vehicleId, plate: existing.Plate });
  return { success: true };
}

/**
 * Ενημερώνει το "τρέχοντα χιλιόμετρα" ενός οχήματος — καλείται αυτόματα από
 * το src/assignments.js (setVehicleReturnMileage) κάθε φορά που ένας
 * τεχνικός καταγράφει επιστροφή οχήματος, ώστε το πεδίο να αντικατοπτρίζει
 * πάντα την πιο πρόσφατη γνωστή ένδειξη (ρητή απαίτηση χρήστη — αλυσίδα
 * παραλαβών/επιστροφών). Σιωπηλό no-op αν το όχημα δεν βρεθεί.
 */
export async function updateVehicleCurrentMileage(env, vehicleId, mileage) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  const vehicle = vehicles.find((v) => v.ID === vehicleId);
  if (!vehicle) return;
  await updateCell(env, SHEET_FLEET, vehicle._row, COL_CURRENT_MILEAGE, mileage);
}

// ============================================================
// ΑΤΥΧΗΜΑΤΑ ΟΧΗΜΑΤΩΝ — ξεχωριστό, προαιρετικό συμβάν (ρητή απόφαση χρήστη,
// ΔΕΝ είναι μέρος της φόρμας παραλαβής/χιλιομέτρων). Καταγράφεται από
// TL/Director (ίδιο gate `requireTeamLeader` με το υπόλοιπο tab Στόλος —
// βλ. CLAUDE.md). Νέο φύλλο "ΑτυχήματαΟχημάτων" — χειροκίνητο βήμα.
// ============================================================

const ACCIDENT_HEADER_ORDER = [
  "ID", "VehicleID", "VehiclePlate", "EmployeeID", "EmployeeName", "Date", "Comments",
  "FileKey", "FileName", "FileType", "ReportedBy", "ReportedAt",
];

/**
 * Δημιουργεί εγγραφή ατυχήματος. Ο οδηγός τη στιγμή του ατυχήματος
 * επιλέγεται ελεύθερα (dropdown τεχνικών, ίδια λίστα με listDrivers) —
 * μπορεί να διαφέρει από τον σημερινό ανατεθειμένο οδηγό του οχήματος,
 * γι' αυτό είναι ξεχωριστό πεδίο και όχι lookup στο AssignedTo. Το
 * συνημμένο (προαιρετικό) ανεβαίνει σε δεύτερο βήμα, ίδιο δίβημα με το
 * δικαιολογητικό αναρρωτικής άδειας — βλ. uploadAccidentAttachment.
 */
export async function reportVehicleAccident(env, { vehicleId, employeeId, date, comments, reportedBy }) {
  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  const vehicle = vehicles.find((v) => v.ID === vehicleId);
  if (!vehicle) throw new Error("Το όχημα δεν βρέθηκε.");

  let emp = null;
  if (employeeId) {
    const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
    emp = employees.find((e) => e.EmployeeID === employeeId) || null;
  }

  const row = {
    ID: crypto.randomUUID(),
    VehicleID: vehicle.ID,
    VehiclePlate: vehicle.Plate,
    EmployeeID: emp ? emp.EmployeeID : "",
    EmployeeName: emp ? emp.Name : "",
    Date: date || "",
    Comments: comments || "",
    FileKey: "",
    FileName: "",
    FileType: "",
    ReportedBy: reportedBy || "",
    ReportedAt: new Date().toISOString(),
  };
  await appendRow(env, SHEET_ACCIDENTS, row, ACCIDENT_HEADER_ORDER);
  await appendAuditLog(env, "vehicle_accident_report", reportedBy, { vehicleId, plate: vehicle.Plate, date });
  return { success: true, accident: row };
}

/** Ιστορικό ατυχημάτων ενός οχήματος, πιο πρόσφατα πρώτα */
export async function listVehicleAccidents(env, vehicleId) {
  const all = await readSheetAsObjects(env, SHEET_ACCIDENTS);
  return all
    .filter((a) => a.VehicleID === vehicleId)
    .sort((a, b) => String(b.Date || "").localeCompare(String(a.Date || "")));
}

/**
 * Ανέβασμα συνημμένου συμβάντος (ΕΝΑ αρχείο ανά ατύχημα — φωτογραφία ή
 * PDF αναφοράς, ρητή απόφαση χρήστη, όχι πολλαπλά όπως στην παραλαβή).
 * Ίδιο μοτίβο raw-bytes με uploadEmployeeDocument/uploadLeaveAttachment.
 */
export async function uploadAccidentAttachment(env, { accidentId, bytes, fileName, contentType }) {
  if (!ACCIDENT_ATTACHMENT_ALLOWED_TYPES[contentType]) {
    throw new Error("Επιτρέπεται μόνο PDF ή εικόνα (JPG/PNG).");
  }
  if (!env.FLEET_FILES) {
    throw new Error("Η αποθήκευση συνημμένων ατυχήματος δεν είναι ρυθμισμένη (λείπει το KV binding FLEET_FILES).");
  }
  const all = await readSheetAsObjects(env, SHEET_ACCIDENTS);
  const row = all.find((a) => a.ID === accidentId);
  if (!row) throw new Error("Το ατύχημα δεν βρέθηκε.");

  const fileKey = `fleet:accident:${crypto.randomUUID()}`;
  await env.FLEET_FILES.put(fileKey, bytes);

  const keyCol = ACCIDENT_HEADER_ORDER.indexOf("FileKey") + 1;
  const nameCol = ACCIDENT_HEADER_ORDER.indexOf("FileName") + 1;
  const typeCol = ACCIDENT_HEADER_ORDER.indexOf("FileType") + 1;
  await updateCell(env, SHEET_ACCIDENTS, row._row, keyCol, fileKey);
  await updateCell(env, SHEET_ACCIDENTS, row._row, nameCol, fileName || "συμβάν.pdf");
  await updateCell(env, SHEET_ACCIDENTS, row._row, typeCol, contentType);

  return { success: true };
}

/** Λήψη συνημμένου συμβάντος ατυχήματος */
export async function getAccidentAttachment(env, accidentId) {
  if (!env.FLEET_FILES) return null;
  const all = await readSheetAsObjects(env, SHEET_ACCIDENTS);
  const row = all.find((a) => a.ID === accidentId);
  if (!row || !row.FileKey) return null;
  const bytes = await env.FLEET_FILES.get(row.FileKey, "arrayBuffer");
  if (!bytes) return null;
  return { bytes, fileName: row.FileName || "συμβάν.pdf", contentType: row.FileType || "application/pdf" };
}
