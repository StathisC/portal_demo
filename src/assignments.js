/**
 * Χρεώσεις τεχνικών — ό,τι έχει χρεωθεί πάνω σε έναν τεχνικό (ή/και όχημα,
 * βλ. e-pass παρακάτω). Για αρχή καλύπτει οχήματα (Type: "Όχημα"), αλλά η
 * δομή είναι γενική ώστε να μπορούν να προστεθούν αργότερα εργαλεία,
 * εξοπλισμός κλπ.
 *
 * Φύλλο "Χρεώσεις":
 *   ID | Type | ItemID | ItemLabel | EmployeeID | EmployeeName |
 *   ChargedAt | ReleasedAt | ChargedBy | ReleasedBy | VehicleId | VehiclePlate
 *
 * VehicleId/VehiclePlate προστέθηκαν ΣΤΟ ΤΕΛΟΣ (νέες στήλες — χειροκίνητο
 * βήμα στο Sheet, βλ. CLAUDE.md/SETUP.md) για το e-pass: μια χρέωση e-pass
 * μπορεί να δείχνει ΚΑΙ σε τεχνικό (EmployeeID/EmployeeName) ΚΑΙ σε όχημα
 * (VehicleId/VehiclePlate) ταυτόχρονα — ρητή απαίτηση χρήστη. Για τα
 * υπάρχοντα Type ("Όχημα", εξοπλισμός) αυτές οι 2 στήλες μένουν κενές.
 *
 * Ανοιχτή χρέωση = ReleasedAt κενό.
 */

import { readSheetAsObjects, appendRow, updateCell, appendAuditLog } from "./sheets.js";
import { sendEmail, emailTemplate, resolveActorName, PORTAL_URL, logEmailFailure } from "./email.js";
import { updateVehicleCurrentMileage } from "./fleet.js";
import { normalizeSheetDate } from "./dateutil.js";

const SHEET_CHARGES = "Χρεώσεις";
const SHEET_EMPLOYEES = "Υπάλληλοι";
const SHEET_TEAMLEADERS = "TeamLeaders";
const SHEET_FLEET = "Στόλος";
const SHEET_EQUIPMENT = "Εξοπλισμός";
// PickupMileage/PickupPhotos προστέθηκαν ΣΤΟ ΤΕΛΟΣ (νέες στήλες — χειροκίνητο
// βήμα στο Sheet, βλ. CLAUDE.md) για την «παραλαβή οχήματος» (ρητή απαίτηση
// χρήστη): ο τεχνικός καταγράφει χιλιόμετρα + πολλαπλές φωτογραφίες όταν
// παραλαμβάνει φυσικά ένα όχημα που του ανατέθηκε. Ισχύει ΜΟΝΟ για
// Type === "Όχημα" — τα υπόλοιπα Types αφήνουν αυτές τις 2 στήλες κενές.
// PickupPhotos = JSON string, array από {fileKey, fileName, fileType}
// (πολλαπλές φωτογραφίες ανά χρέωση, ίδιο KV namespace FLEET_FILES με τα
// συνημμένα ατυχήματος του src/fleet.js).
// ReturnMileage προστέθηκε ΣΤΟ ΤΕΛΟΣ (νέα στήλη — χειροκίνητο βήμα στο
// Sheet, βλ. CLAUDE.md) — ρητή απαίτηση χρήστη: ο ΙΔΙΟΣ ο τεχνικός
// καταγράφει τα χιλιόμετρα και όταν επιστρέφει φυσικά το όχημα (όχι μόνο
// στην παραλαβή πια), όποτε αυτό συμβεί — ανεξάρτητο από το πότε ο TL
// αλλάζει τον ανατεθειμένο οδηγό στο Στόλος. Κάθε καταγραφή επιστροφής
// ενημερώνει αυτόματα και το CurrentMileage του οχήματος (βλ.
// setVehicleReturnMileage) ώστε ο επόμενος τεχνικός/ο TL να βλέπει πάντα
// την πιο πρόσφατη ένδειξη.
// PickupDate/ReturnDate προστέθηκαν ΣΤΟ ΤΕΛΟΣ (νέες στήλες — χειροκίνητο
// βήμα στο Sheet, βλ. CLAUDE.md) — item #9 "Ημερολόγιο τεχνικού" (15/08/2026,
// ρητή απαίτηση χρήστη): το PickupMileage/ReturnMileage είναι μόνο αριθμοί,
// ΧΩΡΙΣ δική τους ημερομηνία (η στιγμή που ο τεχνικός τα καταχώρησε δεν
// ταυτίζεται πάντα με το ChargedAt/ReleasedAt της χρέωσης — βλ. σχόλια στο
// setVehicleReturnMileage). Χρειάστηκε ξεχωριστό timestamp ανά ενέργεια για
// να μπορεί το ημερολόγιο τεχνικού να δείξει τη ΣΩΣΤΗ ημερομηνία παραλαβής/
// επιστροφής, όχι απλά την ημερομηνία που άνοιξε/έκλεισε η χρέωση.
// OdometerPickupPhoto{Key,Name,Type}/OdometerReturnPhoto{Key,Name,Type}
// προστέθηκαν ΣΤΟ ΤΕΛΟΣ (νέες στήλες — χειροκίνητο βήμα στο Sheet, βλ.
// CLAUDE.md) — item #1 "Προς Συζήτηση" (15/08/2026, ρητή απαίτηση χρήστη):
// φωτογραφία κοντέρ (χιλιομετρητή) ΞΕΧΩΡΙΣΤΗ και ΥΠΟΧΡΕΩΤΙΚΗ από τις ήδη
// υπάρχουσες γενικές PickupPhotos, ΚΑΙ στην Παραλαβή ΚΑΙ στην Επιστροφή (η
// Επιστροφή μέχρι τώρα δεν είχε καμία φωτογραφία). ΕΝΑ αρχείο ανά ενέργεια
// (όχι JSON array) — ίδιο 3-column μοτίβο (Key/Name/Type) με το συνημμένο
// ατυχήματος στο src/fleet.js, ίδιο KV namespace FLEET_FILES.
const CHARGES_HEADER_ORDER = [
  "ID", "Type", "ItemID", "ItemLabel", "EmployeeID", "EmployeeName",
  "ChargedAt", "ReleasedAt", "ChargedBy", "ReleasedBy", "VehicleId", "VehiclePlate",
  "PickupMileage", "PickupPhotos", "ReturnMileage", "PickupDate", "ReturnDate",
  "OdometerPickupPhotoKey", "OdometerPickupPhotoName", "OdometerPickupPhotoType",
  "OdometerReturnPhotoKey", "OdometerReturnPhotoName", "OdometerReturnPhotoType",
];

