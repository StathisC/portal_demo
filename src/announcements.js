/**
 * Ενημερώσεις/Οδηγίες — απλή χρονολογική λίστα ανακοινώσεων προς το
 * προσωπικό (τεχνικοί + TL + Backoffice), με προαιρετικό συνημμένο αρχείο
 * (μόνο PDF/Word). Καταχωρούν μόνο TL/Backoffice (ρητή απαίτηση χρήστη),
 * βλέπουν όλοι. Καμία παρακολούθηση "το είδα/το διάβασα" (ρητή απόφαση).
 *
 * Το ίδιο το αρχείο ΔΕΝ αποθηκεύεται στο Google Sheet (μόνο μεταδεδομένα) —
 * αποθηκεύεται στο Cloudflare KV `ANNOUNCEMENTS_FILES` σαν raw bytes. Θα
 * προτιμούσαμε R2 (πιο κατάλληλο για αρχεία), αλλά το R2 δεν είναι
 * ενεργοποιημένο στο Cloudflare account (χρειάζεται χειροκίνητο βήμα από το
 * Dashboard) — βλ. CLAUDE.md. Η τιμή KV έχει όριο 25MiB, αρκετό για τυπικά
 * PDF/Word οδηγιών.
 *
 * **Στοχευμένες ενημερώσεις — ΕΓΙΝΕ (20/08/2026, ρητή απαίτηση χρήστη,
 * αποφασίστηκε μέσω διευκρινιστικών ερωτήσεων πριν την υλοποίηση):** νέο
 * προαιρετικό πεδίο `TargetTeams` — ίδια λογική/JSON σχήμα με το
 * `TargetTeams` του `src/availability.js` («Ανακοινώσεις»): array από
 * ονόματα ΕΙΔΙΚΟΤΗΤΩΝ (πεδίο `Team` του Υπάλληλοι), ή sentinel `["ALL"]` για
 * «όλοι» (προεπιλογή — ίδια συμπεριφορά με πριν όταν δεν επιλέγεται τίποτα
 * ή μένουν κενές γραμμές παλιότερων ενημερώσεων πριν το feature). Η
 * στόχευση αφορά ΜΟΝΟ τεχνικούς — το TL/Backoffice/Director δεν έχουν
 * ειδικότητα με αυτή την έννοια, άρα βλέπουν ΠΑΝΤΑ τα πάντα (ίδιο μοτίβο
 * ασυμμετρίας δημιουργού/θεατή με το «Ανακοινώσεις»). Email ειδοποίησης
 * ΜΟΝΟ όταν η στόχευση ΔΕΝ είναι "ALL" (ρητή απόφαση χρήστη — οι
 * ήδη υπάρχουσες εκπομπές προς όλους ΔΕΝ αποκτούν νέα συμπεριφορά email,
 * μόνο η νέα στοχευμένη περίπτωση) — ίδιο μοτίβο Reply-To=actor με το
 * «Ανακοινώσεις».
 */

import { readSheetAsObjects, appendRow, deleteRow, appendAuditLog } from "./sheets.js";
import { sendEmail, emailTemplate, resolveActorName, PORTAL_URL, logEmailFailure } from "./email.js";

const SHEET_ANNOUNCEMENTS = "Ενημερώσεις";
const SHEET_EMPLOYEES = "Υπάλληλοι";
const ANNOUNCEMENTS_HEADER_ORDER = [
  "ID", "Title", "Body", "FileKey", "FileName", "FileType", "PostedBy", "PostedByName", "PostedAt", "TargetTeams",
];

/** Μόνο PDF/Word επιτρέπονται ως συνημμένο — ρητή απαίτηση χρήστη */
export const ALLOWED_FILE_TYPES = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Κενό/άκυρο TargetTeams -> ["ALL"] (ασφαλής προεπιλογή: παλιές γραμμές πριν το feature έμεναν ορατές σε όλους, δεν πρέπει να "κρυφτούν" ξαφνικά) */
function parseTargetTeams(raw) {
  if (!raw) return ["ALL"];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : ["ALL"];
  } catch {
    return ["ALL"];
  }
}

