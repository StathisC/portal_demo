/**
 * «Ανακοινώσεις» — ερωτήματα διαθεσιμότητας επαρχίας (item #7, 13/08/2026,
 * σχεδιασμός μέσω ερωτήσεων πριν την υλοποίηση). Ένας Team Leader (ή
 * Director, μέσω του ίδιου gate inheritance με το υπόλοιπο portal)
 * δημιουργεί ένα ερώτημα Ναι/Όχι με προθεσμία, στοχεύοντας μία ή
 * περισσότερες ΕΙΔΙΚΟΤΗΤΕΣ (πεδίο `Team` του φύλλου Υπάλληλοι — ίδια έννοια
 * με το tab «Διαθεσιμότητα Τεχνικών», ρητή διευκρίνιση χρήστη — ΟΧΙ την
 * ομάδα αναφοράς ανά TL/`TeamLeaderEmail`, που είναι διαφορετική έννοια στο
 * ίδιο codebase). Οι στοχευμένοι τεχνικοί απαντάνε Ναι/Όχι από το δικό τους
 * tab «Ανακοινώσεις» μέχρι την προθεσμία· μετά κλειδώνει (καμία αλλαγή,
 * ρητή απόφαση χρήστη).
 *
 * ΟΛΟΙ οι TL/Director βλέπουν ΟΛΑ τα ερωτήματα (όχι μόνο του δημιουργού) +
 * συγκεντρωτικές απαντήσεις — ρητή απόφαση χρήστη, πλήρης συμμετρία. Μόνο
 * TL/Director δημιουργεί ΚΑΙ διαγράφει (οποιοσδήποτε, όχι μόνο ο δημιουργός
 * — ίδια συμμετρία) — ΟΧΙ Backoffice, το tab δεν είναι καν ορατό σε αυτούς
 * (βλ. TOOLS στο hub.html). Ανενεργοί τεχνικοί εξαιρούνται πάντα από
 * στόχευση/email, ίδια λογική με αλλού (π.χ. getAllTechniciansAvailability).
 *
 * Email ειδοποίησης στους στοχευμένους τεχνικούς τη στιγμή δημιουργίας —
 * ρητή απαίτηση χρήστη, ίδιο μοτίβο Reply-To=actor με τις υπόλοιπες
 * ενέργειες του portal. Σιωπηλό no-op αν λείπουν τα relay secrets.
 *
 * **Ετεροχρονισμένη δημοσίευση + «χωρίς λήξη» — ΕΓΙΝΕ (20/08/2026, ρητή
 * απαίτηση χρήστη, αποφασίστηκε μέσω διευκρινιστικών ερωτήσεων πριν την
 * υλοποίηση):**
 *   - Νέο προαιρετικό πεδίο `PublishAt` (ημερομηνία, ΟΧΙ ώρα — ρητή επιλογή
 *     χρήστη, ίδια ακρίβεια με το `Deadline`). Κενό/σήμερα = άμεση
 *     δημοσίευση (ίδια συμπεριφορά με πριν). Μελλοντική ημερομηνία = το
 *     ερώτημα αποθηκεύεται αλλά ΔΕΝ είναι ορατό στους τεχνικούς και ΔΕΝ
 *     στέλνεται email μέχρι να φτάσει η ημερομηνία εκείνη — γίνεται
 *     "Δημοσιευμένο" αυτόματα από νέο καθημερινό Cron Trigger
 *     (`publishScheduledAvailabilityQueries()`, βλ. scheduled() στο
 *     src/index.js + wrangler.toml `"0 5 * * *"`).
 *   - Νέο πεδίο `EmailSentAt` — κενό μέχρι να σταλεί πραγματικά η
 *     ειδοποίηση (είτε αμέσως στη δημιουργία, είτε αργότερα από το cron,
 *     είτε από επεξεργασία που φέρνει τη δημοσίευση στο σήμερα) — αποτρέπει
 *     διπλή αποστολή αν το cron ξανατρέξει πριν προλάβει να ενημερωθεί η
 *     γραμμή.
 *   - Το `Deadline` έγινε προαιρετικό — κενό σημαίνει «χωρίς λήξη»: το
 *     ερώτημα παραμένει ΠΑΝΤΑ ενεργό/απαντήσιμο (κανένα κλείδωμα, οι
 *     τεχνικοί μπορούν να αλλάξουν γνώμη οποτεδήποτε), μέχρι κάποιος
 *     TL/Director να το διαγράψει χειροκίνητα.
 *
 * Δύο νέα φύλλα Sheet — χειροκίνητο βήμα εκκρεμεί, βλ. CLAUDE.md:
 *   `ΕρωτηματαΔιαθεσιμότητας`: ID | Question | Deadline | TargetTeams | CreatedBy | CreatedByName | CreatedAt | PublishAt | EmailSentAt | ResponseMode
 *   `ΑπαντησειςΔιαθεσιμότητας`: ID | QueryID | EmployeeID | EmployeeName | Answer | AnsweredAt
 *
 * **Τύπος ανακοίνωσης: Ναι/Όχι ή «Έλαβα γνώση» — ΕΓΙΝΕ (21/08/2026, ρητή
 * απαίτηση χρήστη, αποφασίστηκε μέσω διευκρινιστικών ερωτήσεων πριν την
 * υλοποίηση):** νέο προαιρετικό πεδίο `ResponseMode` — `"YESNO"` (προεπιλογή,
 * ίδια συμπεριφορά με πριν, καλύπτει και όλες τις παλιές γραμμές χωρίς τιμή)
 * ή `"ACK"`. Στο `"ACK"`, ο τεχνικός βλέπει ΕΝΑ κουμπί «Έλαβα γνώση» αντί για
 * Ναι/Όχι — μία εφάπαξ ενέργεια (καμία δυνατότητα «απο-επιβεβαίωσης»), η
 * απάντηση αποθηκεύεται στο ίδιο φύλλο `ΑπαντησειςΔιαθεσιμότητας` με σταθερή
 * τιμή `ACK_VALUE` στο `Answer` (ο server αγνοεί ό,τι answer value σταλεί
 * από το client για `ACK` ερωτήματα, γράφει πάντα τη σταθερή τιμή — αποφεύγει
 * client/server drift). Ρητή απόφαση χρήστη: όταν `ACK`, το πεδίο
 * `Deadline` **κρύβεται εντελώς** στη φόρμα και ο server το εξαναγκάζει σε
 * κενό ό,τι κι αν σταλεί — άρα ένα ερώτημα `ACK` είναι ΠΑΝΤΑ «χωρίς λήξη»
 * (ποτέ δεν κλειδώνει, `isExpired()` πάντα false), μέχρι να διαγραφεί
 * χειροκίνητα. Το `listAvailabilityQueries()`/`listMyAvailabilityQueries()`
 * επιστρέφουν πλέον και `ResponseMode` ανά ερώτημα ώστε το UI να διαλέγει
 * σωστή αναπαράσταση.
 *
 * **Τρίτος τύπος «NONE» — καθαρά ενημερωτικό, χωρίς καμία δυνατότητα
 * απάντησης — ΕΓΙΝΕ (22/08/2026, ρητή απαίτηση χρήστη):** ο τεχνικός δεν
 * βλέπει ΚΑΝΕΝΑ κουμπί (ούτε Ναι/Όχι, ούτε «Έλαβα γνώση») — απλά διαβάζει
 * το κείμενο. `submitAvailabilityAnswer()` απορρίπτει ΚΑΘΕ προσπάθεια
 * απάντησης σε ερώτημα `NONE` (defensive, ακόμα κι αν κάποιος καλέσει το
 * endpoint απευθείας) — άρα ΠΟΤΕ δεν γράφεται γραμμή στο
 * `ΑπαντησειςΔιαθεσιμότητας` γι' αυτά, καμία παρακολούθηση/μέτρηση
 * «είδαν/δεν είδαν». Ίδια συμπεριφορά με το `ACK` ως προς το `Deadline`
 * (κρύβεται εντελώς, πάντα «χωρίς λήξη»).
 * `TargetTeams` αποθηκεύεται ως JSON array από ονόματα ειδικοτήτων, ή το
 * sentinel `["ALL"]` για «όλες» (ρητή απόφαση χρήστη, dropdown πολλαπλής
 * επιλογής χωρίς hardcoded λίστα — reuse `listTeamOptions()` του leaves.js,
 * ίδιο μοτίβο με το Περιοχή/Team dropdown στο Νέος Τεχνικός).
 *
 * Διαγραφή (ρητή απαίτηση χρήστη, item #7 follow-up): πραγματική διαγραφή
 * γραμμής (deleteRow, ίδιο με deleteAnnouncement) — ΟΧΙ soft delete. Οι
 * τυχόν ήδη καταχωρημένες απαντήσεις ΔΕΝ διαγράφονται μαζί (μένουν ορφανές
 * γραμμές στο φύλλο Απαντήσεις) — σκόπιμη απλοποίηση: αβλαβές, ποτέ δεν
 * εμφανίζονται πουθενά χωρίς αντίστοιχο ερώτημα, αποφεύγει ένα επιπλέον
 * batch διαγραφών ανά διαγραφή ερωτήματος.
 */