const COL_RELEASED_AT = CHARGES_HEADER_ORDER.indexOf("ReleasedAt") + 1;
const COL_RELEASED_BY = CHARGES_HEADER_ORDER.indexOf("ReleasedBy") + 1;
const COL_PICKUP_MILEAGE = CHARGES_HEADER_ORDER.indexOf("PickupMileage") + 1;
const COL_PICKUP_PHOTOS = CHARGES_HEADER_ORDER.indexOf("PickupPhotos") + 1;
const COL_RETURN_MILEAGE = CHARGES_HEADER_ORDER.indexOf("ReturnMileage") + 1;
const COL_PICKUP_DATE = CHARGES_HEADER_ORDER.indexOf("PickupDate") + 1;
const COL_RETURN_DATE = CHARGES_HEADER_ORDER.indexOf("ReturnDate") + 1;
const COL_ODO_PICKUP_KEY = CHARGES_HEADER_ORDER.indexOf("OdometerPickupPhotoKey") + 1;
const COL_ODO_PICKUP_NAME = CHARGES_HEADER_ORDER.indexOf("OdometerPickupPhotoName") + 1;
const COL_ODO_PICKUP_TYPE = CHARGES_HEADER_ORDER.indexOf("OdometerPickupPhotoType") + 1;
const COL_ODO_RETURN_KEY = CHARGES_HEADER_ORDER.indexOf("OdometerReturnPhotoKey") + 1;
const COL_ODO_RETURN_NAME = CHARGES_HEADER_ORDER.indexOf("OdometerReturnPhotoName") + 1;
const COL_ODO_RETURN_TYPE = CHARGES_HEADER_ORDER.indexOf("OdometerReturnPhotoType") + 1;

/** Επιτρεπόμενοι τύποι αρχείου για φωτογραφίες παραλαβής — μόνο εικόνες, ίδιο μέγιστο μέγεθος (20MB) με τα υπόλοιπα συνημμένα */
export const PICKUP_PHOTO_ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Χρεώσεις που άνοιξαν Ή έκλεισαν ΣΗΜΕΡΑ, για συγκεκριμένα employeeIds —
 * για το συγκεντρωτικό daily email χρεώσεων ανά TL (βλ. src/reports.js,
 * sendDailyChargesDigest). Ρητή απόφαση χρήστη: μόνο σημερινή κίνηση, όχι
 * όλες οι τρέχουσες ανοιχτές χρεώσεις.
 */
export async function listTodaysChargesForEmployees(env, employeeIds) {
  if (!employeeIds || !employeeIds.length) return [];
  const today = todayISO();
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  return all.filter(
    (a) => employeeIds.includes(String(a.EmployeeID)) && (a.ChargedAt === today || a.ReleasedAt === today)
  );
}

async function findEmployeeByName(env, name) {
  if (!name) return null;
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees.find((e) => e.Name === name) || null;
}

/**
 * Όλες οι χρεώσεις ενός τεχνικού (ανοιχτές πρώτα, μετά κλειστές, νεότερες
 * πρώτα). Οι χρεώσεις οχήματος εμπλουτίζονται με το Deductible (απαλλαγή)
 * του ίδιου του οχήματος — ρητή απαίτηση χρήστη να φαίνεται στο ιστορικό
 * χρεώσεων, χωρίς να αποθηκεύεται ξανά στο ίδιο το Χρεώσεις (πηγή
 * αλήθειας παραμένει το Στόλος sheet, εδώ γίνεται μόνο lookup).
 */
