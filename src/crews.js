/**
 * Σύνθεση Συνεργείων (drag & drop) — Backoffice φτιάχνει καθημερινά
 * "συνεργεία" (ομάδες τεχνικών) βάσει της ζωντανής δεξαμενής διαθεσιμότητας
 * (βλ. getTechniciansPool στο leaves.js). Κάθε ημέρα αποθηκεύεται σαν ΜΙΑ
 * γραμμή στο νέο φύλλο "Συνεργεία" — StartDate=ημέρα, CrewsJSON=πλήρης
 * σύνθεση (ονόματα συνεργείων + ποιοι τεχνικοί ανήκουν σε καθένα), ώστε να
 * υπάρχει ιστορικό ανά ημέρα (ρητή απαίτηση χρήστη). Δεν συνδέεται με το
 * σύστημα Χρεώσεων/Αδειών — καθαρά προγραμματισμός/οργάνωση της ημέρας.
 *
 * Έμπνευση λογικής (status pills, δεξαμενή, drag&drop) από εξωτερικό demo
 * app του χρήστη — βλ. CLAUDE.md. Εδώ αποθηκεύουμε σε Google Sheet
 * (συνεπές με την υπόλοιπη αρχιτεκτονική), όχι σε Cloudflare KV.
 */

import { readSheetAsObjects, appendRow, updateRow, appendAuditLog } from "./sheets.js";

const SHEET_CREWS = "Συνεργεία";
const CREWS_HEADER_ORDER = ["Date", "CrewsJSON", "SavedBy", "SavedAt"];

/** Λίστα όλων των ημερομηνιών που έχουν αποθηκευμένη σύνθεση (για ιστορικό/ημερολόγιο επιλογής) */
export async function listCrewDates(env) {
  const rows = await readSheetAsObjects(env, SHEET_CREWS);
  return rows.map((r) => r.Date).filter(Boolean).sort();
}

/**
 * Η σύνθεση συνεργείων μιας συγκεκριμένης ημέρας, ή null αν δεν έχει
 * αποθηκευτεί ποτέ. Το CrewsJSON περιέχει ΚΑΙ ένα "παγωμένο" στιγμιότυπο
 * της κατάστασης διαθεσιμότητας κάθε τεχνικού ΤΗ ΣΤΙΓΜΗ της αποθήκευσης
 * (technicians) — ρητή απαίτηση χρήστη, ώστε το ιστορικό να δείχνει πώς
 * ήταν πραγματικά η κατάσταση εκείνη την ημέρα, όχι τη σημερινή. Παλιά
 * αποθηκευμένα rows (πριν το snapshot) μπορεί να έχουν CrewsJSON σαν
 * απλό array — χειρίζεται και τις δύο μορφές.
 */
export async function getCrewsForDate(env, date) {
  const rows = await readSheetAsObjects(env, SHEET_CREWS);
  const row = rows.find((r) => r.Date === date);
  if (!row) return null;

  let crews = [];
  let technicians = [];
  try {
    const parsed = JSON.parse(row.CrewsJSON || "[]");
    if (Array.isArray(parsed)) {
      crews = parsed; // παλιά μορφή, χωρίς snapshot κατάστασης
    } else {
      crews = Array.isArray(parsed.crews) ? parsed.crews : [];
      technicians = Array.isArray(parsed.technicians) ? parsed.technicians : [];
    }
  } catch {
    crews = [];
  }
  return { date, crews, technicians, savedBy: row.SavedBy || "", savedAt: row.SavedAt || "" };
}

/**
 * Αποθηκεύει (upsert) τη σύνθεση συνεργείων μιας ημέρας, μαζί με στιγμιότυπο
 * της κατάστασης διαθεσιμότητας ΟΛΩΝ των τεχνικών εκείνη τη στιγμή
 * (technicians — βλ. getTechniciansPool). Αν υπάρχει ήδη γραμμή για την
 * ίδια ημερομηνία, αντικαθίσταται ολόκληρη (τελευταία αποθήκευση ισχύει —
 * χωρίς merge, ίδιο μοτίβο με το demo app).
 */
export async function saveCrewsForDate(env, { date, crews, technicians, savedBy }) {
  if (!date) throw new Error("Χρειάζεται ημερομηνία.");
  if (!Array.isArray(crews)) throw new Error("Μη έγκυρη σύνθεση συνεργείων.");

  const rows = await readSheetAsObjects(env, SHEET_CREWS);
  const existing = rows.find((r) => r.Date === date);
  const row = {
    Date: date,
    CrewsJSON: JSON.stringify({ crews, technicians: Array.isArray(technicians) ? technicians : [] }),
    SavedBy: savedBy || "",
    SavedAt: new Date().toISOString(),
  };

  if (existing) {
    const values = CREWS_HEADER_ORDER.map((h) => (row[h] !== undefined ? row[h] : ""));
    await updateRow(env, SHEET_CREWS, existing._row, values);
  } else {
    await appendRow(env, SHEET_CREWS, row, CREWS_HEADER_ORDER);
  }

  await appendAuditLog(env, "crews_saved", savedBy, { date, crewCount: crews.length });
  return { success: true, date };
}

/**
 * KPI: μέσος όρος τεχνικών ανά ημέρα σε συνεργεία, τελευταίες (έως) `days`
 * αποθηκευμένες ημέρες — για το tab «Αναλυτικά» (πρόταση Claude, αποδεκτή
 * από χρήστη, 15/08/2026· εταιρικό KPI, ορατό ΚΑΙ σε TL ΚΑΙ σε Director,
 * βλ. src/analytics.js). ΜΙΑ ανάγνωση του φύλλου (όχι N κλήσεις
 * getCrewsForDate) — ίδιος parser (παλιά μορφή array ΚΑΙ νέα μορφή
 * {crews, technicians}) με getCrewsForDate παραπάνω.
 */
export async function getCrewsKpiSummary(env, { days = 30 } = {}) {
  const rows = await readSheetAsObjects(env, SHEET_CREWS);
  const sorted = rows.filter((r) => r.Date).sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
  const recent = sorted.slice(-days);
  if (!recent.length) return { days: 0, average: 0 };

  let totalAssigned = 0;
  for (const row of recent) {
    let crews = [];
    try {
      const parsed = JSON.parse(row.CrewsJSON || "[]");
      crews = Array.isArray(parsed) ? parsed : Array.isArray(parsed.crews) ? parsed.crews : [];
    } catch {
      crews = [];
    }
    totalAssigned += crews.reduce((sum, c) => sum + (c.memberIds ? c.memberIds.length : 0), 0);
  }
  const average = Math.round((totalAssigned / recent.length) * 10) / 10;
  return { days: recent.length, average };
}