import { readSheetAsObjects, appendRow, updateRow, deleteRow, appendAuditLog } from "./sheets.js";
import { sendEmail, emailTemplate, resolveActorName, PORTAL_URL, logEmailFailure } from "./email.js";
import { normalizeSheetDate, formatSheetDateEl } from "./dateutil.js";

const SHEET_QUERIES = "ΕρωτηματαΔιαθεσιμότητας";
const SHEET_RESPONSES = "ΑπαντησειςΔιαθεσιμότητας";
const SHEET_EMPLOYEES = "Υπάλληλοι";

const QUERIES_HEADER_ORDER = [
  "ID", "Question", "Deadline", "TargetTeams", "CreatedBy", "CreatedByName", "CreatedAt", "PublishAt", "EmailSentAt", "ResponseMode",
];
const RESPONSES_HEADER_ORDER = ["ID", "QueryID", "EmployeeID", "EmployeeName", "Answer", "AnsweredAt"];

/** Σταθερή τιμή Answer για ερωτήματα τύπου "ACK" — ο server την επιβάλλει πάντα, αγνοεί ό,τι answer value σταλεί από το client (βλ. submitAvailabilityAnswer). */
const ACK_VALUE = "ΕΛΑΒΕ ΓΝΩΣΗ";
/** "NONE" (22/08/2026) — καθαρά ενημερωτική ανακοίνωση, ΚΑΜΙΑ δυνατότητα απάντησης/επιβεβαίωσης· κανένα κουμπί στον τεχνικό, καμία γραμμή γράφεται ΠΟΤΕ στο ΑπαντησειςΔιαθεσιμότητας γι' αυτές, καμία παρακολούθηση/μέτρηση. */
const RESPONSE_MODES = ["YESNO", "ACK", "NONE"];