export async function listAssignmentsForEmployee(env, employeeId) {
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const mine = all.filter((a) => a.EmployeeID === employeeId);

  const vehicleIds = [...new Set(mine.filter((a) => a.Type === "Όχημα" && a.ItemID).map((a) => a.ItemID))];
  let deductibleMap = {};
  if (vehicleIds.length) {
    const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
    deductibleMap = Object.fromEntries(vehicles.map((v) => [v.ID, v.Deductible]));
  }

  return mine
    .map((a) => (a.Type === "Όχημα" ? { ...a, Deductible: deductibleMap[a.ItemID] ?? "" } : a))
    .sort((a, b) => {
      const aOpen = !a.ReleasedAt, bOpen = !b.ReleasedAt;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return String(b.ChargedAt || "").localeCompare(String(a.ChargedAt || ""));
    });
}

/**
 * Στοιχεία τεχνικού + ό,τι έχει ΤΩΡΑ πάνω του (μόνο ανοιχτές χρεώσεις,
 * οχήματα + εξοπλισμός + e-pass μαζί — ίδιο σύνολο με το tab "Στην Κατοχή
 * μου" του ίδιου του τεχνικού). Για την αναζήτηση τεχνικού στο tab
 * Εξοπλισμός (TL/Director) + το PDF παράδοσης/παραλαβής (browser print, βλ.
 * hub.html) — ρητή απόφαση χρήστη: το PDF δείχνει ΟΛΑ όσα έχει πάνω του,
 * όχι μόνο εξοπλισμό.
 */
export async function getTechnicianHoldings(env, employeeId) {
  // Παράλληλα, ανεξάρτητα reads — fix ταχύτητας 25/08/2026. Ο έλεγχος "δεν
  // βρέθηκε" γίνεται μετά, το κόστος είναι αμελητέο στη σπάνια περίπτωση
  // λάθος employeeId.
  const [employees, all] = await Promise.all([
    readSheetAsObjects(env, SHEET_EMPLOYEES),
    listAssignmentsForEmployee(env, employeeId),
  ]);
  const employee = employees.find((e) => e.EmployeeID === employeeId);
  if (!employee) throw new Error("Ο τεχνικός δεν βρέθηκε.");
  let holdings = all.filter((a) => !a.ReleasedAt);

  // Εμπλουτισμός με Σειριακό Αριθμό για τα holdings εξοπλισμού (όχι
  // Όχημα/e-pass) — ρητή απαίτηση χρήστη, 05/09/2026, για το «Στην κατοχή
  // του τώρα» του Προφίλ Τεχνικού (ωφελεί αυτόματα και την Αναζήτηση
  // τεχνικού στο tab Εξοπλισμός, ίδιο shared getTechnicianHoldings()).
  // Διαβάζει το φύλλο Εξοπλισμός ΜΟΝΟ αν υπάρχει έστω ένα τέτοιο holding
  // (lazy, ίδιο σκεπτικό με το conditional read του Στόλου παρακάτω —
  // αποφυγή περιττού API call).
  const hasEquipmentHolding = holdings.some((h) => h.Type !== "Όχημα" && h.Type !== "e-pass");
  if (hasEquipmentHolding) {
    const equipmentItems = await readSheetAsObjects(env, SHEET_EQUIPMENT);
    const equipmentById = new Map(equipmentItems.map((i) => [i.ID, i]));
    holdings = holdings.map((h) => {
      if (h.Type === "Όχημα" || h.Type === "e-pass") return h;
      const eq = equipmentById.get(h.ItemID);
      return eq && eq.SerialNumber ? { ...h, SerialNumber: eq.SerialNumber } : h;
    });
  }

  return { employee, holdings };
}

/** Κλείνει τυχόν ανοιχτή χρέωση για ένα αντικείμενο (π.χ. όταν αλλάζει οδηγός) */
export async function closeOpenAssignmentsForItem(env, itemId, releasedBy) {
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const open = all.filter((a) => a.ItemID === itemId && !a.ReleasedAt);
  const released = todayISO();
  for (const a of open) {
    await updateCell(env, SHEET_CHARGES, a._row, COL_RELEASED_AT, released);
    await updateCell(env, SHEET_CHARGES, a._row, COL_RELEASED_BY, releasedBy || "");
  }
  return open;
}

/**
 * Ανοίγει νέα χρέωση + στέλνει άμεσο email ΜΟΝΟ στον τεχνικό (πραγματικά
 * χρήσιμο real-time — π.χ. "μόλις σου χρεώθηκε το όχημα Χ"). Ο TL ΔΕΝ
 * ειδοποιείται πλέον άμεσα ανά χρέωση (ρητή απόφαση χρήστη, για να μην
 * χτυπάει το όριο των 100 παραλήπτες/ημέρα του consumer Gmail relay) —
 * παίρνει συγκεντρωτικό daily email στις 19:00 με όλη τη σημερινή κίνηση
 * της ομάδας του (βλ. src/reports.js, sendDailyChargesDigest).
 */
