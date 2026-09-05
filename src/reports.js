/**
 * Αυτόματες περιοδικές αναφορές (εβδομαδιαίες/μηνιαίες/ημερήσιες) μέσω
 * email σε κάθε Team Leader — σύνοψη της ομάδας του (άδειες) +
 * προειδοποιήσεις στόλου (ΚΤΕΟ/service που λήγουν) + (νέο) ημερήσια
 * σύνοψη χρεώσεων στις 19:00 (βλ. sendDailyChargesDigest παρακάτω) + (νέο)
 * μηνιαία αναφορά αδειών προς τον/τους Director(s), ένα ενιαίο email με
 * όλους τους τεχνικούς μαζί, ώστε ο Director να το προωθήσει ο ίδιος στον
 * λογιστή (βλ. sendAccountantMonthlyReport παρακάτω) — ο Worker δεν στέλνει
 * τίποτα απευθείας σε λογιστή, ρητή απόφαση χρήστη + (νέο) εβδομαδιαία
 * αποκλειστική ειδοποίηση ΚΤΕΟ/service στον Director (βλ.
 * sendFleetComplianceAlert παρακάτω) — συμπληρωματική, όχι αντικατάσταση,
 * του υπάρχοντος section μέσα στο report κάθε TL.
 * Καλείται από το scheduled() στο src/index.js (Cron Triggers, βλ.
 * wrangler.toml) — αντικαθιστά τις παλιές αναφορές του Apps Script που δεν
 * είχαν ξαναφτιαχτεί μετά τη μετάβαση.
 *
 * ΣΗΜΑΝΤΙΚΟ: μπλοκάρει στο ίδιο πρόβλημα με τις ειδοποιήσεις χρεώσεων —
 * λείπουν EMAIL_RELAY_URL/EMAIL_RELAY_SECRET (Apps Script mail relay, βλ.
 * src/email.js + apps-script/EmailRelay.gs). Το sendEmail() κάνει no-op αν
 * λείπουν τα secrets, άρα το cron τρέχει κανονικά αλλά δεν στέλνει τίποτα
 * μέχρι να μπουν. Ασφαλές να μείνει ενεργό ενώ περιμένουμε.
 *
 * Σχεδιαστική επιλογή (χωρίς ρητή απαίτηση χρήστη για το ποιος τα παίρνει):
 * κάθε TL λαμβάνει τη δική του αναφορά, για τη δική του ομάδα — ίδιο μοτίβο
 * με τα υπόλοιπα notifications του portal. Αν χρειάζεται και μια συγκεντρωτική
 * αναφορά (π.χ. σε συγκεκριμένο owner email), πρέπει να οριστεί ρητά.
 */

import { readSheetAsObjects } from "./sheets.js";
import { sendEmail, emailTemplate, PORTAL_URL, logEmailFailure } from "./email.js";
import { getTeamLeaderData, getApprovedLeavesInRange, getLeaveAttachmentByFileKey } from "./leaves.js";
import { listVehicles } from "./fleet.js";
import { listTodaysChargesForEmployees } from "./assignments.js";
import { normalizeSheetDate, formatSheetDateEl } from "./dateutil.js";

const SHEET_TEAMLEADERS = "TeamLeaders";
const SHEET_DIRECTORS = "Directors";

// Πάντα περνάει πρώτα από normalizeSheetDate() — βλ. src/dateutil.js (bug
// garbled ημερομηνιών σε emails αναφορών, 24/08/2026: raw Sheet τιμές χωρίς
// μορφοποίηση ημερομηνίας επιστρέφονταν bare serial αριθμό, π.χ. "46267",
// που το παλιό `new Date(iso)` παρερμήνευε ως έτος 46267). Ασφαλές να
// εφαρμοστεί και σε ήδη-υπολογισμένες ISO τιμές (idempotent).
function fmtDateEl(iso) {
  return formatSheetDateEl(iso);
}