function teamsMatch(targetTeams, team) {
  return targetTeams.includes("ALL") || targetTeams.includes(team);
}

/** Ίδιος ορισμός "πεδίου τεχνικού" (όχι staff self-row) με το src/availability.js — δεν είναι exported εκεί, ξαναγράφεται τοπικά (ίδιο μοτίβο με κάθε module του portal) */
function isFieldTechnicianRow(emp) {
  const team = String(emp.Team || "").trim().toLowerCase();
  const isStaffSelfRow = team === "back office" || team === "backoffice" || team === "team leader";
  const isActive = (emp.Status || "Ενεργός") !== "Ανενεργός";
  return !isStaffSelfRow && isActive;
}

/**
 * Όλες οι ενημερώσεις, χωρίς φιλτράρισμα — για TL/Backoffice/Director (δεν
 * έχουν ειδικότητα, βλέπουν πάντα τα πάντα, ίδιο σκεπτικό με το
 * «Ανακοινώσεις»).
 */
export async function listAnnouncements(env) {
  const rows = await readSheetAsObjects(env, SHEET_ANNOUNCEMENTS);
  return rows
    .map((r) => ({
      ID: r.ID,
      Title: r.Title,
      Body: r.Body || "",
      HasFile: !!r.FileKey,
      FileName: r.FileName || "",
      FileType: r.FileType || "",
      PostedByName: r.PostedByName || r.PostedBy || "",
      PostedAt: r.PostedAt,
      TargetTeams: parseTargetTeams(r.TargetTeams),
    }))
    .sort((a, b) => new Date(b.PostedAt) - new Date(a.PostedAt));
}

/**
 * Ενημερώσεις που αφορούν συγκεκριμένο τεχνικό (βάσει ειδικότητας) — για
 * το tab «Ενημερώσεις/Οδηγίες» του τεχνικού. Οι στοχευμένες σε άλλη
 * ειδικότητα αποκλείονται εντελώς.
 */
export async function listAnnouncementsForTechnician(env, employeeId) {
  const [all, employees] = await Promise.all([listAnnouncements(env), readSheetAsObjects(env, SHEET_EMPLOYEES)]);
  const me = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  const myTeam = me ? me.Team || "" : "";
  return all.filter((a) => teamsMatch(a.TargetTeams, myTeam));
}

/** Ανεβάζει το συνημμένο στο KV — καλείται ΠΡΙΝ το createAnnouncement, επιστρέφει fileKey */
export async function uploadAnnouncementFile(env, { bytes, fileName, contentType }) {
  if (!ALLOWED_FILE_TYPES[contentType]) {
    throw new Error("Επιτρέπονται μόνο PDF και Word αρχεία (.pdf, .doc, .docx).");
  }
  if (!env.ANNOUNCEMENTS_FILES) {
    throw new Error("Η αποθήκευση αρχείων δεν είναι ρυθμισμένη (λείπει το KV binding ANNOUNCEMENTS_FILES).");
  }
  const fileKey = `ann:${crypto.randomUUID()}`;
  await env.ANNOUNCEMENTS_FILES.put(fileKey, bytes);
  return { fileKey, fileName: fileName || "αρχείο", contentType };
}

/** Στέλνει πίσω τα bytes ενός συνημμένου, εντοπίζοντάς το από το ID της ενημέρωσης (όχι το raw KV key) */
export async function getAnnouncementFileById(env, id) {
  const rows = await readSheetAsObjects(env, SHEET_ANNOUNCEMENTS);
  const existing = rows.find((r) => r.ID === id);
  if (!existing || !existing.FileKey) return null;
  const bytes = await env.ANNOUNCEMENTS_FILES.get(existing.FileKey, "arrayBuffer");
  if (!bytes) return null;
  return { bytes, fileName: existing.FileName || "αρχείο", contentType: existing.FileType || "application/octet-stream" };
}

/** Ενεργοί πεδίου τεχνικοί που ταιριάζουν στις στοχευμένες ειδικότητες */
async function getTargetTechnicians(env, targetTeams) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees.filter((e) => isFieldTechnicianRow(e) && teamsMatch(targetTeams, e.Team || ""));
}