export async function openAssignment(env, { type, itemId, itemLabel, employeeName, chargedBy }) {
  const emp = await findEmployeeByName(env, employeeName);
  if (!emp) return null; // ο οδηγός δεν είναι καταχωρημένος τεχνικός — δεν χρεώνουμε

  const chargedAt = todayISO();
  const row = {
    ID: crypto.randomUUID(),
    Type: type,
    ItemID: itemId,
    ItemLabel: itemLabel,
    EmployeeID: emp.EmployeeID,
    EmployeeName: emp.Name,
    ChargedAt: chargedAt,
    ReleasedAt: "",
    ChargedBy: chargedBy || "",
    ReleasedBy: "",
  };
  await appendRow(env, SHEET_CHARGES, row, CHARGES_HEADER_ORDER);
  await appendAuditLog(env, "charge_open", chargedBy, { type, itemLabel, employeeId: emp.EmployeeID });

  // Email ΜΟΝΟ στον τεχνικό (αν έχει email καταχωρημένο) — ο TL φαίνεται
  // στο σώμα του email πληροφοριακά, αλλά ΔΕΝ ειδοποιείται άμεσα (βλ. σχόλιο
  // συνάρτησης παραπάνω).
  const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
  const leader = leaders.find((l) => l.Email === emp.TeamLeaderEmail);
  const recipients = [emp.Email].filter(Boolean);
  const actorName = await resolveActorName(env, chargedBy);

  const emailResult = await sendEmail(env, {
    to: recipients,
    subject: `Χρέωση: ${itemLabel}`,
    html: emailTemplate({
      badge: "Νέα χρέωση",
      badgeColor: "blue",
      title: "Νέα χρέωση",
      intro: `Χρεώθηκε <strong>${itemLabel}</strong> στον/στην <strong>${emp.Name}</strong>.`,
      rows: [
        ["Είδος", type],
        ["Αντικείμενο", itemLabel],
        ["Τεχνικός", emp.Name],
        ["Ημ/νία χρέωσης", chargedAt],
        ["Καταχωρήθηκε από", actorName || "—"],
        ["Team Leader", leader ? leader.Name : emp.TeamLeaderEmail || "—"],
      ],
      ctaText: "Άνοιγμα Portal",
      ctaUrl: `${PORTAL_URL}/hub`,
      footer: "Δες όλα τα αντικείμενά σου στο tab «Στην Κατοχή μου» του OptikiTec Portal.",
    }),
    replyTo: chargedBy,
    replyToName: actorName,
  });
  await logEmailFailure(env, "charge_email_failed", chargedBy, emailResult, { type, itemLabel, employeeId: emp.EmployeeID, to: recipients });

  return row;
}

/**
 * Συγχρονίζει τις χρεώσεις όταν αλλάζει ο ανατεθειμένος οδηγός ενός οχήματος.
 * Κλείνει την προηγούμενη χρέωση (γράφοντας ημερομηνία αποχρέωσης) και
 * ανοίγει νέα για τον νέο οδηγό.
 */
export async function syncVehicleAssignment(env, { vehicleId, plate, previousDriver, newDriver, actor }) {
  if ((previousDriver || "") === (newDriver || "")) return { changed: false };

  if (previousDriver) {
    await closeOpenAssignmentsForItem(env, vehicleId, actor);
  }
  if (newDriver) {
    await openAssignment(env, {
      type: "Όχημα",
      itemId: vehicleId,
      itemLabel: plate,
      employeeName: newDriver,
      chargedBy: actor,
    });
  }
  return { changed: true };
}

/**
 * Ίδιο μοτίβο με το syncVehicleAssignment, για γενικό εξοπλισμό/αντικείμενα
 * (src/equipment.js) — κλείνει προηγούμενη χρέωση, ανοίγει νέα. Το `category`
 * του αντικειμένου γίνεται το `Type` της χρέωσης (π.χ. "Εργαλείο", "Laptop"),
 * fallback σε "Εξοπλισμός" αν δεν έχει οριστεί.
 */
export async function syncEquipmentAssignment(env, { itemId, itemLabel, category, previousDriver, newDriver, actor }) {
  if ((previousDriver || "") === (newDriver || "")) return { changed: false };

  if (previousDriver) {
    await closeOpenAssignmentsForItem(env, itemId, actor);
  }
  if (newDriver) {
    await openAssignment(env, {
      type: category || "Εξοπλισμός",
      itemId,
      itemLabel,
      employeeName: newDriver,
      chargedBy: actor,
    });
  }
  return { changed: true };
}

/**
 * Ανοίγει χρέωση e-pass — ΜΠΟΡΕΙ να δείχνει ΚΑΙ σε τεχνικό ΚΑΙ σε όχημα
 * ταυτόχρονα (ρητή απαίτηση χρήστη, βλ. CLAUDE.md), σε αντίθεση με το
 * openAssignment() που πάντα απαιτεί τεχνικό. Αν δοθεί μόνο όχημα (χωρίς
 * υπεύθυνο τεχνικό), η χρέωση ανοίγει κανονικά με άδειο EmployeeID/Name —
 * απλά δεν στέλνεται email τεχνικού (μόνο αν υπάρχει technicianName).
 */