/** Οχήματα με ΚΤΕΟ/service που έχει λήξει ή λήγει εντός 30 ημερών (ίδιο κατώφλι με το UI badge) */
function fleetAlertLines(vehicles) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lines = [];
  for (const v of vehicles) {
    for (const [label, rawDateStr] of [["ΚΤΕΟ", v.KteoDate], ["Service", v.ServiceDate]]) {
      if (!rawDateStr) continue;
      // Κανονικοποίηση ΠΡΙΝ τη σύγκριση — βλ. src/dateutil.js (bug garbled
      // ημερομηνιών, 24/08/2026).
      const dateStr = normalizeSheetDate(rawDateStr);
      if (!dateStr) continue;
      const d = new Date(dateStr + "T00:00:00");
      if (isNaN(d)) continue;
      const diffDays = Math.round((d - today) / 86400000);
      if (diffDays <= 30) {
        const status = diffDays < 0 ? `έληξε πριν ${Math.abs(diffDays)} ημέρες` : `σε ${diffDays} ημέρες`;
        lines.push(`${v.Plate} — ${label} ${status} (${fmtDateEl(dateStr)})`);
      }
    }
  }
  return lines;
}

/** Εγκεκριμένες άδειες που τέμνουν το [rangeStart, rangeEnd] (YYYY-MM-DD strings) */
function leavesInRange(calendarLeaves, rangeStart, rangeEnd) {
  return (calendarLeaves || []).filter(
    (l) => l.Status === "Εγκρίθηκε" && l.StartDate <= rangeEnd && l.EndDate >= rangeStart
  );
}

async function sendTeamReport(env, leader, { periodLabel, rangeStart, rangeEnd, rangeLabel }) {
  const data = await getTeamLeaderData(env, leader.Email);
  const vehicles = await listVehicles(env);

  const inRange = leavesInRange(data.calendarLeaves, rangeStart, rangeEnd);
  const leavesHtml = inRange.length
    ? inRange.map((l) => `${l.EmployeeName} (${fmtDateEl(l.StartDate)}–${fmtDateEl(l.EndDate)}, ${l.Type})`).join("<br>")
    : "Καμία";

  const alerts = fleetAlertLines(vehicles);
  const alertsHtml = alerts.length ? alerts.join("<br>") : "Καμία";

  const result = await sendEmail(env, {
    to: [leader.Email],
    subject: `OptikiTec Portal — ${periodLabel} αναφορά ομάδας (${rangeLabel})`,
    html: emailTemplate({
      badge: `${periodLabel} αναφορά`,
      badgeColor: "blue",
      title: `${periodLabel} αναφορά ομάδας`,
      intro: `Σύνοψη για την ομάδα σου, περίοδος ${rangeLabel}.`,
      rows: [
        ["Τεχνικοί στην ομάδα", data.team.length],
        ["Εκκρεμείς αιτήσεις άδειας", data.pendingCount],
        [`Άδειες εντός περιόδου`, leavesHtml],
        ["Οχήματα με ΚΤΕΟ/service που λήγει", alertsHtml],
      ],
      ctaText: "Άνοιγμα Portal",
      ctaUrl: `${PORTAL_URL}/hub`,
      footer: "Αναλυτικά στο tab «Άδειες Ομάδας» και «Στόλος Οχημάτων».",
    }),
  });
  await logEmailFailure(env, "team_report_email_failed", "cron", result, { periodLabel, to: leader.Email });
  return result;
}

async function allLeaders(env) {
  return readSheetAsObjects(env, SHEET_TEAMLEADERS);
}

async function allDirectors(env) {
  return readSheetAsObjects(env, SHEET_DIRECTORS);
}

/** Χρώμα badge τύπου άδειας στη λίστα του accountant report — καθαρά οπτική
 * διάκριση (ίδιο συνδυασμό αποχρώσεων με το BADGE_COLORS του email.js +
 * γκρι για ό,τι δεν ταιριάζει σε αυτά), καμία επίδραση στη λογική. */
function leaveTypeColor(type) {
  if (type === "Αναρρωτική") return { bg: "#FBEAEA", text: "#A32D2D" };
  if (type === "Τηλεργασία") return { bg: "#E6F1FB", text: "#0C447C" };
  if (type === "Άδεια χωρίς αποδοχές") return { bg: "#F1EFE8", text: "#5F5E5A" };
  return { bg: "#E3F5EC", text: "#0F6E56" }; // Κανονική άδεια + λοιποί τύποι
}