function normalizeResponseMode(mode) {
  return RESPONSE_MODES.includes(mode) ? mode : "YESNO";
}

/** ACK και NONE δεν έχουν έννοια προθεσμίας — κρύβεται/αγνοείται και στα δύο (μόνο YESNO δείχνει το πεδίο). */
function responseModeHidesDeadline(mode) {
  return mode !== "YESNO";
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Πάντα περνάει πρώτα από normalizeSheetDate() — βλ. src/dateutil.js (bug
// garbled ημερομηνιών, 24/08/2026).
function fmtDateEl(iso) {
  return formatSheetDateEl(iso);
}

/** Ίδιος ορισμός "πεδίου τεχνικού" (όχι staff self-row) με isBackofficeRow στο leaves.js — δεν είναι exported εκεί, ξαναγράφεται εδώ τοπικά (ίδιο μοτίβο με reports.js, κάθε module κρατά τα δικά του μικρά helpers) */
function isFieldTechnicianRow(emp) {
  const team = String(emp.Team || "").trim().toLowerCase();
  const isStaffSelfRow = team === "back office" || team === "backoffice" || team === "team leader";
  const isActive = (emp.Status || "Ενεργός") !== "Ανενεργός";
  return !isStaffSelfRow && isActive;
}

function parseTargetTeams(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function teamsMatch(targetTeams, team) {
  return targetTeams.includes("ALL") || targetTeams.includes(team);
}

/** Δημοσιευμένο = χωρίς PublishAt (legacy γραμμές πριν το feature) ή PublishAt <= σήμερα. PublishAt γράφεται πάντα σε νέες/επεξεργασμένες γραμμές (βλ. createAvailabilityQuery/updateAvailabilityQuery) — το "χωρίς τιμή" καλύπτει μόνο ήδη υπάρχουσες γραμμές πριν το feature. */
function isPublished(q, today) {
  const publishAt = normalizeSheetDate(q.PublishAt);
  return !publishAt || publishAt <= today;
}

/** "Χωρίς λήξη" (κενό Deadline) = ποτέ δεν λήγει */
function isExpired(q, today) {
  const deadline = normalizeSheetDate(q.Deadline);
  return !!deadline && deadline < today;
}

/** Ενεργοί πεδίου τεχνικοί που ταιριάζουν στις στοχευμένες ειδικότητες */
async function getTargetTechnicians(env, targetTeams) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees.filter((e) => isFieldTechnicianRow(e) && teamsMatch(targetTeams, e.Team || ""));
}

/**
 * Στέλνει το email ειδοποίησης στους στοχευμένους τεχνικούς — reuse από
 * createAvailabilityQuery (άμεση δημοσίευση), updateAvailabilityQuery (αν η
 * επεξεργασία φέρνει τη δημοσίευση στο σήμερα και δεν έχει σταλεί ακόμα) και
 * publishScheduledAvailabilityQueries (το καθημερινό cron). Fan-out ανά
 * παραλήπτη (ξεχωριστό sendEmail ανά τεχνικό-στόχο) — καταγράφουμε ξεχωριστά
 * ποιος/ποιοι απέτυχαν, όχι μόνο ότι "κάτι" απέτυχε στην ομάδα.
 */
async function notifyTargets(env, row, teams) {
  const targets = await getTargetTechnicians(env, teams);
  const recipients = targets.filter((t) => t.Email);
  if (!recipients.length) return;

  const actorName = row.CreatedByName || (await resolveActorName(env, row.CreatedBy));
  const mode = normalizeResponseMode(row.ResponseMode);
  const isAck = mode === "ACK";
  const isNone = mode === "NONE";
  const rows = mode === "YESNO"
    ? [["Ερώτημα", row.Question], row.Deadline ? ["Προθεσμία απάντησης", fmtDateEl(row.Deadline)] : ["Προθεσμία απάντησης", "Χωρίς λήξη"]]
    : [["Ερώτημα", row.Question]];
  const results = await Promise.all(
    recipients.map((t) =>
      sendEmail(env, {
        to: [t.Email],
        subject: `Νέα ανακοίνωση: ${row.Question}`,
        html: emailTemplate({
          badge: "Ανακοίνωση",
          badgeColor: "blue",
          title: mode === "YESNO" ? "Νέο ερώτημα διαθεσιμότητας" : "Νέα ενημέρωση",
          intro: isAck
            ? `Ο/Η <strong>${actorName}</strong> δημιούργησε μια νέα ενημέρωση που περιμένει να τη δεις.`
            : isNone
            ? `Ο/Η <strong>${actorName}</strong> δημιούργησε μια νέα ενημέρωση.`
            : `Ο/Η <strong>${actorName}</strong> δημιούργησε ένα νέο ερώτημα και περιμένει την απάντησή σου.`,
          rows,
          ctaText: mode === "YESNO" ? "Απάντηση στο Portal" : "Προβολή στο Portal",
          ctaUrl: `${PORTAL_URL}/hub`,
          footer: "Δες το από το tab «Ανακοινώσεις» του Demo Portal.",
        }),
        replyTo: row.CreatedBy,
        replyToName: actorName,
      }).then((result) => ({ result, to: t.Email }))
    )
  );
  for (const { result, to } of results) {
    await logEmailFailure(env, "availability_query_email_failed", row.CreatedBy, result, { id: row.ID, to });
  }
}

/**
 * Δημιουργία νέου ερωτήματος (μόνο TL/Director, βλ. requireTeamLeader στο
 * index.js). `deadline` προαιρετικό πλέον (κενό = χωρίς λήξη). `publishAt`
 * προαιρετικό — κενό/σήμερα = άμεση δημοσίευση (email φεύγει αμέσως, ίδια
 * συμπεριφορά με πριν)· μελλοντική ημερομηνία = αποθηκεύεται αλλά μένει
 * αόρατο στους τεχνικούς μέχρι το καθημερινό cron να το δημοσιεύσει.
 */
export async function createAvailabilityQuery(env, { question, deadline, targetTeams, createdBy, createdByName, publishAt, responseMode }) {
  if (!question || !String(question).trim()) throw new Error("Χρειάζεται κείμενο ερωτήματος.");
  const mode = normalizeResponseMode(responseMode);
  // «Έλαβα γνώση» και «καθαρά ενημερωτικό» δεν έχουν προθεσμία — κρύβεται
  // εντελώς στη φόρμα, ο server το επιβάλλει εδώ ό,τι κι αν σταλεί (ρητή
  // απόφαση χρήστη).
  const effectiveDeadline = responseModeHidesDeadline(mode) ? "" : deadline;
  if (effectiveDeadline && String(effectiveDeadline) < todayStr()) throw new Error("Η προθεσμία λήξης δεν μπορεί να είναι στο παρελθόν.");
  const teams = Array.isArray(targetTeams) ? targetTeams.filter(Boolean) : [];
  if (!teams.length) throw new Error("Χρειάζεται τουλάχιστον μία ειδικότητα-στόχος.");

  const today = todayStr();
  if (publishAt && String(publishAt) < today) throw new Error("Η ημερομηνία δημοσίευσης δεν μπορεί να είναι στο παρελθόν.");
  const effectivePublishAt = publishAt ? String(publishAt) : today;
  if (effectiveDeadline && effectivePublishAt > String(effectiveDeadline)) {
    throw new Error("Η προθεσμία λήξης δεν μπορεί να είναι πριν τη δημοσίευση.");
  }
  const immediate = effectivePublishAt <= today;

  const row = {
    ID: crypto.randomUUID(),
    Question: String(question).trim(),
    Deadline: effectiveDeadline || "",
    TargetTeams: JSON.stringify(teams),
    CreatedBy: createdBy || "",
    CreatedByName: createdByName || createdBy || "",
    CreatedAt: new Date().toISOString(),
    PublishAt: effectivePublishAt,
    EmailSentAt: immediate ? new Date().toISOString() : "",
    ResponseMode: mode,
  };
  await appendRow(env, SHEET_QUERIES, row, QUERIES_HEADER_ORDER);
  await appendAuditLog(env, "availability_query_created", createdBy, {
    id: row.ID, question: row.Question, teams, publishAt: row.PublishAt, scheduled: !immediate, responseMode: mode,
  });

  if (immediate) {
    await notifyTargets(env, row, teams);
  }

  return { success: true, query: row, scheduled: !immediate };
}

/**
 * Όλα τα ερωτήματα (όλων των TL) + συγκεντρωτικές απαντήσεις — για τη
 * λίστα TL/Director. Σειρά: Προγραμματισμένα (δεν έχουν δημοσιευτεί ακόμα,
 * πιο κοντινή ημερομηνία δημοσίευσης πρώτα) → Ενεργά (δημοσιευμένα, χωρίς
 * λήξη ή προθεσμία που δεν έχει περάσει, πιο πρόσφατα πρώτα) → Ληγμένα.
 */
export async function listAvailabilityQueries(env) {
  const [queries, responses, employees] = await Promise.all([
    readSheetAsObjects(env, SHEET_QUERIES),
    readSheetAsObjects(env, SHEET_RESPONSES),
    readSheetAsObjects(env, SHEET_EMPLOYEES),
  ]);
  const today = todayStr();

  const result = queries.map((q) => {
    const teams = parseTargetTeams(q.TargetTeams);
    const targets = employees.filter((e) => isFieldTechnicianRow(e) && teamsMatch(teams, e.Team || ""));
    const myResponses = responses.filter((r) => r.QueryID === q.ID);

    const mode = normalizeResponseMode(q.ResponseMode);
    const isAck = mode === "ACK";
    const isNone = mode === "NONE";
    const yes = [];
    const no = [];
    const pending = [];
    // "NONE" — καμία παρακολούθηση, ποτέ δεν γράφεται απάντηση γι' αυτά (βλ.
    // submitAvailabilityAnswer) — τα 3 arrays μένουν σκόπιμα κενά.
    if (!isNone) {
      for (const t of targets) {
        const resp = myResponses.find((r) => String(r.EmployeeID) === String(t.EmployeeID));
        if (!resp) {
          pending.push(t.Name);
        } else if (isAck) {
          // "Έλαβα γνώση" — καμία έννοια «Όχι», μόνο «το είδε» ή «δεν το είδε ακόμα».
          yes.push(t.Name);
        } else if (resp.Answer === "Ναι") {
          yes.push(t.Name);
        } else {
          no.push(t.Name);
        }
      }
    }
    yes.sort((a, b) => a.localeCompare(b, "el"));
    no.sort((a, b) => a.localeCompare(b, "el"));
    pending.sort((a, b) => a.localeCompare(b, "el"));

    const published = isPublished(q, today);
    const expired = isExpired(q, today);

    return {
      ID: q.ID,
      Question: q.Question,
      // Κανονικοποίηση σε ISO — βλ. src/dateutil.js (bug garbled ημερομηνιών,
      // 24/08/2026).
      Deadline: normalizeSheetDate(q.Deadline),
      TargetTeams: teams,
      CreatedByName: q.CreatedByName || q.CreatedBy || "",
      CreatedAt: q.CreatedAt,
      PublishAt: normalizeSheetDate(q.PublishAt),
      ResponseMode: mode,
      Scheduled: !published,
      Active: published && !expired,
      TotalTargeted: targets.length,
      YesNames: yes,
      NoNames: no,
      PendingNames: pending,
    };
  });

  return result.sort((a, b) => {
    const rank = (q) => (q.Scheduled ? 0 : q.Active ? 1 : 2);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return String(a.PublishAt).localeCompare(String(b.PublishAt)); // Προγραμματισμένα: πιο κοντινά πρώτα (ήδη κανονικοποιημένο ISO)
    return new Date(b.CreatedAt) - new Date(a.CreatedAt);
  });
}

/**
 * Ενεργά + ληγμένα ερωτήματα που αφορούν συγκεκριμένο τεχνικό (βάσει
 * ειδικότητας), με τη δική του απάντηση αν υπάρχει — για το tab
 * «Ανακοινώσεις» του τεχνικού. Ερωτήματα που δεν έχουν δημοσιευτεί ακόμα
 * (μελλοντικό PublishAt) αποκλείονται εντελώς — δεν πρέπει να φαίνονται
 * πριν έρθει η ώρα τους.
 */
export async function listMyAvailabilityQueries(env, employeeId) {
  const [queries, responses, employees] = await Promise.all([
    readSheetAsObjects(env, SHEET_QUERIES),
    readSheetAsObjects(env, SHEET_RESPONSES),
    readSheetAsObjects(env, SHEET_EMPLOYEES),
  ]);
  const me = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  if (!me) return [];
  const myTeam = me.Team || "";
  const today = todayStr();

  const mine = queries.filter((q) => teamsMatch(parseTargetTeams(q.TargetTeams), myTeam) && isPublished(q, today));
  return mine
    .map((q) => {
      const resp = responses.find((r) => r.QueryID === q.ID && String(r.EmployeeID) === String(employeeId));
      return {
        ID: q.ID,
        Question: q.Question,
        Deadline: normalizeSheetDate(q.Deadline),
        CreatedByName: q.CreatedByName || q.CreatedBy || "",
        CreatedAt: q.CreatedAt,
        Active: !isExpired(q, today),
        ResponseMode: normalizeResponseMode(q.ResponseMode),
        MyAnswer: resp ? resp.Answer : null,
      };
    })
    .sort((a, b) => {
      if (a.Active !== b.Active) return a.Active ? -1 : 1;
      return new Date(b.CreatedAt) - new Date(a.CreatedAt);
    });
}

/**
 * Καταχώρηση/αλλαγή απάντησης τεχνικού (upsert — ίδιο μοτίβο με
 * saveCrewsForDate στο crews.js). Μπλοκάρεται μετά την προθεσμία — αν δεν
 * υπάρχει προθεσμία (Deadline κενό, «χωρίς λήξη»), ποτέ δεν κλειδώνει.
 */
export async function submitAvailabilityAnswer(env, { queryId, employeeId, answer }) {
  const [queries, employees, responses] = await Promise.all([
    readSheetAsObjects(env, SHEET_QUERIES),
    readSheetAsObjects(env, SHEET_EMPLOYEES),
    readSheetAsObjects(env, SHEET_RESPONSES),
  ]);
  const query = queries.find((q) => q.ID === queryId);
  if (!query) throw new Error("Το ερώτημα δεν βρέθηκε.");
  const mode = normalizeResponseMode(query.ResponseMode);
  // "NONE" — καθαρά ενημερωτικό, ΚΑΜΙΑ δυνατότητα απάντησης· απορρίπτεται
  // εντελώς εδώ (defensive, ακόμα κι αν κληθεί το endpoint απευθείας χωρίς
  // κουμπί στο UI — δεν πρέπει ΠΟΤΕ να γραφτεί γραμμή στο Απαντήσεις γι' αυτά).
  if (mode === "NONE") throw new Error("Αυτή η ανακοίνωση δεν δέχεται απάντηση.");
  const isAck = mode === "ACK";
  // Για "ACK" ερωτήματα ο server επιβάλλει πάντα τη σταθερή τιμή — αγνοεί ό,τι
  // answer value σταλεί από το client (αποφεύγει client/server drift).
  const effectiveAnswer = isAck ? ACK_VALUE : answer;
  if (!isAck && effectiveAnswer !== "Ναι" && effectiveAnswer !== "Όχι") throw new Error("Μη έγκυρη απάντηση.");

  const today = todayStr();
  if (!isPublished(query, today)) throw new Error("Το ερώτημα δεν έχει δημοσιευτεί ακόμα.");
  const queryDeadline = normalizeSheetDate(query.Deadline);
  if (queryDeadline && queryDeadline < today) throw new Error("Η προθεσμία απάντησης έχει λήξει.");

  const me = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  if (!me) throw new Error("Ο τεχνικός δεν βρέθηκε.");
  const teams = parseTargetTeams(query.TargetTeams);
  if (!teamsMatch(teams, me.Team || "")) throw new Error("Το ερώτημα δεν σε αφορά.");

  const existing = responses.find((r) => r.QueryID === queryId && String(r.EmployeeID) === String(employeeId));
  const row = {
    ID: existing ? existing.ID : crypto.randomUUID(),
    QueryID: queryId,
    EmployeeID: employeeId,
    EmployeeName: me.Name || "",
    Answer: effectiveAnswer,
    AnsweredAt: new Date().toISOString(),
  };

  if (existing) {
    const values = RESPONSES_HEADER_ORDER.map((h) => (row[h] !== undefined ? row[h] : ""));
    await updateRow(env, SHEET_RESPONSES, existing._row, values);
  } else {
    await appendRow(env, SHEET_RESPONSES, row, RESPONSES_HEADER_ORDER);
  }

  await appendAuditLog(env, "availability_answer_submitted", employeeId, { queryId, answer });
  return { success: true, answer };
}

/**
 * Επεξεργασία υπάρχοντος ερωτήματος (ρητή απαίτηση χρήστη, 15/08/2026) —
 * οποιοσδήποτε TL/Director, όχι μόνο ο δημιουργός (ίδια πλήρης συμμετρία με
 * τη διαγραφή). Επιτρέπει αλλαγή κειμένου/προθεσμίας/στοχευμένων
 * ειδικοτήτων/ημερομηνίας δημοσίευσης. `deadline` προαιρετικό (κενό = χωρίς
 * λήξη). Σκόπιμα ΚΑΜΙΑ επικύρωση "η προθεσμία δεν μπορεί να είναι στο
 * παρελθόν" εδώ (σε αντίθεση με τη δημιουργία) — επιτρέπει σε έναν TL να
 * κλείσει νωρίτερα ένα ερώτημα βάζοντας παρελθοντική ημερομηνία, χωρίς να
 * χρειάζεται διαγραφή.
 *
 * Ετεροχρονισμένη δημοσίευση (20/08/2026): αν η επεξεργασία αλλάζει το
 * `PublishAt` σε σήμερα/παρελθόν ΚΑΙ το email δεν έχει σταλεί ακόμα
 * (`EmailSentAt` κενό — δηλαδή ήταν προγραμματισμένο και δεν πρόλαβε το
 * cron), το email φεύγει ΤΩΡΑ μέσα από αυτή την κλήση, δεν περιμένει το
 * επόμενο πέρασμα του cron. Σε κάθε άλλη περίπτωση (ήδη δημοσιευμένο, ή
 * παραμένει προγραμματισμένο) ΚΑΜΙΑ επανα-αποστολή — ίδιο μοτίβο "no
 * re-email on edit" με τα υπόλοιπα edit σημεία του portal.
 */
export async function updateAvailabilityQuery(env, { id, question, deadline, targetTeams, publishAt, responseMode, actorEmail }) {
  if (!question || !String(question).trim()) throw new Error("Χρειάζεται κείμενο ερωτήματος.");
  const teams = Array.isArray(targetTeams) ? targetTeams.filter(Boolean) : [];
  if (!teams.length) throw new Error("Χρειάζεται τουλάχιστον μία ειδικότητα-στόχος.");

  const queries = await readSheetAsObjects(env, SHEET_QUERIES);
  const existing = queries.find((q) => q.ID === id);
  if (!existing) throw new Error("Το ερώτημα δεν βρέθηκε.");

  // Αν δεν σταλεί ρητά (π.χ. παλιό client), διατηρείται η υπάρχουσα τιμή —
  // ίδιο μοτίβο "no accidental reset" με τα υπόλοιπα προαιρετικά πεδία εδώ.
  const mode = normalizeResponseMode(responseMode !== undefined ? responseMode : existing.ResponseMode);
  const effectiveDeadline = responseModeHidesDeadline(mode) ? "" : deadline;

  const today = todayStr();
  const newPublishAt = publishAt ? String(publishAt) : (existing.PublishAt || today);

  const row = {
    ID: existing.ID,
    Question: String(question).trim(),
    Deadline: effectiveDeadline || "",
    TargetTeams: JSON.stringify(teams),
    CreatedBy: existing.CreatedBy,
    CreatedByName: existing.CreatedByName,
    CreatedAt: existing.CreatedAt,
    PublishAt: newPublishAt,
    EmailSentAt: existing.EmailSentAt || "",
    ResponseMode: mode,
  };

  const becomesDueNow = newPublishAt <= today && !existing.EmailSentAt;
  if (becomesDueNow) {
    row.EmailSentAt = new Date().toISOString();
  }

  const values = QUERIES_HEADER_ORDER.map((h) => (row[h] !== undefined ? row[h] : ""));
  await updateRow(env, SHEET_QUERIES, existing._row, values);
  await appendAuditLog(env, "availability_query_updated", actorEmail, { id, question: row.Question, teams, publishAt: newPublishAt, responseMode: mode });

  if (becomesDueNow) {
    await notifyTargets(env, row, teams);
  }

  return { success: true };
}

/**
 * Διαγραφή ερωτήματος (ρητή απαίτηση χρήστη) — οποιοσδήποτε TL/Director,
 * όχι μόνο ο δημιουργός (ίδια πλήρης συμμετρία με το πώς ήδη βλέπουν όλοι
 * οι TL όλα τα ερωτήματα). Βλ. σχόλιο στην κορυφή του αρχείου για τις
 * ορφανές γραμμές απαντήσεων.
 */
export async function deleteAvailabilityQuery(env, id, actorEmail) {
  const queries = await readSheetAsObjects(env, SHEET_QUERIES);
  const existing = queries.find((q) => q.ID === id);
  if (!existing) throw new Error("Το ερώτημα δεν βρέθηκε.");
  await deleteRow(env, SHEET_QUERIES, existing._row);
  await appendAuditLog(env, "availability_query_deleted", actorEmail, { id, question: existing.Question });
  return { success: true };
}

/**
 * Καθημερινό Cron Trigger (βλ. scheduled() στο src/index.js, wrangler.toml
 * `"0 5 * * *"`) — δημοσιεύει ερωτήματα των οποίων έφτασε η προγραμματισμένη
 * ημερομηνία (`PublishAt <= σήμερα`) και δεν έχει σταλεί ακόμα το email
 * (`EmailSentAt` κενό). Η ίδια η "δημοσίευση"/ορατότητα στους τεχνικούς
 * είναι ήδη αυτόματη (υπολογίζεται live από PublishAt σε κάθε
 * listMyAvailabilityQueries) — αυτό το cron χρειάζεται ΜΟΝΟ για να στείλει
 * το email τη σωστή στιγμή, όχι για να "ξεκλειδώσει" κάτι.
 */
export async function publishScheduledAvailabilityQueries(env) {
  const queries = await readSheetAsObjects(env, SHEET_QUERIES);
  const today = todayStr();
  const due = queries.filter((q) => {
    const publishAt = normalizeSheetDate(q.PublishAt);
    return publishAt && publishAt <= today && !q.EmailSentAt;
  });

  for (const q of due) {
    const teams = parseTargetTeams(q.TargetTeams);
    try {
      await notifyTargets(env, q, teams);
    } catch (err) {
      await logEmailFailure(env, "availability_query_email_failed", "cron", { error: err.message || String(err) }, { id: q.ID });
    }
    const row = { ...q, EmailSentAt: new Date().toISOString() };
    const values = QUERIES_HEADER_ORDER.map((h) => (row[h] !== undefined ? row[h] : ""));
    await updateRow(env, SHEET_QUERIES, q._row, values);
  }

  return { published: due.length };
}