async function openEpassAssignment(env, { itemId, itemLabel, technicianName, vehiclePlate, actor }) {
  const emp = technicianName ? await findEmployeeByName(env, technicianName) : null;

  let vehicle = null;
  if (vehiclePlate) {
    const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
    vehicle = vehicles.find((v) => v.Plate === vehiclePlate) || null;
  }

  const chargedAt = todayISO();
  const row = {
    ID: crypto.randomUUID(),
    Type: "e-pass",
    ItemID: itemId,
    ItemLabel: itemLabel,
    EmployeeID: emp ? emp.EmployeeID : "",
    EmployeeName: emp ? emp.Name : "",
    ChargedAt: chargedAt,
    ReleasedAt: "",
    ChargedBy: actor || "",
    ReleasedBy: "",
    VehicleId: vehicle ? vehicle.ID : "",
    VehiclePlate: vehiclePlate || "",
  };
  await appendRow(env, SHEET_CHARGES, row, CHARGES_HEADER_ORDER);
  await appendAuditLog(env, "charge_open", actor, { type: "e-pass", itemLabel, technicianName, vehiclePlate });

  if (emp) {
    // Ίδια αλλαγή με το openAssignment παραπάνω — ΜΟΝΟ ο τεχνικός ειδοποιείται άμεσα.
    const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
    const leader = leaders.find((l) => l.Email === emp.TeamLeaderEmail);
    const recipients = [emp.Email].filter(Boolean);
    const actorName = await resolveActorName(env, actor);

    const emailResult = await sendEmail(env, {
      to: recipients,
      subject: `Χρέωση: ${itemLabel}`,
      html: emailTemplate({
        badge: "Χρέωση e-pass",
        badgeColor: "blue",
        title: "Νέα χρέωση e-pass",
        intro: `Χρεώθηκε <strong>${itemLabel}</strong> στον/στην <strong>${emp.Name}</strong>${vehiclePlate ? ` (όχημα <strong>${vehiclePlate}</strong>)` : ""}.`,
        rows: [
          ["Είδος", "e-pass"],
          ["Αντικείμενο", itemLabel],
          ["Τεχνικός", emp.Name],
          ["Όχημα", vehiclePlate || "—"],
          ["Ημ/νία χρέωσης", chargedAt],
          ["Καταχωρήθηκε από", actorName || "—"],
          ["Team Leader", leader ? leader.Name : emp.TeamLeaderEmail || "—"],
        ],
        ctaText: "Άνοιγμα Portal",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Δες όλα τα αντικείμενά σου στο tab «Στην Κατοχή μου» του OptikiTec Portal.",
      }),
      replyTo: actor,
      replyToName: actorName,
    });
    await logEmailFailure(env, "charge_email_failed", actor, emailResult, { type: "e-pass", itemLabel, employeeId: emp.EmployeeID, to: recipients });
  }

  return row;
}

/**
 * Συγχρονίζει τις χρεώσεις όταν αλλάζει ο ανατεθειμένος τεχνικός Ή/ΚΑΙ το
 * ανατεθειμένο όχημα ενός e-pass (src/epass.js). Κλείνει την προηγούμενη
 * ανοιχτή χρέωση και ανοίγει νέα ΜΟΝΟ αν άλλαξε κάτι, ίδιο μοτίβο με τα
 * syncVehicleAssignment/syncEquipmentAssignment.
 */
export async function syncEpassAssignment(env, { itemId, itemLabel, previousTechnician, newTechnician, previousVehiclePlate, newVehiclePlate, actor }) {
  const changed = (previousTechnician || "") !== (newTechnician || "") || (previousVehiclePlate || "") !== (newVehiclePlate || "");
  if (!changed) return { changed: false };

  if (previousTechnician || previousVehiclePlate) {
    await closeOpenAssignmentsForItem(env, itemId, actor);
  }
  if (newTechnician || newVehiclePlate) {
    await openEpassAssignment(env, {
      itemId,
      itemLabel,
      technicianName: newTechnician,
      vehiclePlate: newVehiclePlate,
      actor,
    });
  }
  return { changed: true };
}

// ============================================================
// ΠΑΡΑΛΑΒΗ ΟΧΗΜΑΤΟΣ (χιλιόμετρα + πολλαπλές φωτογραφίες) — ρητή απαίτηση
// χρήστη: το συμπληρώνει ο ΙΔΙΟΣ ο τεχνικός από το tab «Στην Κατοχή μου»,
// όταν παραλαμβάνει φυσικά ένα όχημα. Μόνο μία καταγραφή ανά ανοιχτή
// χρέωση (μόνο στην παραλαβή, ΟΧΙ και στην επιστροφή — καμία διαφορά χλμ).
// ============================================================

/** Καταγράφει τα χιλιόμετρα παραλαβής για μια ανοιχτή χρέωση οχήματος — ο caller (index.js) έχει ήδη επιβεβαιώσει ότι η χρέωση ανήκει στον τεχνικό */
export async function setVehiclePickupMileage(env, { chargeId, employeeId, mileage }) {
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) throw new Error("Η χρέωση δεν βρέθηκε.");
  if (charge.Type !== "Όχημα") throw new Error("Η καταγραφή παραλαβής ισχύει μόνο για οχήματα.");
  if (String(charge.EmployeeID) !== String(employeeId)) throw new Error("Αυτή η χρέωση δεν είναι δική σου.");
  if (charge.ReleasedAt) throw new Error("Η χρέωση έχει ήδη κλείσει.");

  await updateCell(env, SHEET_CHARGES, charge._row, COL_PICKUP_MILEAGE, mileage !== undefined && mileage !== "" ? Number(mileage) : "");
  await updateCell(env, SHEET_CHARGES, charge._row, COL_PICKUP_DATE, todayISO());
  return { success: true };
}