/** Λίστα αδειών σε ευανάγνωστη μορφή (όνομα/περίοδος/ημέρες αριστερά, badge
 * τύπου δεξιά) — αντί για το ενιαίο συμπιεσμένο value ενός `rows` row (βλ.
 * emailTemplate `listHtml`), δύσκολο να διαβαστεί με πολλές εγγραφές μαζί. */
function leaveListHtml(leaves) {
  if (!leaves.length) {
    return `<p style="font-size:13px;color:#5F6674;margin:0 0 20px;">Καμία άδεια αυτή την περίοδο.</p>`;
  }
  const rowsHtml = leaves
    .map((l, i, arr) => {
      const border = i === arr.length - 1 ? "" : "border-bottom:1px solid #E7EAF0;";
      const c = leaveTypeColor(l.Type);
      return `<tr>
        <td style="padding:10px 0;${border}">
          <div style="font-size:13px;font-weight:700;color:#1B2333;">${l.EmployeeName}</div>
          <div style="font-size:12px;color:#5F6674;margin-top:2px;">${fmtDateEl(l.StartDate)} – ${fmtDateEl(l.EndDate)} · ${l.Days} ημέρες</div>
        </td>
        <td style="padding:10px 0;${border}text-align:right;vertical-align:top;white-space:nowrap;">
          <span style="display:inline-block;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;padding:3px 9px;border-radius:100px;">${l.Type}</span>
        </td>
      </tr>`;
    })
    .join("");
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px;">${rowsHtml}</table>`;
}

/**
 * Συλλέγει τα PDF δικαιολογητικά αναρρωτικής άδειας (μόνο Type ===
 * "Αναρρωτική" ΚΑΙ ανεβασμένο FileKey) ως attachments για το sendEmail()
 * (βλ. src/email.js) — ρητή απαίτηση χρήστη. Αγνοεί σιωπηλά ό,τι λείπει
 * (καμία αναρρωτική στην περίοδο, ή αναρρωτική χωρίς ανεβασμένο
 * δικαιολογητικό, ή λείπει το KV binding LEAVE_FILES) — το email φεύγει
 * κανονικά, απλά χωρίς εκείνο το συνημμένο.
 */
async function sickLeaveAttachments(env, leaves) {
  const attachments = [];
  for (const l of leaves) {
    if (l.Type !== "Αναρρωτική" || !l.FileKey) continue;
    const bytes = await getLeaveAttachmentByFileKey(env, l.FileKey);
    if (!bytes) continue;
    attachments.push({
      filename: `${l.EmployeeName} — ${l.FileName || "δικαιολογητικό.pdf"}`,
      mimeType: l.FileType || "application/pdf",
      bytes,
    });
  }
  return attachments;
}

/**
 * Μηνιαία αναφορά αδειών προς τον/τους Director(s) — για να την προωθήσει ο
 * ίδιος ο Director στον λογιστή (ρητή απόφαση χρήστη: ο Worker δεν στέλνει
 * τίποτα απευθείας σε λογιστή, δεν χρειάζεται δικό του email/config).
 * ΕΝΑ ενιαίο email με ΟΛΟΥΣ τους τεχνικούς μαζί (όλες οι ομάδες), σε αντίθεση
 * με το sendTeamReport που είναι ανά Team Leader. Μόνο η λίστα εγκεκριμένων
 * αδειών (χωρίς πλήθος τεχνικών/εκκρεμείς αιτήσεις/ΚΤΕΟ-service — άσχετα με
 * τον σκοπό καταχώρησης στη μισθοδοσία). Κάθε άδεια φαίνεται με την ΠΛΗΡΗ
 * περίοδό της, ακόμα κι αν ξεκινά/τελειώνει εκτός του μήνα αναφοράς (βλ.
 * getApprovedLeavesInRange). Τρέχει ΕΠΙΠΛΕΟΝ του sendTeamReport ανά TL μέσα
 * στο sendMonthlyReports — δεν το αντικαθιστά.
 * Παραλήπτες: όλες οι γραμμές του φύλλου `Directors` (ίδιο sheet με τον
 * ρόλο Director, καμία νέα ρύθμιση) — αν είναι κενό, σιωπηλό no-op.
 * Επισυνάπτει αυτόματα τα PDF δικαιολογητικά αναρρωτικής άδειας που
 * εμφανίζονται στη λίστα (βλ. sickLeaveAttachments παραπάνω) — ρητή
 * απαίτηση χρήστη.
 */