/**
 * Email ειδοποίησης στους στοχευμένους τεχνικούς — ΜΟΝΟ όταν η στόχευση
 * δεν είναι "ALL" (ρητή απόφαση χρήστη, βλ. σχόλιο στην κορυφή του
 * αρχείου). Fan-out ανά παραλήπτη, ίδιο μοτίβο με notifyTargets() στο
 * src/availability.js.
 */
async function notifyAnnouncementTargets(env, row, teams) {
  const targets = await getTargetTechnicians(env, teams);
  const recipients = targets.filter((t) => t.Email);
  if (!recipients.length) return;

  const actorName = row.PostedByName || (await resolveActorName(env, row.PostedBy));
  const results = await Promise.all(
    recipients.map((t) =>
      sendEmail(env, {
        to: [t.Email],
        subject: `Νέα ενημέρωση: ${row.Title}`,
        html: emailTemplate({
          badge: "Ενημέρωση",
          badgeColor: "blue",
          title: "Νέα ενημέρωση/οδηγία",
          intro: `Ο/Η <strong>${actorName}</strong> δημοσίευσε μια νέα ενημέρωση που σε αφορά.`,
          rows: [["Τίτλος", row.Title]],
          ctaText: "Προβολή στο Portal",
          ctaUrl: `${PORTAL_URL}/hub`,
          footer: "Δες την πλήρη ενημέρωση από το tab «Ενημερώσεις/Οδηγίες» του OptikiTec Portal.",
        }),
        replyTo: row.PostedBy,
        replyToName: actorName,
      }).then((result) => ({ result, to: t.Email }))
    )
  );
  for (const { result, to } of results) {
    await logEmailFailure(env, "announcement_email_failed", row.PostedBy, result, { id: row.ID, to });
  }
}

/**
 * `targetTeams` προαιρετικό — κενό/χωρίς τιμή = ["ALL"] (ίδια συμπεριφορά
 * με πριν, ορατό σε όλους, ΚΑΜΙΑ αλλαγή στο email — δεν στέλνεται τίποτα).
 * Συγκεκριμένες ειδικότητες = μόνο αυτές βλέπουν την ενημέρωση + στέλνεται
 * email ειδοποίησης στους στοχευμένους τεχνικούς.
 */
export async function createAnnouncement(env, { title, body, fileKey, fileName, fileType, postedBy, postedByName, targetTeams }) {
  if (!title || !String(title).trim()) throw new Error("Χρειάζεται τίτλος.");
  const teams = Array.isArray(targetTeams) ? targetTeams.filter(Boolean) : [];
  const effectiveTeams = teams.length ? teams : ["ALL"];

  const row = {
    ID: crypto.randomUUID(),
    Title: String(title).trim(),
    Body: body || "",
    FileKey: fileKey || "",
    FileName: fileName || "",
    FileType: fileType || "",
    PostedBy: postedBy || "",
    PostedByName: postedByName || postedBy || "",
    PostedAt: new Date().toISOString(),
    TargetTeams: JSON.stringify(effectiveTeams),
  };
  await appendRow(env, SHEET_ANNOUNCEMENTS, row, ANNOUNCEMENTS_HEADER_ORDER);
  await appendAuditLog(env, "announcement_created", postedBy, { id: row.ID, title: row.Title, teams: effectiveTeams });

  if (!effectiveTeams.includes("ALL")) {
    await notifyAnnouncementTargets(env, row, effectiveTeams);
  }

  return { success: true, announcement: { ...row, TargetTeams: effectiveTeams } };
}

export async function deleteAnnouncement(env, id, actor) {
  const rows = await readSheetAsObjects(env, SHEET_ANNOUNCEMENTS);
  const existing = rows.find((r) => r.ID === id);
  if (!existing) throw new Error("Η ενημέρωση δεν βρέθηκε.");
  if (existing.FileKey && env.ANNOUNCEMENTS_FILES) {
    await env.ANNOUNCEMENTS_FILES.delete(existing.FileKey).catch(() => {});
  }
  await deleteRow(env, SHEET_ANNOUNCEMENTS, existing._row);
  await appendAuditLog(env, "announcement_deleted", actor, { id, title: existing.Title });
  return { success: true };
}