/**
 * Καταγράφει τα χιλιόμετρα επιστροφής για μια χρέωση οχήματος — ρητή
 * απαίτηση χρήστη (αναθεωρεί την παλιότερη απόφαση "μόνο παραλαβή"): ο
 * ΙΔΙΟΣ ο τεχνικός το καταχωρεί όποτε επιστρέφει φυσικά το όχημα,
 * ανεξάρτητα από το πότε ο TL θα αλλάξει τον ανατεθειμένο οδηγό στο
 * Στόλος. Χρειάζεται να υπάρχει ήδη PickupMileage (δεν έχει νόημα
 * επιστροφή χωρίς καταγεγραμμένη παραλαβή). ΔΕΝ απαιτεί η χρέωση να είναι
 * ακόμα ανοιχτή — ο τεχνικός μπορεί να επιστρέψει το όχημα πριν προλάβει
 * ο TL να ενημερώσει το σύστημα. Ενημερώνει αυτόματα και το CurrentMileage
 * του οχήματος (βλ. src/fleet.js) ώστε να είναι πάντα η πιο πρόσφατη
 * γνωστή ένδειξη για τον επόμενο τεχνικό/τον TL.
 */
export async function setVehicleReturnMileage(env, { chargeId, employeeId, mileage }) {
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) throw new Error("Η χρέωση δεν βρέθηκε.");
  if (charge.Type !== "Όχημα") throw new Error("Η καταγραφή επιστροφής ισχύει μόνο για οχήματα.");
  if (String(charge.EmployeeID) !== String(employeeId)) throw new Error("Αυτή η χρέωση δεν είναι δική σου.");
  if (!charge.PickupMileage) throw new Error("Καταχώρησε πρώτα τα χιλιόμετρα παραλαβής.");

  const value = mileage !== undefined && mileage !== "" ? Number(mileage) : "";
  await updateCell(env, SHEET_CHARGES, charge._row, COL_RETURN_MILEAGE, value);
  await updateCell(env, SHEET_CHARGES, charge._row, COL_RETURN_DATE, todayISO());
  if (value !== "" && charge.ItemID) {
    await updateVehicleCurrentMileage(env, charge.ItemID, value);
  }
  return { success: true };
}

/**
 * Ανεβάζει ΜΙΑ φωτογραφία παραλαβής (καλείται πολλές φορές, μία ανά
 * αρχείο — ρητή απαίτηση χρήστη, πολλαπλές φωτογραφίες ανά παραλαβή, ίδιο
 * μοτίβο "μία κλήση ανά αρχείο" με το nt-doc-* upload του Νέου Τεχνικού).
 * Προσθέτει στο υπάρχον PickupPhotos JSON array, δεν το αντικαθιστά.
 */
export async function uploadVehiclePickupPhoto(env, { chargeId, employeeId, bytes, fileName, contentType }) {
  if (!PICKUP_PHOTO_ALLOWED_TYPES[contentType]) {
    throw new Error("Επιτρέπεται μόνο εικόνα (JPG/PNG).");
  }
  if (!env.FLEET_FILES) {
    throw new Error("Η αποθήκευση φωτογραφιών παραλαβής δεν είναι ρυθμισμένη (λείπει το KV binding FLEET_FILES).");
  }
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) throw new Error("Η χρέωση δεν βρέθηκε.");
  if (charge.Type !== "Όχημα") throw new Error("Η καταγραφή παραλαβής ισχύει μόνο για οχήματα.");
  if (String(charge.EmployeeID) !== String(employeeId)) throw new Error("Αυτή η χρέωση δεν είναι δική σου.");
  if (charge.ReleasedAt) throw new Error("Η χρέωση έχει ήδη κλείσει.");

  const fileKey = `fleet:pickup:${crypto.randomUUID()}`;
  await env.FLEET_FILES.put(fileKey, bytes);

  let photos = [];
  try {
    photos = charge.PickupPhotos ? JSON.parse(charge.PickupPhotos) : [];
    if (!Array.isArray(photos)) photos = [];
  } catch {
    photos = [];
  }
  photos.push({ fileKey, fileName: fileName || "φωτογραφία.jpg", fileType: contentType });

  await updateCell(env, SHEET_CHARGES, charge._row, COL_PICKUP_PHOTOS, JSON.stringify(photos));
  return { success: true, photos };
}

/**
 * Λήψη μίας φωτογραφίας παραλαβής. Επιστρέφει και το EmployeeID της
 * χρέωσης ώστε ο caller (index.js) να ελέγξει δικαίωμα πρόσβασης (ο ίδιος
 * ο τεχνικός Ή TL/Director) — καμία per-request auth εδώ, mirror του
 * getEmployeeDocument/getLeaveAttachmentByFileKey.
 */