async function sendAccountantMonthlyReport(env, { rangeStart, rangeEnd, rangeLabel }) {
  const directors = (await allDirectors(env)).filter((d) => d.Email);
  if (!directors.length) return { skipped: "no directors configured" };

  const leaves = await getApprovedLeavesInRange(env, rangeStart, rangeEnd);
  const attachments = await sickLeaveAttachments(env, leaves);

  const result = await sendEmail(env, {
    to: directors.map((d) => d.Email),
    subject: `OptikiTec Portal — Άδειες τεχνικών προς καταχώρηση (${rangeLabel})`,
    html: emailTemplate({
      badge: "Μηνιαία αναφορά",
      badgeColor: "blue",
      title: "Άδειες τεχνικών προς καταχώρηση",
      intro: `Εγκεκριμένες άδειες όλων των τεχνικών με περίοδο εντός ή τεμνόμενη με ${rangeLabel} (κάθε άδεια εμφανίζεται ολόκληρη, ακόμα κι αν ξεπερνά τα όρια του μήνα). Προώθησέ το στον λογιστή για καταχώρηση.`,
      listHtml: leaveListHtml(leaves),
    }),
    attachments,
  });
  await logEmailFailure(env, "accountant_report_email_failed", "cron", result, { to: directors.map((d) => d.Email) });
  return result;
}

/**
 * Εβδομαδιαία ειδοποίηση ΚΤΕΟ/service προς τον/τους Director(s) — πρόταση
 * μου, ρητά αποδεκτή από τον χρήστη. Η ΙΔΙΑ λίστα (fleetAlertLines) ήδη
 * εμφανίζεται μέσα στο εβδομαδιαίο/μηνιαίο report ΚΑΘΕ TL (μέσα στο
 * sendTeamReport, ανεξάρτητα ποιος έχει ανάθεση) — άρα οι ειδοποιήσεις ΔΕΝ
 * "χάνονται" σήμερα, απλά είναι διάχυτες ανάμεσα σε άδειες/λοιπά στοιχεία,
 * χωρίς σαφή υπεύθυνο. Αυτό είναι ΞΕΧΩΡΙΣΤΟ, αποκλειστικό email, θέμα
 * compliance/νομικό (ΚΤΕΟ), προς τον Director που έχει πλήρη εποπτεία —
 * ΔΕΝ αντικαθιστά το per-TL section. Καμία ειδοποίηση αν δεν υπάρχει
 * κανένα όχημα με ΚΤΕΟ/service που λήγει (κανένα κενό email) ή αν δεν
 * υπάρχει κανένας Director καταχωρημένος.
 */
async function sendFleetComplianceAlert(env) {
  const directors = (await allDirectors(env)).filter((d) => d.Email);
  if (!directors.length) return { skipped: "no directors configured" };

  const vehicles = await listVehicles(env);
  const alerts = fleetAlertLines(vehicles);
  if (!alerts.length) return { skipped: "no alerts" };

  const result = await sendEmail(env, {
    to: directors.map((d) => d.Email),
    subject: `OptikiTec Portal — ΚΤΕΟ/Service οχημάτων προς έλεγχο (${alerts.length})`,
    html: emailTemplate({
      badge: "Στόλος",
      badgeColor: "red",
      title: "Οχήματα με ΚΤΕΟ/Service που λήγει ή έληξε",
      intro: "Συγκεντρωτική λίστα όλου του στόλου (ανεξάρτητα από ανάθεση σε τεχνικό) — έλεγξε και προγραμμάτισε ανανέωση.",
      rows: [["Οχήματα", alerts.join("<br>")]],
      ctaText: "Άνοιγμα Portal",
      ctaUrl: `${PORTAL_URL}/hub`,
      footer: "Αναλυτικά στο tab «Στόλος Οχημάτων».",
    }),
  });
  await logEmailFailure(env, "fleet_compliance_email_failed", "cron", result, { to: directors.map((d) => d.Email) });
  return result;
}

