/**
 * Καθημερινό backup όλων των φύλλων του Google Sheet — στιγμιότυπο JSON σε
 * Cloudflare KV (namespace SHEET_BACKUPS), ρητή απαίτηση χρήστη (15/08/2026).
 *
 * Γιατί JSON->KV και όχι πραγματικό αντίγραφο Google Sheet (Drive API copy):
 * η υπάρχουσα WIF αυθεντικοποίηση (βλ. sheets.js) έχει OAuth scope ΜΟΝΟ
 * Sheets API, όχι Drive — ένα πραγματικό αντίγραφο θα απαιτούσε νέο scope/
 * δικαίωμα στο Google Cloud, ρύθμιση εκτός του Worker. Το JSON->KV δεν
 * χρειάζεται ΚΑΝΕΝΑ νέο δικαίωμα, καμία αλλαγή στο υπάρχον setup.
 *
 * Scope περιεχομένου (ρητά τεκμηριωμένο όριο): μόνο τα δεδομένα των φύλλων
 * (raw 2D arrays, βλ. getSheetRawValues στο sheets.js). ΔΕΝ περιλαμβάνει τα
 * ίδια τα ανεβασμένα αρχεία (φωτογραφίες, δικαιολογητικά, υπογραφές κλπ.)
 * που ζουν σε ξεχωριστά KV namespaces (LEAVE_FILES/EMPLOYEE_FILES/
 * FLEET_FILES/ANNOUNCEMENTS_FILES/HANDOVER_FILES) — τα φύλλα κρατούν μόνο
 * FileKey αναφορές σε αυτά, όχι τα ίδια τα bytes. Αν χρειαστεί ποτέ πλήρες
 * backup και των αρχείων, είναι ξεχωριστό/μεγαλύτερο feature.
 *
 * ΣΚΟΠΙΜΑ καμία αυτόματη "restore σε ζωντανό Sheet" λειτουργία — ρίσκο να
 * αντικατασταθούν εν αγνοία πρόσφατα δεδομένα. Restore = λήψη (download) του
 * JSON + χειροκίνητη επανεισαγωγή αν χρειαστεί ποτέ πραγματικά. Αν ζητηθεί
 * αυτόματο restore στο μέλλον, να σχεδιαστεί ρητά ως δικό του feature.
 *
 * Διατήρηση: τελευταία 14 backups (ρητή απόφαση χρήστη) — παλιότερα
 * διαγράφονται αυτόματα μετά από κάθε νέο backup.
 *
 * Σημείωση: το "Ρυθμίσεις" που αναφέρεται στο CLAUDE.md "Φύλλα στο Sheet"
 * ΔΕΝ βρέθηκε πουθενά σε χρήση στον κώδικα (κανένα const SHEET_/reference) —
 * αφαιρέθηκε από τη λίστα backup, πιθανό stale/ανενεργό leftover. Αν
 * αποδειχτεί ότι υπάρχει πραγματικά και χρησιμοποιείται αλλού, να προστεθεί.
 */

import { getSheetRawValues } from "./sheets.js";

const BACKUP_SHEETS = [
  "Άδειες",
  "Υπάλληλοι",
  "TeamLeaders",
  "Backoffice",
  "Directors",
  "Στόλος",
  "ΑτυχήματαΟχημάτων",
  "Εξοπλισμός",
  "EPass",
  "Χρεώσεις",
  "Συνεργεία",
  "Ενημερώσεις",
  "ΕρωτηματαΔιαθεσιμότητας",
  "ΑπαντησειςΔιαθεσιμότητας",
  "ΕγγραφαΠαράδοσης",
  "AuditLog",
];

const BACKUP_RETENTION = 14;

function backupKey(dateStr) {
  return `backup:${dateStr}`;
}

/**
 * Δημιουργεί νέο backup — καλείται είτε από το cron (scheduled(), καθημερινά)
 * είτε από το χειροκίνητο κουμπί "Δημιουργία backup τώρα" (Director, hub.html).
 * Κάθε φύλλο διαβάζεται ξεχωριστά με try/catch — αν ένα φύλλο λείπει/αποτύχει,
 * δεν μπλοκάρει το backup των υπολοίπων, απλά καταγράφεται στο errors[].
 */
export async function createSheetBackup(env, { triggeredBy } = {}) {
  if (!env.SHEET_BACKUPS) {
    throw new Error("Η αποθήκευση backup δεν είναι ρυθμισμένη (λείπει το KV binding SHEET_BACKUPS).");
  }

  const sheets = {};
  const errors = [];
  for (const name of BACKUP_SHEETS) {
    try {
      sheets[name] = await getSheetRawValues(env, name);
    } catch (err) {
      errors.push({ sheet: name, error: err.message || String(err) });
    }
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const createdAt = new Date().toISOString();
  const payload = { createdAt, triggeredBy: triggeredBy || "cron", sheets, errors };
  const json = JSON.stringify(payload);

  await env.SHEET_BACKUPS.put(backupKey(dateStr), json, {
    metadata: {
      createdAt,
      triggeredBy: triggeredBy || "cron",
      sheetCount: Object.keys(sheets).length,
      errorCount: errors.length,
      sizeBytes: json.length,
    },
  });

  await pruneOldBackups(env);

  return { success: true, date: dateStr, sheetCount: Object.keys(sheets).length, errors, sizeBytes: json.length };
}

/** Διαγράφει backups πέρα από τα τελευταία BACKUP_RETENTION (πιο πρόσφατα πρώτα) */
async function pruneOldBackups(env) {
  const list = await listSheetBackups(env);
  const toDelete = list.slice(BACKUP_RETENTION);
  for (const b of toDelete) {
    await env.SHEET_BACKUPS.delete(backupKey(b.date));
  }
}

/** Λίστα διαθέσιμων backups (πιο πρόσφατα πρώτα) — μόνο μεταδεδομένα, όχι το πλήρες περιεχόμενο */
export async function listSheetBackups(env) {
  if (!env.SHEET_BACKUPS) return [];
  const list = await env.SHEET_BACKUPS.list({ prefix: "backup:" });
  return list.keys
    .map((k) => ({ date: k.name.replace("backup:", ""), ...(k.metadata || {}) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Πλήρες περιεχόμενο ενός backup (raw JSON string) — για λήψη/download */
export async function getSheetBackupRaw(env, date) {
  if (!env.SHEET_BACKUPS) return null;
  return env.SHEET_BACKUPS.get(backupKey(date));
}