export async function getVehiclePickupPhoto(env, { chargeId, fileKey }) {
  if (!env.FLEET_FILES) return null;
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) return null;

  let photos = [];
  try {
    photos = charge.PickupPhotos ? JSON.parse(charge.PickupPhotos) : [];
  } catch {
    photos = [];
  }
  const photo = Array.isArray(photos) ? photos.find((p) => p.fileKey === fileKey) : null;
  if (!photo) return null;

  const bytes = await env.FLEET_FILES.get(fileKey, "arrayBuffer");
  if (!bytes) return null;
  return { bytes, fileName: photo.fileName || "φωτογραφία.jpg", contentType: photo.fileType || "image/jpeg", chargeEmployeeId: charge.EmployeeID };
}

// ============================================================
// ΦΩΤΟΓΡΑΦΙΑ ΚΟΝΤΕΡ (χιλιομετρητή) — item #1 «Προς Συζήτηση» (15/08/2026,
// ρητή απαίτηση χρήστη): ΞΕΧΩΡΙΣΤΟ υποχρεωτικό πεδίο από τις γενικές
// φωτογραφίες παραλαβής παραπάνω (PickupPhotos) — ΕΝΑ αρχείο ανά ενέργεια
// (όχι JSON array), ΚΑΙ στην Παραλαβή ΚΑΙ στην Επιστροφή (η Επιστροφή μέχρι
// τώρα δεν είχε καμία φωτογραφία, μόνο αριθμό χιλιομέτρων). Επιτρέπεται
// επανα-ανέβασμα/αντικατάσταση (π.χ. λάθος φωτογραφία). Το ΥΠΟΧΡΕΩΤΙΚΟ
// γίνεται σεβαστό στο UI (hub.html) — εδώ απλά αποθηκεύεται ό,τι σταλεί.
// ============================================================

export async function uploadOdometerPickupPhoto(env, { chargeId, employeeId, bytes, fileName, contentType }) {
  if (!PICKUP_PHOTO_ALLOWED_TYPES[contentType]) {
    throw new Error("Επιτρέπεται μόνο εικόνα (JPG/PNG).");
  }
  if (!env.FLEET_FILES) {
    throw new Error("Η αποθήκευση φωτογραφιών δεν είναι ρυθμισμένη (λείπει το KV binding FLEET_FILES).");
  }
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) throw new Error("Η χρέωση δεν βρέθηκε.");
  if (charge.Type !== "Όχημα") throw new Error("Η καταγραφή παραλαβής ισχύει μόνο για οχήματα.");
  if (String(charge.EmployeeID) !== String(employeeId)) throw new Error("Αυτή η χρέωση δεν είναι δική σου.");
  if (charge.ReleasedAt) throw new Error("Η χρέωση έχει ήδη κλείσει.");

  const fileKey = `fleet:odometer-pickup:${crypto.randomUUID()}`;
  await env.FLEET_FILES.put(fileKey, bytes);
  await updateCell(env, SHEET_CHARGES, charge._row, COL_ODO_PICKUP_KEY, fileKey);
  await updateCell(env, SHEET_CHARGES, charge._row, COL_ODO_PICKUP_NAME, fileName || "κοντέρ.jpg");
  await updateCell(env, SHEET_CHARGES, charge._row, COL_ODO_PICKUP_TYPE, contentType);
  return { success: true };
}

export async function uploadOdometerReturnPhoto(env, { chargeId, employeeId, bytes, fileName, contentType }) {
  if (!PICKUP_PHOTO_ALLOWED_TYPES[contentType]) {
    throw new Error("Επιτρέπεται μόνο εικόνα (JPG/PNG).");
  }
  if (!env.FLEET_FILES) {
    throw new Error("Η αποθήκευση φωτογραφιών δεν είναι ρυθμισμένη (λείπει το KV binding FLEET_FILES).");
  }
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) throw new Error("Η χρέωση δεν βρέθηκε.");
  if (charge.Type !== "Όχημα") throw new Error("Η καταγραφή επιστροφής ισχύει μόνο για οχήματα.");
  if (String(charge.EmployeeID) !== String(employeeId)) throw new Error("Αυτή η χρέωση δεν είναι δική σου.");
  if (!charge.PickupMileage) throw new Error("Καταχώρησε πρώτα τα χιλιόμετρα παραλαβής.");

  const fileKey = `fleet:odometer-return:${crypto.randomUUID()}`;
  await env.FLEET_FILES.put(fileKey, bytes);
  await updateCell(env, SHEET_CHARGES, charge._row, COL_ODO_RETURN_KEY, fileKey);
  await updateCell(env, SHEET_CHARGES, charge._row, COL_ODO_RETURN_NAME, fileName || "κοντέρ.jpg");
  await updateCell(env, SHEET_CHARGES, charge._row, COL_ODO_RETURN_TYPE, contentType);
  return { success: true };
}