/** Καλείται κάθε Δευτέρα πρωί (cron) — αναφορά για την προηγούμενη εβδομάδα */
export async function sendWeeklyReports(env) {
  const leaders = await allLeaders(env);
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const iso = (d) => d.toISOString().slice(0, 10);
  const rangeStart = iso(start);
  const rangeEnd = iso(end);
  const rangeLabel = `${fmtDateEl(rangeStart)} – ${fmtDateEl(rangeEnd)}`;

  const results = [];
  for (const leader of leaders) {
    if (!leader.Email) continue;
    results.push(await sendTeamReport(env, leader, { periodLabel: "Εβδομαδιαία", rangeStart, rangeEnd, rangeLabel }));
  }
  results.push(await sendFleetComplianceAlert(env));
  return results;
}

/** Καλείται την 1η κάθε μήνα (cron) — αναφορά για τον προηγούμενο μήνα */
export async function sendMonthlyReports(env) {
  const leaders = await allLeaders(env);
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonth);
  lastOfPrevMonth.setDate(lastOfPrevMonth.getDate() - 1);
  const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  const rangeStart = iso(firstOfPrevMonth);
  const rangeEnd = iso(lastOfPrevMonth);
  const rangeLabel = lastOfPrevMonth.toLocaleDateString("el-GR", { month: "long", year: "numeric" });

  const results = [];
  for (const leader of leaders) {
    if (!leader.Email) continue;
    results.push(await sendTeamReport(env, leader, { periodLabel: "Μηνιαία", rangeStart, rangeEnd, rangeLabel }));
  }
  results.push(await sendAccountantMonthlyReport(env, { rangeStart, rangeEnd, rangeLabel }));
  return results;
}

/**
 * Συγκεντρωτικό daily email χρεώσεων στις 19:00 Αθήνας (cron στο
 * wrangler.toml, βλ. σχόλιο εκεί για το UTC/DST ζήτημα) — ρητή απόφαση
 * χρήστη: αντικαθιστά ΜΟΝΟ την άμεση ειδοποίηση του TL ανά χρέωση (βλ.
 * src/assignments.js, openAssignment/openEpassAssignment) — ο τεχνικός
 * εξακολουθεί να παίρνει το δικό του άμεσο email, ίδιο μηχανισμό με πριν.
 * Μόνο σημερινή κίνηση (όχι όλες οι τρέχουσες ανοιχτές χρεώσεις) — αν ένας
 * TL δεν είχε καμία κίνηση σήμερα, δεν παίρνει καθόλου email (ρητή απόφαση
 * χρήστη, όχι κενά digests).
 */
function dailyChargeLines(charges, today) {
  return charges.map((c) => {
    const actions = [];
    if (c.ChargedAt === today) actions.push("χρεώθηκε");
    if (c.ReleasedAt === today) actions.push("αποχρεώθηκε");
    return `${c.ItemLabel} — ${c.EmployeeName} (${actions.join(" & ") || "ενημέρωση"})`;
  });
}

export async function sendDailyChargesDigest(env) {
  const leaders = await allLeaders(env);
  const today = new Date().toISOString().slice(0, 10);

  const results = [];
  for (const leader of leaders) {
    if (!leader.Email) continue;

    const data = await getTeamLeaderData(env, leader.Email);
    const employeeIds = data.team.map((e) => String(e.EmployeeID));
    const charges = await listTodaysChargesForEmployees(env, employeeIds);
    if (!charges.length) continue; // καμία κίνηση σήμερα -> κανένα email

    const linesHtml = dailyChargeLines(charges, today).join("<br>");
    const result = await sendEmail(env, {
      to: [leader.Email],
      subject: `OptikiTec Portal — Χρεώσεις ημέρας (${fmtDateEl(today)})`,
      html: emailTemplate({
        badge: "Ημερήσια σύνοψη",
        badgeColor: "blue",
        title: "Χρεώσεις ημέρας",
        intro: `Σημερινή κίνηση χρεώσεων για την ομάδα σου (${fmtDateEl(today)}).`,
        rows: [["Χρεώσεις", linesHtml]],
        ctaText: "Άνοιγμα Portal",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Αναλυτικά στο tab «Στην Κατοχή μου» κάθε τεχνικού.",
      }),
    });
    await logEmailFailure(env, "daily_charges_digest_email_failed", "cron", result, { to: leader.Email });
    results.push(result);
  }
  return results;
}