/** Λήψη φωτογραφίας κοντέρ (παραλαβής ή επιστροφής) — ίδιο auth σκεπτικό/caller-authorizes με getVehiclePickupPhoto */
export async function getOdometerPhoto(env, { chargeId, which }) {
  if (!env.FLEET_FILES) return null;
  const all = await readSheetAsObjects(env, SHEET_CHARGES);
  const charge = all.find((c) => c.ID === chargeId);
  if (!charge) return null;

  const fileKey = which === "return" ? charge.OdometerReturnPhotoKey : charge.OdometerPickupPhotoKey;
  const fileName = which === "return" ? charge.OdometerReturnPhotoName : charge.OdometerPickupPhotoName;
  const contentType = which === "return" ? charge.OdometerReturnPhotoType : charge.OdometerPickupPhotoType;
  if (!fileKey) return null;

  const bytes = await env.FLEET_FILES.get(fileKey, "arrayBuffer");
  if (!bytes) return null;
  return { bytes, fileName: fileName || "κοντέρ.jpg", contentType: contentType || "image/jpeg", chargeEmployeeId: charge.EmployeeID };
}

// ============================================================
// ΗΜΕΡΟΛΟΓΙΟ ΤΕΧΝΙΚΟΥ — item #9 (15/08/2026, ρητή απαίτηση χρήστη μέσω
// διευκρινιστικών ερωτήσεων): μόνο στο δικό του tab (ΟΧΙ στο Προφίλ
// Τεχνικού του TL/Director), δείχνει άδειες/τηλεργασία (βλ. index.js,
// συνδυάζεται εκεί με getEmployeeBalance) + οχήματα (εδώ).
// ============================================================

/**
 * Γεγονότα ημερολογίου σχετικά με οχήματα για έναν τεχνικό: παραλαβή/
 * επιστροφή (PickupDate/ReturnDate, ακριβής ημερομηνία ενέργειας) και
 * ΚΤΕΟ/Service του οχήματος όσο ήταν ανατεθειμένο πάνω του.
 *
 * ΠΕΡΙΟΡΙΣΜΟΣ (ρητά τεκμηριωμένος, αποδεκτός): το φύλλο `Στόλος` κρατά
 * ΜΟΝΟ την ΤΡΕΧΟΥΣΑ επόμενη ημερομηνία ΚΤΕΟ/Service ανά όχημα, ΟΧΙ
 * ιστορικό αλλαγών — για ΚΛΕΙΣΤΕΣ (παλιές) αναθέσεις γίνεται best-effort
 * έλεγχος αν η τρέχουσα καταχωρημένη ημερομηνία πέφτει μέσα στο διάστημα
 * [ChargedAt, ReleasedAt] της ανάθεσης (μπορεί να μην αντιστοιχεί πια αν η
 * ημερομηνία άλλαξε έκτοτε). Για ΑΝΟΙΧΤΗ ανάθεση (το όχημα είναι ΤΩΡΑ πάνω
 * του) ΔΕΝ βάζουμε πάνω όριο — κάθε επερχόμενη ημερομηνία ΚΤΕΟ/Service του
 * οχήματος που έχει σήμερα είναι χρήσιμη πληροφορία μέχρι να το επιστρέψει.
 */
export async function getVehicleCalendarEvents(env, employeeId) {
  const all = await listAssignmentsForEmployee(env, employeeId);
  const vehicleCharges = all.filter((a) => a.Type === "Όχημα");
  if (!vehicleCharges.length) return [];

  const vehicles = await readSheetAsObjects(env, SHEET_FLEET);
  const vehicleMap = Object.fromEntries(vehicles.map((v) => [v.ID, v]));

  // Κανονικοποίηση ΠΡΙΝ τη σύγκριση/εμφάνιση — βλ. src/dateutil.js (bug
  // garbled ημερομηνιών, 24/08/2026): raw Sheet τιμές δεν είναι πάντα ήδη
  // σε ISO μορφή.
  const events = [];
  for (const c of vehicleCharges) {
    const vehicle = vehicleMap[c.ItemID];
    const plate = c.ItemLabel || (vehicle && vehicle.Plate) || "";

    const pickupDate = normalizeSheetDate(c.PickupDate);
    const returnDate = normalizeSheetDate(c.ReturnDate);
    if (pickupDate) {
      events.push({ date: pickupDate, type: "pickup", title: `Παραλαβή οχήματος ${plate}`.trim() });
    }
    if (returnDate) {
      events.push({ date: returnDate, type: "return", title: `Επιστροφή οχήματος ${plate}`.trim() });
    }

    if (!vehicle) continue;
    const rangeStart = normalizeSheetDate(c.ChargedAt) || (c.ChargedAt ? String(c.ChargedAt).slice(0, 10) : "");
    const rangeEndRaw = c.ReleasedAt ? (normalizeSheetDate(c.ReleasedAt) || String(c.ReleasedAt).slice(0, 10)) : null;
    const inRange = (d) => !!d && d >= rangeStart && (!rangeEndRaw || d <= rangeEndRaw);
    const kteoDate = normalizeSheetDate(vehicle.KteoDate);
    const serviceDate = normalizeSheetDate(vehicle.ServiceDate);
    if (inRange(kteoDate)) {
      events.push({ date: kteoDate, type: "kteo", title: `ΚΤΕΟ οχήματος ${plate}`.trim() });
    }
    if (inRange(serviceDate)) {
      events.push({ date: serviceDate, type: "service", title: `Service οχήματος ${plate}`.trim() });
    }
  }
  return events;
}
