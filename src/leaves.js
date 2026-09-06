/**
 * Business logic για το Σύστημα Αδειών — πιστό port από το Code.gs (Apps Script),
 * τώρα τρέχει απευθείας στο Worker, χωρίς ενδιάμεσο Apps Script layer.
 *
 * Email ειδοποιήσεις (μέσω src/email.js + Apps Script relay): νέα αίτηση ->
 * email στον TL του τεχνικού· απόφαση (έγκριση/απόρριψη) -> email στον
 * τεχνικό (αν έχει καταχωρημένο email — πολλοί δεν έχουν, τότε απλά δεν
 * στέλνεται τίποτα, καμία διακοπή λειτουργίας). Reply-To = actor (αυτός που
 * υπέβαλε/αποφάσισε), ίδιο μοτίβο με τα emails χρέωσης/νέου τεχνικού.
 */

import { readSheetAsObjects, appendRow, updateRow, updateCell, readCell, deleteRow, appendAuditLog, getHeaderRow, getUnformattedColumns } from "./sheets.js";
import { sendEmail, emailTemplate, resolveActorName, PORTAL_URL, logEmailFailure } from "./email.js";
import { signPayload } from "./tokens.js";
import { normalizeSheetDate, formatSheetDateEl, resolveSheetDate } from "./dateutil.js";

/**
 * readSheetAsObjects(env, SHEET_LEAVES) + StartDate/EndDate ΠΑΝΤΑ resolved
 * στη ΟΡΙΣΤΙΚΑ σωστή ISO τιμή μέσω resolveSheetDate() (βλ. src/dateutil.js).
 *
 * Γιατί χρειάζεται πέρα από το normalizeSheetDate(): όταν ένα κελί έχει
 * custom μορφή "yyyy-dd-mm" ΚΑΙ και οι δύο θέσεις (ημέρα/μήνας) είναι ≤12
 * (π.χ. "02" vs "09"), καμία ευρετική πάνω στο FORMATTED_VALUE string δεν
 * μπορεί να ξέρει με σιγουριά ποια θέση είναι ποια — βρέθηκε 24/08/2026 όταν
 * ημέρες τηλεργασίας «Σεπτεμβρίου 2/3/9/10» εμφανίζονταν σαν Φεβρουάριο/
 * Μάρτιο/Σεπτέμβριο/Οκτώβριο 9. Το `getUnformattedColumns()` κάνει ΜΙΑ
 * επιπλέον κλήση στο Sheets API (UNFORMATTED_VALUE, StartDate+EndDate μαζί
 * αφού είναι γειτονικές στήλες) και επιστρέφει τον πραγματικό σειριακό
 * αριθμό ημέρας — καμία εξάρτηση από μορφοποίηση/locale, καμία ασάφεια. ΚΑΘΕ
 * σημείο του αρχείου που διάβαζε το φύλλο Άδειες περνάει πλέον από εδώ αντί
 * για απευθείας readSheetAsObjects(env, SHEET_LEAVES), ώστε το fix να ισχύει
 * παντού χωρίς επανάληψη λογικής. Ευθυγράμμιση θέσης μέσω `_row - 2` (ίδια
 * παραδοχή "καμία κενή ενδιάμεση γραμμή" με την υπόλοιπη χρήση του `_row`
 * στο αρχείο, π.χ. updateCell/deleteRow).
 */
async function readLeavesRows(env) {
  const [rows, rawDates] = await Promise.all([
    readSheetAsObjects(env, SHEET_LEAVES),
    getUnformattedColumns(env, SHEET_LEAVES, ["StartDate", "EndDate"]).catch(() => null),
  ]);
  if (!rawDates) return rows;
  return rows.map((r) => {
    const raw = rawDates[r._row - 2] || {};
    return {
      ...r,
      StartDate: resolveSheetDate(raw.StartDate, r.StartDate),
      EndDate: resolveSheetDate(raw.EndDate, r.EndDate),
    };
  });
}

const SHEET_LEAVES = "Άδειες";
const SHEET_EMPLOYEES = "Υπάλληλοι";

// Τύποι άδειας που ΔΕΝ μπλοκάρονται από τον έλεγχο επαρκούς υπολοίπου στο
// submitLeaveRequest() παρακάτω — ρητή απαίτηση χρήστη (19/08/2026, επέκταση
// της αρχικής εξαίρεσης μόνο για "Άδεια χωρίς αποδοχές"). Λογική: η "Άδεια
// χωρίς αποδοχές" δεν "καταναλώνει" πραγματικό υπόλοιπο ούτως ή άλλως· η
// "Αναρρωτική" εξαιρείται τώρα ΕΠΙΣΗΣ γιατί απαιτεί δικαιολογητικό (ήδη
// υπάρχει μηχανισμός ανεβάσματος PDF, βλ. uploadLeaveAttachment παρακάτω) —
// ο τεχνικός δεν πρέπει να μπλοκάρεται από υπόλοιπο για κάτι που τεκμηριώνεται
// ιατρικά. Αν προστεθεί στο μέλλον νέος τύπος άδειας που επίσης απαιτεί
// δικαιολογητικό ("ή άλλο", ρητή διατύπωση χρήστη), προστίθεται εδώ.
const LEAVE_TYPES_EXEMPT_FROM_BALANCE_CAP = ["Άδεια χωρίς αποδοχές", "Αναρρωτική"];
const SHEET_TEAMLEADERS = "TeamLeaders";
const SHEET_BACKOFFICE = "Backoffice";
// Ρόλος "Director" — μόνιμη λύση για το "ποιος εγκρίνει την άδεια ενός TL"
// (βλ. CLAUDE.md). Νέο φύλλο, ΑΠΟ ΤΗΝ ΑΡΧΗ, headers Email|Name — ίδιο μοτίβο
// με TeamLeaders/Backoffice, χειροκίνητο βήμα στο Sheet.
const SHEET_DIRECTORS = "Directors";

const LEAVES_HEADER_ORDER = [
  "ID", "Timestamp", "EmployeeID", "EmployeeName", "TeamLeaderEmail",
  "Type", "StartDate", "EndDate", "Days", "Note", "Status",
  "DecisionDate", "DecisionNote", "EnteredBy",
  // Νέες στήλες στο τέλος (χειροκίνητο βήμα στο Sheet, βλ. CLAUDE.md) — μόνο
  // για δικαιολογητικό (PDF) αιτήσεων τύπου "Αναρρωτική", βλ.
  // uploadLeaveAttachment/getLeaveAttachmentById παρακάτω.
  "FileKey", "FileName", "FileType",
  // GroupID (νέα στήλη, χειροκίνητο βήμα στο Sheet, βλ. CLAUDE.md) — συνδέει
  // τις πολλαπλές μη-συνεχόμενες ημέρες ΜΙΑΣ υποβολής τηλεργασίας ώστε να
  // μπορούν να εγκριθούν/απορριφθούν ΟΛΕΣ μαζί, μία ενέργεια (ρητή απαίτηση
  // χρήστη) — βλ. submitTeleworkRequest/decideLeaveRequestGroup παρακάτω.
  // Κενό για κανονικές αιτήσεις άδειας (submitLeaveRequest).
  "GroupID",
];

const LEAVE_SICK_TYPE = "Αναρρωτική";

/** Μόνο PDF επιτρέπεται ως δικαιολογητικό αναρρωτικής — ρητή απαίτηση χρήστη */
export const LEAVE_ATTACHMENT_ALLOWED_TYPES = {
  "application/pdf": "pdf",
};

/**
 * One-click έγκριση/απόρριψη άδειας απευθείας από το email, χωρίς login
 * (βλ. CLAUDE.md, "Έγκριση/απόρριψη άδειας απευθείας από το email"). Δύο
 * ξεχωριστά signed tokens (ένα ανά decision) μπαίνουν σαν links στο email
 * της νέας αίτησης — reuse του ΙΔΙΟΥ signPayload/verifyPayload μηχανισμού
 * με τα session cookies/integration token (src/tokens.js), ίδιο secret
 * (LINK_SECRET). Type "leave-decide" στο payload ώστε να μην μπορεί να γίνει
 * replay ένα session/integration token εδώ (ή το αντίστροφο).
 *
 * ΑΣΦΑΛΕΙΑ: το GET /api/leaves/decide-link (src/index.js) ΔΕΝ αποφασίζει —
 * δείχνει μόνο μια σελίδα επιβεβαίωσης· η πραγματική ενέργεια γίνεται ΜΟΝΟ
 * στο POST (μετά από κλικ "Ναι"). Αυτό προστατεύει από email clients/
 * ασφάλεια εταιρειών που κάνουν prefetch σε GET links (θα ενεργοποιούσαν
 * αλλιώς κατά λάθος έγκριση/απόρριψη). Λήξη 14 ημερών· μετά χρειάζεται
 * κανονικό login. Καμία υποστήριξη decisionNote μέσω email (ίδιο με το
 * υπάρχον TL UI, που επίσης δεν στέλνει σημείωση απόφασης).
 */
const DECIDE_LINK_TTL_SECONDS = 60 * 60 * 24 * 14;

async function buildDecideLinkToken(env, requestId, decision, approverEmail) {
  return signPayload(
    {
      type: "leave-decide",
      requestId,
      decision,
      approverEmail,
      exp: Math.floor(Date.now() / 1000) + DECIDE_LINK_TTL_SECONDS,
    },
    env.LINK_SECRET
  );
}

/** Μικρό block με 2 κουμπιά (Έγκριση/Απόρριψη) για το email της νέας αίτησης — null αν λείπει το LINK_SECRET (σιωπηλά ανενεργό, το κανονικό CTA προς /hub παραμένει) */
async function decideLinksHtml(env, requestId, approverEmail) {
  if (!env.LINK_SECRET) return "";
  const [approveToken, rejectToken] = await Promise.all([
    buildDecideLinkToken(env, requestId, "approve", approverEmail),
    buildDecideLinkToken(env, requestId, "reject", approverEmail),
  ]);
  const approveUrl = `${PORTAL_URL}/api/leaves/decide-link?token=${approveToken}`;
  const rejectUrl = `${PORTAL_URL}/api/leaves/decide-link?token=${rejectToken}`;
  return `<table role="presentation" style="border-collapse:collapse;margin:0 0 20px;"><tr>
    <td style="padding-right:8px;"><a href="${approveUrl}" style="display:inline-block;padding:9px 16px;font-size:12.5px;font-weight:700;color:#0F6E56;background:#E3F5EC;border-radius:8px;text-decoration:none;">✅ Έγκριση χωρίς σύνδεση</a></td>
    <td><a href="${rejectUrl}" style="display:inline-block;padding:9px 16px;font-size:12.5px;font-weight:700;color:#A32D2D;background:#FBEAEA;border-radius:8px;text-decoration:none;">❌ Απόρριψη χωρίς σύνδεση</a></td>
  </tr></table>
  <p style="font-size:11px;color:#A6ADBB;margin:0 0 20px;">Θα σου ζητηθεί μία επιβεβαίωση πριν οριστικοποιηθεί. Ο σύνδεσμος ισχύει 14 ημέρες.</p>`;
}

/**
 * Ίδιο με buildDecideLinkToken/decideLinksHtml, αλλά για ΟΜΑΔΙΚΗ απόφαση
 * τηλεργασίας (πολλαπλές μη-συνεχόμενες ημέρες, κοινό GroupID — βλ.
 * submitTeleworkRequest/decideLeaveRequestGroup). Type "leave-decide-group"
 * στο payload (ξεχωριστό από το "leave-decide") ώστε το src/index.js να
 * ξέρει να καλέσει decideLeaveRequestGroup() αντί για decideLeaveRequest().
 */
async function buildDecideLinkGroupToken(env, groupId, decision, approverEmail) {
  return signPayload(
    {
      type: "leave-decide-group",
      groupId,
      decision,
      approverEmail,
      exp: Math.floor(Date.now() / 1000) + DECIDE_LINK_TTL_SECONDS,
    },
    env.LINK_SECRET
  );
}

async function decideLinksHtmlGroup(env, groupId, approverEmail) {
  if (!env.LINK_SECRET) return "";
  const [approveToken, rejectToken] = await Promise.all([
    buildDecideLinkGroupToken(env, groupId, "approve", approverEmail),
    buildDecideLinkGroupToken(env, groupId, "reject", approverEmail),
  ]);
  const approveUrl = `${PORTAL_URL}/api/leaves/decide-link?token=${approveToken}`;
  const rejectUrl = `${PORTAL_URL}/api/leaves/decide-link?token=${rejectToken}`;
  return `<table role="presentation" style="border-collapse:collapse;margin:0 0 20px;"><tr>
    <td style="padding-right:8px;"><a href="${approveUrl}" style="display:inline-block;padding:9px 16px;font-size:12.5px;font-weight:700;color:#0F6E56;background:#E3F5EC;border-radius:8px;text-decoration:none;">✅ Έγκριση όλων χωρίς σύνδεση</a></td>
    <td><a href="${rejectUrl}" style="display:inline-block;padding:9px 16px;font-size:12.5px;font-weight:700;color:#A32D2D;background:#FBEAEA;border-radius:8px;text-decoration:none;">❌ Απόρριψη όλων χωρίς σύνδεση</a></td>
  </tr></table>
  <p style="font-size:11px;color:#A6ADBB;margin:0 0 20px;">Αποφασίζει ΟΛΕΣ τις ημέρες αυτής της υποβολής μαζί. Θα σου ζητηθεί μία επιβεβαίωση πριν οριστικοποιηθεί. Ο σύνδεσμος ισχύει 14 ημέρες.</p>`;
}

// Ίδια σειρά με την ΗΔΗ υπάρχουσα δομή του φύλλου Υπάλληλοι (βλ. SETUP.md).
// HasDrivingLicense προστέθηκε ΣΤΟ ΤΕΛΟΣ (νέα στήλη — χειροκίνητο βήμα στο
// Sheet, βλ. CLAUDE.md) ώστε να μην μετατοπιστούν οι υπάρχουσες στήλες.
// Νέα προσωπικά στοιχεία τεχνικού (χειροκίνητο βήμα στο Sheet, βλ. CLAUDE.md
// — ρητή απαίτηση χρήστη): ΑΜΑ/ΑΜΚΑ/τηλέφωνο/διεύθυνση/ημ. πρόσληψης/τεχνική
// κατάρτιση (ελεύθερο κείμενο) + 3 συνημμένα (βιογραφικό, ταυτότητα/
// διαβατήριο, άδεια διαμονής — raw bytes σε KV `EMPLOYEE_FILES`, μόνο
// metadata εδώ, ίδιο μοτίβο με FileKey/FileName/FileType των αδειών).
// Ορατότητα: ΜΟΝΟ TL+Director βλέπουν αυτά τα πεδία (μέσω tab «Προφίλ
// Τεχνικού», ήδη gated με requireTeamLeader — ρητή απόφαση χρήστη λόγω
// ευαισθησίας δεδομένων, βλ. CLAUDE.md). Backoffice μπορεί να τα ΚΑΤΑΧΩΡΗΣΕΙ
// στη φόρμα «Νέος Τεχνικός» (ίδιο gate `requireTeamLeaderOrBackoffice` με
// το υπόλοιπο tab) αλλά δεν μπορεί να τα ξαναδεί μετά — το tab «Προφίλ
// Τεχνικού» δεν είναι καν στη λίστα εργαλείων του.
// CompanyPhone προστέθηκε ΣΤΟ ΤΕΛΟΣ (νέα στήλη — χειροκίνητο βήμα στο Sheet,
// βλ. CLAUDE.md) — εταιρικό τηλέφωνο/εσωτερικό νούμερο, ξεχωριστό από το
// προσωπικό Phone παραπάνω. Ίδια θέση/λογική με τις υπόλοιπες προσθήκες —
// στο ΤΕΛΟΣ ώστε να μη μετατοπιστούν οι ήδη υπάρχουσες στήλες, ακόμα κι αν
// εννοιολογικά ανήκει δίπλα στο Phone.
// Status/InactiveDate προστέθηκαν ΣΤΟ ΤΕΛΟΣ (νέες στήλες — χειροκίνητο βήμα
// στο Sheet, βλ. CLAUDE.md, 13/08/2026 #5) — Ενεργός/Ανενεργός τεχνικός.
// `Status` ∈ {"Ενεργός","Ανενεργός"}, κενό = μεταχειρίζεται σαν "Ενεργός"
// (τεχνικοί πριν από αυτό το feature). `InactiveDate` γράφεται αυτόματα
// (σημερινή ημερομηνία) όταν κάποιος γίνεται Ανενεργός, καθαρίζεται όταν
// ξαναγίνεται Ενεργός — μαζί με το ήδη υπάρχον HireDate δίνει το «Διάστημα
// Απασχόλησης» όσο ήταν ενεργός (βλ. setEmployeeStatus/tpEmploymentDuration).
const EMPLOYEE_HEADER_ORDER = [
  "EmployeeID", "Name", "Email", "TeamLeaderEmail", "AnnualDays", "Team", "HasDrivingLicense",
  "AMA", "AMKA", "Phone", "Address", "HireDate", "TechnicalTraining",
  "CvFileKey", "CvFileName", "CvFileType",
  "IdFileKey", "IdFileName", "IdFileType",
  "ResidencePermitFileKey", "ResidencePermitFileName", "ResidencePermitFileType",
  "CompanyPhone",
  "Status", "InactiveDate",
  "AFM",
  // HuskiesUsername/HuskiesPassword — ΣΤΟ ΤΕΛΟΣ (νέες στήλες, χειροκίνητο
  // βήμα στο Sheet, βλ. CLAUDE.md, 24/08/2026 §Huskies credentials).
  // Credentials τρίτου συστήματος (Huskies), αποθηκεύονται ΩΣ ΕΧΟΥΝ
  // (plaintext στο Sheet — ίδιο επίπεδο "ασφάλειας" με τα υπόλοιπα ευαίσθητα
  // πεδία αυτού του φύλλου, π.χ. ΑΜΚΑ/ΑΦΜ, όχι hashed σαν το PIN τεχνικού
  // στο KV — δεν χρειάζεται authentication εδώ, μόνο εμφάνιση/αποστολή).
  "HuskiesUsername", "HuskiesPassword",
  // PriorExperience — ΣΤΟ ΤΕΛΟΣ (νέα στήλη, χειροκίνητο βήμα στο Sheet, βλ.
  // CLAUDE.md) — «Προϋπηρεσία» (ελεύθερο κείμενο, π.χ. "5 χρόνια σε
  // παρόχους δικτύου"), εμφανίζεται στο Προφίλ Τεχνικού κάτω από την
  // Απασχόληση. Ίδιο μοτίβο προαιρετικού free-text πεδίου με το
  // TechnicalTraining/Address.
  "PriorExperience",
  // FatherName/IdNumber — ΣΤΟ ΤΕΛΟΣ (νέες στήλες, χειροκίνητο βήμα στο
  // Sheet, βλ. CLAUDE.md, 31/08/2026 §tab «Έγγραφα») — «Πατρώνυμο» και «Αρ.
  // Α.Δ.Τ.», μόνιμα προαιρετικά πεδία προφίλ (ίδιο μοτίβο με ΑΜΑ/ΑΜΚΑ/ΑΦΜ)
  // ώστε να αυτοσυμπληρώνονται στα επίσημα έγγραφα (π.χ. Αίτηση Άδειας Άνευ
  // Αποδοχών) αντί να πληκτρολογούνται κάθε φορά.
  "FatherName", "IdNumber",
];

const EMPLOYEE_STATUSES = ["Ενεργός", "Ανενεργός"];

/** Επιτρεπόμενοι τύποι αρχείου για τα 3 συνημμένα τεχνικού (βιογραφικό, ταυτότητα/διαβατήριο, άδεια διαμονής) — PDF ή εικόνα, ίδιο μέγιστο μέγεθος (20MB) με τα υπόλοιπα συνημμένα */
export const EMPLOYEE_DOCUMENT_ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** doc type key -> ονόματα στηλών στο Υπάλληλοι (βλ. EMPLOYEE_HEADER_ORDER) */
const EMPLOYEE_DOCUMENT_COLUMNS = {
  cv: { key: "CvFileKey", name: "CvFileName", type: "CvFileType", label: "Βιογραφικό" },
  id: { key: "IdFileKey", name: "IdFileName", type: "IdFileType", label: "Ταυτότητα/Διαβατήριο" },
  residence: { key: "ResidencePermitFileKey", name: "ResidencePermitFileName", type: "ResidencePermitFileType", label: "Άδεια Διαμονής" },
};

export async function getEmployeeById(env, employeeId) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees.find((e) => String(e.EmployeeID) === String(employeeId));
}

export async function getEmployeeByEmail(env, email) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  return employees.find((e) => e.Email === email);
}

export async function getTeamLeaderByEmail(env, email) {
  const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
  return leaders.find((t) => t.Email === email);
}

export async function getBackofficeByEmail(env, email) {
  const staff = await readSheetAsObjects(env, SHEET_BACKOFFICE);
  return staff.find((b) => b.Email === email);
}

/**
 * Director — ρόλος πλήρους εποπτείας (ό,τι βλέπει Backoffice + Team Leader
 * μαζί), ρητή απαίτηση χρήστη. Κύριος σκοπός: εγκρίσεις αδειών των ίδιων
 * των Team Leaders, που δεν έχουν φυσικό εγκριτή αλλιώς (βλ. submitLeaveRequest
 * παρακάτω). Ίδιο μοτίβο με TeamLeaders/Backoffice — νέο φύλλο `Directors`
 * (Email|Name), προστίθενται γραμμές χειροκίνητα στο Sheet, καμία admin UI.
 */
export async function getDirectorByEmail(env, email) {
  const directors = await readSheetAsObjects(env, SHEET_DIRECTORS);
  return directors.find((d) => d.Email === email);
}

/** Λίστα Team Leaders για dropdown (επιλογή TL κατά την προσθήκη νέου τεχνικού — TL ή Backoffice) */
export async function listTeamLeaders(env) {
  const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
  return leaders
    .filter((l) => l.Email)
    .map((l) => ({ Email: l.Email, Name: l.Name || l.Email }))
    .sort((a, b) => a.Name.localeCompare(b.Name, "el"));
}

/** Λίστα διακριτών τιμών Team/Περιοχή από τη στήλη Team του φύλλου Υπάλληλοι, για dropdown */
export async function listTeamOptions(env) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  // "Τεχνικός Εμφύσησης" seed-άρεται ρητά (ζητήθηκε από τον χρήστη) ώστε να
  // είναι διαθέσιμη επιλογή ακόμα κι αν κανένας τεχνικός δεν την έχει ακόμα.
  const set = new Set(["Τεχνικός Εμφύσησης"]);
  employees.forEach((e) => { if (e.Team) set.add(String(e.Team).trim()); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "el"));
}

/**
 * Δημιουργεί νέο τεχνικό (γραμμή στο φύλλο Υπάλληλοι). ΔΕΝ αγγίζει PIN/KV —
 * αυτό γίνεται στο index.js (handleEmployeesCreate), μαζί με το email
 * credentials, γιατί χρειάζεται το LINK_SECRET/TECHNICIAN_AUTH binding.
 */
export async function createTechnicianRecord(
  env,
  { employeeId, name, email, teamLeaderEmail, annualDays, team, hasDrivingLicense, ama, amka, afm, phone, companyPhone, address, hireDate, technicalTraining, huskiesUsername, huskiesPassword, priorExperience, fatherName, idNumber },
  createdBy
) {
  const id = String(employeeId || "").trim();
  if (!id || !/^[a-z0-9._-]+$/i.test(id)) {
    throw new Error("Μη έγκυρος κωδικός υπαλλήλου (μόνο λατινικά γράμματα/αριθμοί/._-).");
  }
  if (!name || !String(name).trim()) throw new Error("Χρειάζεται ονοματεπώνυμο.");
  if (!teamLeaderEmail) throw new Error("Χρειάζεται Team Leader.");

  const leader = await getTeamLeaderByEmail(env, teamLeaderEmail);
  if (!leader) throw new Error("Άγνωστος Team Leader.");

  const existing = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  if (existing.some((e) => String(e.EmployeeID || "").toLowerCase() === id.toLowerCase())) {
    throw new Error(`Ο κωδικός υπαλλήλου "${id}" χρησιμοποιείται ήδη — διάλεξε άλλον.`);
  }

  const row = {
    EmployeeID: id,
    Name: String(name).trim(),
    Email: email || "",
    TeamLeaderEmail: teamLeaderEmail,
    AnnualDays: annualDays !== undefined && annualDays !== "" && annualDays !== null ? Number(annualDays) : 22,
    Team: team || "",
    HasDrivingLicense: hasDrivingLicense ? "Ναι" : "Όχι",
    // Προαιρετικά προσωπικά στοιχεία — κανένα υποχρεωτικό, ρητή απαίτηση
    // χρήστη ώστε η δημιουργία τεχνικού να παραμένει γρήγορη αν δεν είναι
    // διαθέσιμα ακόμα (π.χ. ΑΜΚΑ/ΑΜΑ έρχονται συχνά αργότερα από το λογιστήριο).
    AMA: ama || "",
    AMKA: amka || "",
    Phone: phone || "",
    CompanyPhone: companyPhone || "",
    Address: address || "",
    HireDate: hireDate || "",
    TechnicalTraining: technicalTraining || "",
    // Κάθε νέος τεχνικός ξεκινάει Ενεργός — το Ανενεργό μπαίνει ρητά αργότερα
    // μέσω setEmployeeStatus() (μόνο TL/Director, βλ. CLAUDE.md 13/08/2026 #5).
    Status: "Ενεργός",
    InactiveDate: "",
    AFM: afm || "",
    // Huskies credentials — προαιρετικά, ρητή απόφαση χρήστη 24/08/2026.
    HuskiesUsername: huskiesUsername || "",
    HuskiesPassword: huskiesPassword || "",
    PriorExperience: priorExperience !== undefined && priorExperience !== "" && priorExperience !== null ? Number(priorExperience) : "",
    FatherName: fatherName || "",
    IdNumber: idNumber || "",
  };
  await appendRow(env, SHEET_EMPLOYEES, row, EMPLOYEE_HEADER_ORDER);
  await appendAuditLog(env, "employee_created", createdBy, { employeeId: id, name: row.Name, teamLeaderEmail });

  return row;
}

/**
 * Επεξεργασία στοιχείων υπάρχοντος τεχνικού (γραμμή στο Υπάλληλοι) — ρητή
 * απαίτηση χρήστη (19/08/2026): κουμπί «Επεξεργασία» στο tab «Προφίλ
 * Τεχνικού», δίπλα στο Reset PIN/Ενεργοποίηση. ΔΕΝ αγγίζει:
 *  - EmployeeID: immutable — είναι το login username του τεχνικού ΚΑΙ το key
 *    του KV TECHNICIAN_AUTH (`emp:${employeeId}`)· αλλαγή θα έσπαγε αμέσως
 *    την είσοδό του χωρίς κανένα migration βήμα.
 *  - Status/InactiveDate: ξεχωριστό, ήδη υπαρκτό toggle μέσω setEmployeeStatus().
 *  - Τα 3 τρίδυμα συνημμένων (Cv/Id/ResidencePermit *FileKey/Name/Type):
 *    ξεχωριστή ροή upload στην κάρτα «Έγγραφα» του ίδιου tab, δεν αγγίζονται
 *    εδώ ώστε ένα save στοιχείων να μην μπορεί ποτέ να σβήσει κατά λάθος ένα
 *    ήδη ανεβασμένο αρχείο.
 * Ίδιο μοτίβο merge-existing με updateVehicle() (src/fleet.js): κάθε πεδίο
 * `undefined` στο updates σημαίνει «άφησέ το όπως ήταν», όχι «καθάρισέ το».
 */
export async function updateTechnicianRecord(env, employeeId, updates, updatedBy) {
  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  const existing = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  if (!existing) throw new Error("Ο τεχνικός δεν βρέθηκε.");

  const name = updates.name !== undefined ? String(updates.name).trim() : existing.Name;
  if (!name) throw new Error("Χρειάζεται ονοματεπώνυμο.");

  const teamLeaderEmail = updates.teamLeaderEmail !== undefined ? updates.teamLeaderEmail : existing.TeamLeaderEmail;
  if (!teamLeaderEmail) throw new Error("Χρειάζεται Team Leader.");
  const leader = await getTeamLeaderByEmail(env, teamLeaderEmail);
  const director = leader ? null : await getDirectorByEmail(env, teamLeaderEmail);
  if (!leader && !director) throw new Error("Άγνωστος Team Leader.");

  const merged = {
    EmployeeID: existing.EmployeeID,
    Name: name,
    Email: updates.email !== undefined ? updates.email : existing.Email,
    TeamLeaderEmail: teamLeaderEmail,
    AnnualDays: updates.annualDays !== undefined && updates.annualDays !== "" ? Number(updates.annualDays) : (existing.AnnualDays || 22),
    Team: updates.team !== undefined ? updates.team : existing.Team,
    HasDrivingLicense: updates.hasDrivingLicense !== undefined ? (updates.hasDrivingLicense ? "Ναι" : "Όχι") : existing.HasDrivingLicense,
    AMA: updates.ama !== undefined ? updates.ama : existing.AMA,
    AMKA: updates.amka !== undefined ? updates.amka : existing.AMKA,
    AFM: updates.afm !== undefined ? updates.afm : existing.AFM,
    Phone: updates.phone !== undefined ? updates.phone : existing.Phone,
    Address: updates.address !== undefined ? updates.address : existing.Address,
    HireDate: updates.hireDate !== undefined ? updates.hireDate : existing.HireDate,
    TechnicalTraining: updates.technicalTraining !== undefined ? updates.technicalTraining : existing.TechnicalTraining,
    CvFileKey: existing.CvFileKey, CvFileName: existing.CvFileName, CvFileType: existing.CvFileType,
    IdFileKey: existing.IdFileKey, IdFileName: existing.IdFileName, IdFileType: existing.IdFileType,
    ResidencePermitFileKey: existing.ResidencePermitFileKey, ResidencePermitFileName: existing.ResidencePermitFileName, ResidencePermitFileType: existing.ResidencePermitFileType,
    CompanyPhone: updates.companyPhone !== undefined ? updates.companyPhone : existing.CompanyPhone,
    Status: existing.Status,
    InactiveDate: existing.InactiveDate,
    HuskiesUsername: updates.huskiesUsername !== undefined ? updates.huskiesUsername : existing.HuskiesUsername,
    HuskiesPassword: updates.huskiesPassword !== undefined ? updates.huskiesPassword : existing.HuskiesPassword,
    PriorExperience: updates.priorExperience !== undefined ? (updates.priorExperience === "" ? "" : Number(updates.priorExperience)) : existing.PriorExperience,
    FatherName: updates.fatherName !== undefined ? updates.fatherName : existing.FatherName,
    IdNumber: updates.idNumber !== undefined ? updates.idNumber : existing.IdNumber,
  };

  const values = EMPLOYEE_HEADER_ORDER.map((h) => (merged[h] !== undefined ? merged[h] : ""));
  await updateRow(env, SHEET_EMPLOYEES, existing._row, values);
  await appendAuditLog(env, "employee_updated", updatedBy, { employeeId: existing.EmployeeID, name: merged.Name });

  return merged;
}

/**
 * Ανέβασμα ενός από τα 3 συνημμένα τεχνικού (βιογραφικό/ταυτότητα-
 * διαβατήριο/άδεια διαμονής) — ρητή απαίτηση χρήστη. Ίδιο μοτίβο
 * αποθήκευσης με uploadLeaveAttachment (raw bytes σε Cloudflare KV, εκτός
 * Sheet, μόνο metadata εδώ) αλλά σε ξεχωριστό namespace `EMPLOYEE_FILES`.
 * `docType` ∈ {"cv","id","residence"} — βλ. EMPLOYEE_DOCUMENT_COLUMNS.
 * Καλείται ΜΕΤΑ τη δημιουργία του τεχνικού (χρειάζεται ήδη υπαρκτό
 * employeeId) — ίδιο δίβημα με το δικαιολογητικό αναρρωτικής άδειας, που
 * επίσης ανεβαίνει σε δεύτερο βήμα μετά την υποβολή της αίτησης.
 */
export async function uploadEmployeeDocument(env, { employeeId, docType, bytes, fileName, contentType }) {
  const cols = EMPLOYEE_DOCUMENT_COLUMNS[docType];
  if (!cols) throw new Error("Άγνωστος τύπος εγγράφου.");
  if (!EMPLOYEE_DOCUMENT_ALLOWED_TYPES[contentType]) {
    throw new Error("Επιτρέπεται μόνο PDF ή εικόνα (JPG/PNG).");
  }
  if (!env.EMPLOYEE_FILES) {
    throw new Error("Η αποθήκευση εγγράφων τεχνικού δεν είναι ρυθμισμένη (λείπει το KV binding EMPLOYEE_FILES).");
  }

  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  const row = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  if (!row) throw new Error("Ο τεχνικός δεν βρέθηκε.");

  const fileKey = `employee:${docType}:${crypto.randomUUID()}`;
  await env.EMPLOYEE_FILES.put(fileKey, bytes);

  const keyCol = EMPLOYEE_HEADER_ORDER.indexOf(cols.key) + 1;
  const nameCol = EMPLOYEE_HEADER_ORDER.indexOf(cols.name) + 1;
  const typeCol = EMPLOYEE_HEADER_ORDER.indexOf(cols.type) + 1;
  await updateCell(env, SHEET_EMPLOYEES, row._row, keyCol, fileKey);
  await updateCell(env, SHEET_EMPLOYEES, row._row, nameCol, fileName || `${cols.label}.pdf`);
  await updateCell(env, SHEET_EMPLOYEES, row._row, typeCol, contentType);

  return { success: true };
}

/**
 * Λήψη συνημμένου τεχνικού — ίδιο gate με το «Προφίλ Τεχνικού»
 * (requireTeamLeader στο src/index.js, δηλαδή TL+Director, ΟΧΙ Backoffice)
 * ελέγχεται ΕΚΕΙ, όχι εδώ (αυτή η function είναι internal, χωρίς δικό της
 * per-request auth check — mirror του getLeaveAttachmentByFileKey).
 */
export async function getEmployeeDocument(env, employeeId, docType) {
  const cols = EMPLOYEE_DOCUMENT_COLUMNS[docType];
  if (!cols || !env.EMPLOYEE_FILES) return null;

  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  const row = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  if (!row || !row[cols.key]) return null;

  const bytes = await env.EMPLOYEE_FILES.get(row[cols.key], "arrayBuffer");
  if (!bytes) return null;
  return { bytes, fileName: row[cols.name] || `${cols.label}.pdf`, contentType: row[cols.type] || "application/pdf" };
}

/**
 * Ημερομηνία Ορθόδοξου Πάσχα (Meeus Julian algorithm), σε Gregorian ημερομηνία.
 * Ισχύει για 1900-2099 (offset Julian->Gregorian = 13 ημέρες σε αυτό το διάστημα).
 */
function orthodoxEasterGregorian(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian;
}

/** Σύνολο ελληνικών επίσημων αργιών (YYYY-MM-DD strings) για συγκεκριμένο έτος */
function greekHolidaySet(year) {
  const easter = orthodoxEasterGregorian(year);
  const set = new Set();
  const add = (d) => set.add(d.toISOString().slice(0, 10));
  add(new Date(Date.UTC(year, 0, 1))); // Πρωτοχρονιά
  add(new Date(Date.UTC(year, 0, 6))); // Θεοφάνεια
  const cleanMonday = new Date(easter);
  cleanMonday.setUTCDate(easter.getUTCDate() - 48);
  add(cleanMonday); // Καθαρά Δευτέρα
  add(new Date(Date.UTC(year, 2, 25))); // 25η Μαρτίου
  const easterMonday = new Date(easter);
  easterMonday.setUTCDate(easter.getUTCDate() + 1);
  add(easterMonday); // Δευτέρα του Πάσχα
  add(new Date(Date.UTC(year, 4, 1))); // Εργατική Πρωτομαγιά
  const holySpirit = new Date(easter);
  holySpirit.setUTCDate(easter.getUTCDate() + 50);
  add(holySpirit); // Αγίου Πνεύματος
  add(new Date(Date.UTC(year, 7, 15))); // Κοίμηση Θεοτόκου
  add(new Date(Date.UTC(year, 9, 28))); // 28η Οκτωβρίου
  add(new Date(Date.UTC(year, 11, 25))); // Χριστούγεννα
  add(new Date(Date.UTC(year, 11, 26))); // Σύναξη Θεοτόκου
  return set;
}

/** Εργάσιμες ημέρες μεταξύ start/end (inclusive) — εξαιρεί Σάββατο/Κυριακή + ελληνικές επίσημες αργίες */
export function calculateWorkDays(start, end) {
  const d = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T00:00:00Z");
  if (isNaN(d) || isNaN(endDate) || endDate < d) return 0;

  let count = 0;
  const holidayCache = {};
  const cur = new Date(d);
  while (cur <= endDate) {
    const year = cur.getUTCFullYear();
    if (!holidayCache[year]) holidayCache[year] = greekHolidaySet(year);
    const dow = cur.getUTCDay();
    const iso = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidayCache[year].has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * Προσαύξηση αδειών για υπαλλήλους με λιγότερο από 1 έτος στην εταιρεία —
 * ρητή απαίτηση χρήστη (19/08/2026, αποφασίστηκε μέσω διευκρινιστικών
 * ερωτήσεων πριν την υλοποίηση): 1,7 ημέρες ανά συμπληρωμένο μήνα αντί για
 * το πλήρες ετήσιο δικαίωμα (`AnnualDays`), μέχρι να συμπληρωθεί 1 έτος —
 * τότε περνάει ΑΜΕΣΩΣ στο πλήρες ετήσιο (ρητή επιλογή χρήστη, ΟΧΙ προοδευτική
 * συνέχιση της προσαύξησης μετά το 1 έτος).
 * «Συμπληρωμένος μήνας» = απλοποιημένη διαφορά ΗΜΕΡΟΛΟΓΙΑΚΩΝ μηνών από την
 * HireDate (ρητή επιλογή χρήστη, όχι ακριβής μηνιαία επέτειος ημέρας) — π.χ.
 * πρόσληψη 30 Ιανουαρίου δίνει ήδη 1,7 ημέρες μόλις μπει ο Φεβρουάριος, όχι
 * μόνο στις 30 Φεβρουαρίου (αποδεκτή απλοποίηση, ρητά επιβεβαιωμένη).
 * Χωρίς καταχωρημένη HireDate (προαιρετικό πεδίο, πολλοί παλιοί τεχνικοί δεν
 * το έχουν συμπληρωμένο) γίνεται σιωπηλά fallback στο πλήρες `AnnualDays`
 * όπως πριν — ρητή απόφαση χρήστη, θα καταχωρήσει ο ίδιος χειροκίνητα το
 * σωστό υπόλοιπο για όσους δεν έχουν HireDate.
 */
function computeAccruedAnnualDays(emp) {
  const flatAnnual = Number(emp.AnnualDays || 0);
  const hireDate = emp.HireDate;
  if (!hireDate) return flatAnnual;

  const hire = new Date(hireDate + "T00:00:00Z");
  if (isNaN(hire)) return flatAnnual;

  const today = new Date();
  const monthsElapsed =
    (today.getUTCFullYear() - hire.getUTCFullYear()) * 12 + (today.getUTCMonth() - hire.getUTCMonth());

  if (monthsElapsed >= 12) return flatAnnual; // συμπλήρωσε 1 έτος -> πλήρες δικαίωμα αμέσως
  if (monthsElapsed <= 0) return 0; // μόλις προσλήφθηκε, κανένας συμπληρωμένος μήνας ακόμα

  // Στρογγυλοποίηση σε 1 δεκαδικό — αποφεύγει σφάλματα floating point
  // (π.χ. 1.7*3 χωρίς στρογγυλοποίηση βγαίνει 5.099999999999999) και ποτέ
  // δεν ξεπερνά το πλήρες ετήσιο δικαίωμα του υπαλλήλου (safety cap, για
  // την περίπτωση που κάποιος έχει καταχωρημένο AnnualDays μικρότερο από
  // την προσαύξηση 12 μηνών).
  const prorated = Math.round(monthsElapsed * 1.7 * 10) / 10;
  return Math.min(prorated, flatAnnual);
}

export async function getEmployeeBalance(env, employeeId) {
  // Παράλληλα, ανεξάρτητα reads — fix ταχύτητας 25/08/2026 (πολύ hot path:
  // «Οι Άδειές μου», Ημερολόγιο τεχνικού, Προφίλ Τεχνικού).
  const [emp, allLeavesRaw] = await Promise.all([
    getEmployeeById(env, employeeId),
    readLeavesRows(env),
  ]);
  if (!emp) throw new Error("Άγνωστος υπάλληλος");

  const allLeaves = allLeavesRaw.filter(
    (l) => String(l.EmployeeID) === String(employeeId)
  );
  // Τηλεργασία ΔΕΝ αφαιρείται από το ετήσιο υπόλοιπο — δεν είναι άδεια,
  // απλά μια εγκεκριμένη μέρα εργασίας από το σπίτι (ρητή απόφαση χρήστη).
  const usedDays = allLeaves
    .filter((l) => l.Status === "Εγκρίθηκε" && l.Type !== "Τηλεργασία")
    .reduce((sum, l) => sum + Number(l.Days || 0), 0);
  const pendingCount = allLeaves.filter((l) => l.Status === "Εκκρεμεί").length;

  const annualDays = computeAccruedAnnualDays(emp);

  return {
    employee: emp,
    annualDays,
    usedDays,
    remainingDays: annualDays - usedDays,
    pendingCount,
    // Κανονικοποίηση StartDate/EndDate σε ISO — βλ. src/dateutil.js (bug
    // garbled ημερομηνιών, 24/08/2026). Το `history` τροφοδοτεί το tab «Οι
    // Άδειές μου», το Ημερολόγιο τεχνικού (/api/calendar/my), και το
    // Προφίλ Τεχνικού.
    history: allLeaves
      .map((l) => ({ ...l, StartDate: normalizeSheetDate(l.StartDate), EndDate: normalizeSheetDate(l.EndDate) }))
      .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp)),
  };
}

/**
 * `autoApprove` (ρητή απαίτηση χρήστη, 15/08/2026): όταν η αίτηση καταχωρείται
 * από τον TL/Director εκ μέρους του τεχνικού (submitLeaveRequestAsLeader
 * παρακάτω περνάει πάντα true, ΓΙΑ ΟΛΟΥΣ τους τύπους) η ίδια η ενέργεια
 * καταχώρησης ΕΙΝΑΙ η απόφαση — Status="Εγκρίθηκε" απευθείας, καμία
 * ξεχωριστή "Προς έγκριση"/self-review βήμα. Όταν λείπει/false (self-
 * submission από τον ίδιο τον τεχνικό/staff, μέσω handleLeavesSubmit),
 * συμπεριφορά αμετάβλητη: Status="Εκκρεμεί", email στον εγκριτή.
 */
export async function submitLeaveRequest(env, { employeeId, type, startDate, endDate, note, enteredBy, autoApprove }) {
  const emp = await getEmployeeById(env, employeeId);
  if (!emp) throw new Error("Άγνωστος υπάλληλος");

  // Ο εγκριτής είναι κανονικά ο TL της self-row (TeamLeaderEmail). Για την
  // ΕΙΔΙΚΗ περίπτωση όπου ο αιτών είναι ο ίδιος ένας Team Leader, δεν υπάρχει
  // φυσικός εγκριτής μέσα στους TL — το TeamLeaderEmail της δικής του
  // self-row στο Υπάλληλοι δείχνει τότε σε έναν Director αντί για TL (βλ.
  // CLAUDE.md, "Ποιος εγκρίνει την άδεια ενός Team Leader"). Ίδιο πεδίο,
  // απλά fallback σε άλλο φύλλο όταν δεν βρεθεί TL.
  let approver = await getTeamLeaderByEmail(env, emp.TeamLeaderEmail);
  if (!approver) approver = await getDirectorByEmail(env, emp.TeamLeaderEmail);
  if (!approver) throw new Error("Δεν βρέθηκε εγκριτής (team leader ή Director) για τον υπάλληλο");

  // ΣΗΜΑΝΤΙΚΟ: calculateWorkDays() περιμένει strings (κάνει start + "T00:00:00Z"
  // εσωτερικά) — αν περάσει Date object εδώ, η συνένωση string παράγει άκυρη
  // ημερομηνία και η συνάρτηση επιστρέφει σιωπηλά 0. Περνάμε τα raw strings.
  const days = calculateWorkDays(startDate, endDate);

  // Μπλοκάρισμα υποβολής αν δεν επαρκεί το υπόλοιπο αδειών — ρητή απαίτηση
  // χρήστη. Εξαίρεση οι τύποι του LEAVE_TYPES_EXEMPT_FROM_BALANCE_CAP
  // παρακάτω (δεν "καταναλώνουν" πραγματικό υπόλοιπο — είτε γιατί δεν
  // πληρώνονται, είτε γιατί απαιτούν δικαιολογητικό, βλ. σχόλιο εκεί). Ίδιος
  // ορισμός remainingDays με αυτό που ήδη βλέπει ο τεχνικός στο tab «Οι
  // Άδειές μου» (getEmployeeBalance) — μόνο εγκεκριμένες μέρες μετράνε ως
  // "used", η Τηλεργασία εξαιρείται εκεί ήδη. Ισχύει ΚΑΙ όταν καταχωρεί ο TL
  // εκ μέρους τεχνικού (submitLeaveRequestAsLeader καλεί την ίδια συνάρτηση).
  if (!LEAVE_TYPES_EXEMPT_FROM_BALANCE_CAP.includes(type)) {
    const balance = await getEmployeeBalance(env, employeeId);
    if (days > balance.remainingDays) {
      throw new Error(
        `Δεν επαρκεί το υπόλοιπο αδειών (διαθέσιμες: ${balance.remainingDays}, ζητούμενες: ${days} εργάσιμες ημέρες).`
      );
    }
  }

  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    ID: requestId,
    Timestamp: now,
    EmployeeID: emp.EmployeeID,
    EmployeeName: emp.Name,
    TeamLeaderEmail: emp.TeamLeaderEmail,
    Type: type,
    StartDate: startDate,
    EndDate: endDate,
    Days: days,
    Note: note || "",
    Status: autoApprove ? "Εγκρίθηκε" : "Εκκρεμεί",
    DecisionDate: autoApprove ? now : "",
    DecisionNote: "",
    EnteredBy: enteredBy || emp.Email || "",
  };

  await appendRow(env, SHEET_LEAVES, row, LEAVES_HEADER_ORDER);
  await appendAuditLog(env, "leave_submitted", row.EnteredBy, {
    requestId,
    employeeId: emp.EmployeeID,
    days,
    status: row.Status,
    autoApproved: !!autoApprove,
  });

  const actorName = await resolveActorName(env, row.EnteredBy);
  const typeLabel = type === "Τηλεργασία" ? "τηλεργασίας" : "άδειας";

  if (autoApprove) {
    // Ο TL/Director κατέγραψε την άδεια εκ μέρους του τεχνικού — ήδη
    // εγκεκριμένη, ενημερώνεται απευθείας ο τεχνικός (αν έχει email), ίδιο
    // μοτίβο email με το "εγκρίθηκε" του decideLeaveRequest παρακάτω.
    if (emp.Email) {
      const emailResult = await sendEmail(env, {
        to: [emp.Email],
        subject: `Καταχωρήθηκε ${typeLabel} στο όνομά σου`,
        html: emailTemplate({
          badge: "Εγκρίθηκε",
          badgeColor: "green",
          title: `Καταχωρήθηκε ${typeLabel}`,
          intro: `Ο/Η <strong>${actorName || "team leader σου"}</strong> κατέγραψε ${typeLabel} στο όνομά σου — εγκεκριμένη αυτόματα.`,
          rows: [
            ["Τύπος", type],
            ["Από", startDate],
            ["Έως", endDate],
            ["Ημέρες", String(days)],
            ["Σημείωση", note || "—"],
          ],
          ctaText: "Οι άδειές μου",
          ctaUrl: `${PORTAL_URL}/hub`,
          footer: "Στο tab «Οι Άδειές μου» του Demo Portal.",
        }),
        replyTo: row.EnteredBy,
        replyToName: actorName,
      });
      await logEmailFailure(env, "leave_email_failed", row.EnteredBy, emailResult, { requestId, to: emp.Email });
    }
  } else {
    const actionsHtml = await decideLinksHtml(env, requestId, approver.Email);
    const ccBackup = await additionalRecipientsForAway(env, approver.Email);
    const emailResult = await sendEmail(env, {
      to: [approver.Email, ...ccBackup],
      subject: `Νέα αίτηση ${typeLabel}: ${emp.Name}`,
      html: emailTemplate({
        badge: "Νέα αίτηση",
        badgeColor: "blue",
        title: "Νέα αίτηση προς έγκριση",
        intro: `Ο/Η <strong>${emp.Name}</strong> υπέβαλε αίτηση ${typeLabel}.`,
        rows: [
          ["Τεχνικός", emp.Name],
          ["Τύπος", type],
          ["Από", startDate],
          ["Έως", endDate],
          ["Ημέρες", String(days)],
          ["Σημείωση", note || "—"],
        ],
        ctaText: "Έγκριση/απόρριψη",
        ctaUrl: `${PORTAL_URL}/hub`,
        actionsHtml,
        footer: "Στο tab «Άδειες Ομάδας» του Demo Portal.",
      }),
      replyTo: row.EnteredBy,
      replyToName: actorName,
    });
    await logEmailFailure(env, "leave_email_failed", row.EnteredBy, emailResult, { requestId, to: [approver.Email, ...ccBackup] });
  }

  return { success: true, requestId, days, status: row.Status };
}

/**
 * Ανέβασμα δικαιολογητικού (PDF) σε ΗΔΗ υποβληθείσα αίτηση τύπου
 * "Αναρρωτική" — ο τεχνικός/staff μπορεί να το κάνει οποιαδήποτε στιγμή
 * μετά την υποβολή (ρητή απόφαση χρήστη, όχι υποχρεωτικά τη στιγμή της
 * αίτησης). Ίδιο μοτίβο αποθήκευσης (raw bytes σε Cloudflare KV, εκτός
 * Sheet) με τα συνημμένα Ενημερώσεων (src/announcements.js), σε ξεχωριστό
 * namespace `LEAVE_FILES`. Στέλνει email στον TL της αίτησης μόλις ανέβει
 * (ρητή απαίτηση χρήστη) — ΚΑΙ στον backup του αν είναι ενεργό το "Λείπω"
 * (additionalRecipientsForAway), ίδιο fix με submitLeaveRequest/submitTeleworkRequest.
 *
 * ΕΠΕΚΤΑΘΗΚΕ (03/09/2026, ρητή απαίτηση χρήστη): πριν επιτρεπόταν ΜΟΝΟ στον
 * ίδιο τον αιτούντα (strict ισότητα employeeId) — τώρα επιτρέπεται ΚΑΙ στον
 * TL της συγκεκριμένης αίτησης (reuse isAuthorizedForTeam, ίδιος έλεγχος με
 * getLeaveAttachmentById/decideLeaveRequest — καλύπτει αυτόματα και backup
 * TL όσο διαρκεί το "Λείπω"), ώστε ο TL να μπορεί να ανεβάσει δικαιολογητικό
 * όταν καταχωρεί ο ίδιος αναρρωτική άδεια εκ μέρους τεχνικού. Backoffice ΔΕΝ
 * αποκτά πρόσβαση εδώ — ποτέ δεν είναι το `row.TeamLeaderEmail`.
 */
export async function uploadLeaveAttachment(env, { requestId, employeeId, staffEmail, bytes, fileName, contentType }) {
  if (!LEAVE_ATTACHMENT_ALLOWED_TYPES[contentType]) {
    throw new Error("Επιτρέπεται μόνο αρχείο PDF.");
  }
  if (!env.LEAVE_FILES) {
    throw new Error("Η αποθήκευση δικαιολογητικών δεν είναι ρυθμισμένη (λείπει το KV binding LEAVE_FILES).");
  }

  const allLeaves = await readLeavesRows(env);
  const row = allLeaves.find((l) => l.ID === requestId);
  if (!row) throw new Error("Η αίτηση δεν βρέθηκε.");

  const isOwner = employeeId && String(row.EmployeeID) === String(employeeId);
  const isTeamLeader = staffEmail ? await isAuthorizedForTeam(env, staffEmail, row.TeamLeaderEmail) : false;
  if (!isOwner && !isTeamLeader) {
    throw new Error("Δεν έχεις δικαίωμα να ανεβάσεις δικαιολογητικό σε αυτή την αίτηση.");
  }
  if (row.Type !== LEAVE_SICK_TYPE) {
    throw new Error("Δικαιολογητικό ανεβαίνει μόνο σε αιτήσεις τύπου Αναρρωτική.");
  }

  const fileKey = `leave:${crypto.randomUUID()}`;
  await env.LEAVE_FILES.put(fileKey, bytes);

  const fileKeyCol = LEAVES_HEADER_ORDER.indexOf("FileKey") + 1;
  const fileNameCol = LEAVES_HEADER_ORDER.indexOf("FileName") + 1;
  const fileTypeCol = LEAVES_HEADER_ORDER.indexOf("FileType") + 1;
  await updateCell(env, SHEET_LEAVES, row._row, fileKeyCol, fileKey);
  await updateCell(env, SHEET_LEAVES, row._row, fileNameCol, fileName || "δικαιολογητικό.pdf");
  await updateCell(env, SHEET_LEAVES, row._row, fileTypeCol, contentType);

  const actor = staffEmail || row.EnteredBy || employeeId;
  await appendAuditLog(env, "leave_attachment_uploaded", actor, { requestId, employeeId: row.EmployeeID, uploadedByTeamLeader: !!staffEmail });

  // row.TeamLeaderEmail μπορεί να είναι είτε πραγματικός TL είτε Director
  // (αν ο ίδιος ο αιτών είναι Team Leader) — βλ. submitLeaveRequest.
  // Αν ο ΙΔΙΟΣ ο TL/Director έκανε το ανέβασμα (staffEmail === approver.Email),
  // παραλείπεται η ειδοποίηση — δεν έχει νόημα να ενημερωθεί για κάτι που
  // μόλις έκανε ο ίδιος (η email ειδοποίηση υπήρχε αρχικά μόνο για την
  // περίπτωση που ανεβάζει ο τεχνικός).
  const approver = (await getTeamLeaderByEmail(env, row.TeamLeaderEmail)) || (await getDirectorByEmail(env, row.TeamLeaderEmail));
  if (approver && approver.Email !== staffEmail) {
    const ccBackup = await additionalRecipientsForAway(env, approver.Email);
    const emailResult = await sendEmail(env, {
      to: [approver.Email, ...ccBackup],
      subject: `Δικαιολογητικό αναρρωτικής: ${row.EmployeeName}`,
      html: emailTemplate({
        badge: "Δικαιολογητικό",
        badgeColor: "blue",
        title: "Ανέβηκε δικαιολογητικό αναρρωτικής άδειας",
        intro: `Ο/Η <strong>${row.EmployeeName}</strong> ανέβασε PDF δικαιολογητικό για την αίτηση αναρρωτικής άδειας.`,
        rows: [
          ["Τεχνικός", row.EmployeeName],
          ["Από", formatSheetDateEl(row.StartDate)],
          ["Έως", formatSheetDateEl(row.EndDate)],
        ],
        ctaText: "Προβολή στο portal",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Στο tab «Άδειες Ομάδας» του Demo Portal.",
      }),
    });
    await logEmailFailure(env, "leave_attachment_email_failed", actor, emailResult, { requestId, to: [approver.Email, ...ccBackup] });
  }

  return { success: true };
}

/**
 * Λήψη δικαιολογητικού μιας αίτησης — επιτρέπεται στον ίδιο τον τεχνικό
 * (employeeId ίδιο με της αίτησης) ή στον TL της αίτησης (teamLeaderEmail) —
 * ΚΑΙ στον backup του TL όσο εκείνος έχει ενεργό το "Λείπω" (reuse
 * isAuthorizedForTeam, ίδιος έλεγχος με decideLeaveRequest — έκλεισε το
 * γνωστό κενό, πριν δούλευε μόνο με strict ισότητα email). Backoffice ΔΕΝ
 * έχει πρόσβαση εδώ — συνεπές με την απόφαση #1 του CLAUDE.md (Backoffice
 * δεν βλέπει λεπτομέρειες αδειών).
 */
export async function getLeaveAttachmentById(env, id, { employeeId, staffEmail } = {}) {
  const allLeaves = await readLeavesRows(env);
  const row = allLeaves.find((l) => l.ID === id);
  if (!row || !row.FileKey) return null;

  const isOwner = employeeId && String(row.EmployeeID) === String(employeeId);
  const isTeamLeader = staffEmail ? await isAuthorizedForTeam(env, staffEmail, row.TeamLeaderEmail) : false;
  if (!isOwner && !isTeamLeader) return null;

  const bytes = await env.LEAVE_FILES.get(row.FileKey, "arrayBuffer");
  if (!bytes) return null;
  return { bytes, fileName: row.FileName || "δικαιολογητικό.pdf", contentType: row.FileType || "application/pdf" };
}

/**
 * Απευθείας ανάκτηση δικαιολογητικού by FileKey — ΧΩΡΙΣ per-request
 * εξουσιοδότηση owner/TL (σε αντίθεση με getLeaveAttachmentById παραπάνω).
 * ΜΟΝΟ για εσωτερική χρήση συστήματος, όχι εκτεθειμένο σε κανένα HTTP
 * endpoint — τη χρησιμοποιεί η μηνιαία αναφορά λογιστή (src/reports.js) για
 * να επισυνάψει αυτόματα τα δικαιολογητικά αναρρωτικής άδειας στο email.
 */
export async function getLeaveAttachmentByFileKey(env, fileKey) {
  if (!fileKey || !env.LEAVE_FILES) return null;
  return env.LEAVE_FILES.get(fileKey, "arrayBuffer");
}

/** Απλή αναζήτηση αίτησης by ID — για τη σελίδα επιβεβαίωσης του one-click decide-link (βλ. src/index.js) */
export async function getLeaveRequestById(env, id) {
  const allLeaves = await readLeavesRows(env);
  return allLeaves.find((l) => l.ID === id) || null;
}

/**
 * Όλες οι γραμμές μιας ομαδικής υποβολής τηλεργασίας (κοινό GroupID) — για
 * τη σελίδα επιβεβαίωσης ΚΑΙ την οριστικοποίηση του ομαδικού one-click
 * decide-link (βλ. src/index.js, decideLinksHtmlGroup παραπάνω). Ίδιο μοτίβο
 * με getLeaveRequestById, αλλά επιστρέφει array.
 */
export async function getLeaveRequestsByGroupId(env, groupId) {
  const allLeaves = await readLeavesRows(env);
  return allLeaves.filter((l) => l.GroupID === groupId);
}

/**
 * Τηλεργασία — μόνο Backoffice (ελέγχεται στο index.js). Ο χρήστης δηλώνει
 * πολλαπλές ΜΗ συνεχόμενες ημέρες (π.χ. στην αρχή του μήνα), όχι εύρος.
 * Ίδιο μοτίβο με submitLeaveRequest, ΑΛΛΑ γράφει ΜΙΑ γραμμή στο Άδειες ανά
 * επιλεγμένη ημέρα (StartDate=EndDate=η ίδια μέρα, Type="Τηλεργασία") —
 * μηδενική αλλαγή στο σχήμα του φύλλου, reuse 100% του υπάρχοντος
 * ημερολογίου/έγκρισης. Οι μέρες αυτές ΔΕΝ αφαιρούνται από το ετήσιο
 * υπόλοιπο αδειών (βλ. getEmployeeBalance/getTeamLeaderData).
 */
export async function submitTeleworkRequest(env, { employeeId, dates, note, enteredBy }) {
  const emp = await getEmployeeById(env, employeeId);
  if (!emp) throw new Error("Άγνωστος υπάλληλος");

  // Ίδιο fallback σε Director με το submitLeaveRequest — π.χ. αν κάποτε ένας
  // Director δηλώσει ο ίδιος τηλεργασία (η δήλωση παραμένει Backoffice-only
  // στο index.js, αλλά ένας Director περνάει επίσης το requireBackoffice gate).
  let approver = await getTeamLeaderByEmail(env, emp.TeamLeaderEmail);
  if (!approver) approver = await getDirectorByEmail(env, emp.TeamLeaderEmail);
  if (!approver) throw new Error("Δεν βρέθηκε εγκριτής (team leader ή Director) για τον υπάλληλο");

  const uniqueDates = Array.from(new Set((Array.isArray(dates) ? dates : []).filter(Boolean))).sort();
  if (!uniqueDates.length) throw new Error("Επίλεξε τουλάχιστον μία ημερομηνία.");

  // Κοινό GroupID για ΟΛΕΣ τις ημέρες αυτής της υποβολής — επιτρέπει στον TL
  // να τις εγκρίνει/απορρίψει ΟΛΕΣ μαζί με μία ενέργεια αντί για μία ανά
  // ημέρα (ρητή απαίτηση χρήστη, βλ. decideLeaveRequestGroup παρακάτω).
  const groupId = crypto.randomUUID();
  const requestIds = [];
  for (const date of uniqueDates) {
    const requestId = crypto.randomUUID();
    const row = {
      ID: requestId,
      Timestamp: new Date().toISOString(),
      EmployeeID: emp.EmployeeID,
      EmployeeName: emp.Name,
      TeamLeaderEmail: emp.TeamLeaderEmail,
      Type: "Τηλεργασία",
      StartDate: date,
      EndDate: date,
      Days: 1,
      Note: note || "",
      Status: "Εκκρεμεί",
      DecisionDate: "",
      DecisionNote: "",
      EnteredBy: enteredBy || emp.Email || "",
      GroupID: groupId,
    };
    await appendRow(env, SHEET_LEAVES, row, LEAVES_HEADER_ORDER);
    requestIds.push(requestId);
  }
  await appendAuditLog(env, "telework_submitted", enteredBy, { employeeId: emp.EmployeeID, dates: uniqueDates, groupId });

  const actorName = await resolveActorName(env, enteredBy);
  // One-click links: ΜΙΑ ημέρα (= ένα requestId) -> ίδιο single-request token
  // με τις κανονικές άδειες (decideLinksHtml). Πολλαπλές μη-συνεχόμενες
  // ημέρες -> group token (decideLinksHtmlGroup, type "leave-decide-group")
  // που αποφασίζει ΟΛΕΣ τις ημέρες της υποβολής μαζί μέσω
  // decideLeaveRequestGroup() — έκλεισε το γνωστό κενό, πριν έμενε μόνο το
  // κανονικό CTA προς login σε αυτή την περίπτωση.
  const actionsHtml = requestIds.length === 1
    ? await decideLinksHtml(env, requestIds[0], approver.Email)
    : await decideLinksHtmlGroup(env, groupId, approver.Email);
  const ccBackup = await additionalRecipientsForAway(env, approver.Email);
  const emailResult = await sendEmail(env, {
    to: [approver.Email, ...ccBackup],
    subject: `Νέα αίτηση τηλεργασίας: ${emp.Name}`,
    html: emailTemplate({
      badge: "Νέα αίτηση",
      badgeColor: "blue",
      title: "Νέα αίτηση προς έγκριση",
      intro: `Ο/Η <strong>${emp.Name}</strong> δήλωσε ${uniqueDates.length} ${uniqueDates.length === 1 ? "ημέρα" : "ημέρες"} τηλεργασίας.`,
      rows: [
        ["Τεχνικός", emp.Name],
        ["Ημερομηνίες", uniqueDates.join(", ")],
        ["Σημείωση", note || "—"],
      ],
      ctaText: "Έγκριση/απόρριψη",
      ctaUrl: `${PORTAL_URL}/hub`,
      actionsHtml,
      footer: "Στο tab «Άδειες Ομάδας» του Demo Portal.",
    }),
    replyTo: enteredBy,
    replyToName: actorName,
  });

  // Αρχικά διαγνωστική καταγραφή μόνο για τηλεργασία (item #4, 13/08/2026) —
  // γενικεύτηκε πλέον σε logEmailFailure() (src/email.js) που καλύπτει ΟΛΑ
  // τα σημεία αποστολής email του portal, όχι μόνο εδώ. Κρατάμε το επιπλέον
  // πεδίο teamLeaderEmailOnSelfRow — ήταν ο λόγος που εντοπίστηκε αρχικά το
  // σενάριο "κενό approver.Email" σε αυτή τη ροή.
  await logEmailFailure(env, "telework_email_failed", enteredBy, emailResult, {
    groupId,
    to: [approver.Email, ...ccBackup].filter(Boolean),
    teamLeaderEmailOnSelfRow: emp.TeamLeaderEmail,
  });

  return { success: true, count: requestIds.length, requestIds };
}

/**
 * Backup TL ανά τεχνικό — απόφαση χρήστη: ενεργός ΜΟΝΟ όταν λείπει ο κύριος
 * TL (χειροκίνητο toggle "Λείπω", όχι πάντα ενεργός). Στήλες `BackupEmail` +
 * `Away` στο φύλλο `TeamLeaders` (χειροκίνητη προσθήκη, βλ. SETUP.md).
 * Αν λείπουν οι στήλες, isAuthorizedForTeam() απλά δεν βρίσκει backup -> no-op, ασφαλές.
 */
async function isAuthorizedForTeam(env, actingEmail, ownerEmail) {
  if (actingEmail === ownerEmail) return true;
  const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
  const owner = leaders.find((l) => l.Email === ownerEmail);
  if (!owner) return false;
  return owner.BackupEmail === actingEmail && String(owner.Away || "").trim().toUpperCase() === "TRUE";
}

/**
 * Επιπλέον παραλήπτης ειδοποίησης όταν ο κύριος TL έχει ενεργό "Λείπω" —
 * ΠΡΟΣΘΕΤΕΙ τον backup στους παραλήπτες, ΔΕΝ αντικαθιστά τον κύριο TL (ο
 * κύριος μπορεί ακόμα να ελέγχει το email του περιστασιακά). Κλείνει το
 * γνωστό κενό "ο backup δεν ειδοποιείται όταν υποβάλλεται αίτηση/ανεβαίνει
 * δικαιολογητικό ενώ καλύπτει" — ίδιο query pattern με isAuthorizedForTeam.
 * Χρησιμοποιείται στο submitLeaveRequest, submitTeleworkRequest, και
 * uploadLeaveAttachment παρακάτω. Ασφαλές fallback: [] αν δεν υπάρχει
 * BackupEmail/Away column ή δεν είναι ενεργό.
 */
async function additionalRecipientsForAway(env, approverEmail) {
  const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
  const leader = leaders.find((l) => l.Email === approverEmail);
  if (leader && leader.BackupEmail && String(leader.Away || "").trim().toUpperCase() === "TRUE") {
    return [leader.BackupEmail];
  }
  return [];
}

/**
 * Ενεργοποιεί/απενεργοποιεί το "λείπω" toggle ενός TL — μόνο για τον εαυτό του.
 * Όταν away=true, ο TL επιλέγει ΤΗ ΣΤΙΓΜΗ ΕΚΕΙΝΗ (dropdown στο UI) ποιος άλλος
 * TL θα τον αντικαταστήσει — γράφεται στο backupEmail, ΔΕΝ είναι fixed
 * ανάθεση προρυθμισμένη στο Sheet.
 */
export async function setLeaderAway(env, leaderEmail, away, backupEmail) {
  const leaders = await readSheetAsObjects(env, SHEET_TEAMLEADERS);
  const leader = leaders.find((l) => l.Email === leaderEmail);
  if (!leader) throw new Error("Ο λογαριασμός σου δεν είναι καταχωρημένος ως Team Leader.");

  const headers = await getHeaderRow(env, SHEET_TEAMLEADERS);
  const awayCol = headers.indexOf("Away") + 1;
  if (awayCol <= 0) {
    throw new Error("Λείπει η στήλη 'Away' στο φύλλο TeamLeaders — χρειάζεται χειροκίνητη προσθήκη (βλ. SETUP.md).");
  }

  let backupLeader = null;
  if (away) {
    if (!backupEmail) throw new Error("Επίλεξε ποιος θα σε αντικαταστήσει.");
    if (backupEmail === leaderEmail) throw new Error("Δεν μπορείς να επιλέξεις τον εαυτό σου ως αντικαταστάτη.");
    backupLeader = leaders.find((l) => l.Email === backupEmail);
    if (!backupLeader) throw new Error("Άγνωστος Team Leader.");

    const backupCol = headers.indexOf("BackupEmail") + 1;
    if (backupCol <= 0) {
      throw new Error("Λείπει η στήλη 'BackupEmail' στο φύλλο TeamLeaders — χρειάζεται χειροκίνητη προσθήκη (βλ. SETUP.md).");
    }
    await updateCell(env, SHEET_TEAMLEADERS, leader._row, backupCol, backupEmail);
  }

  await updateCell(env, SHEET_TEAMLEADERS, leader._row, awayCol, away ? "TRUE" : "FALSE");
  await appendAuditLog(env, "leader_away_toggle", leaderEmail, { away: !!away, backupEmail: away ? backupEmail : undefined });

  // Ενημέρωση backup TL τη ΣΤΙΓΜΗ που ενεργοποιείται το "Λείπω" (ρητή
  // απαίτηση χρήστη) — ξεχωριστό από το CC που ήδη παίρνει σε emails νέων
  // αιτήσεων/δικαιολογητικών όσο διαρκεί η κάλυψη (additionalRecipientsForAway).
  // Σιωπηλό no-op αν ο backup δεν έχει καταχωρημένο email.
  if (away && backupLeader && backupLeader.Email) {
    const actorName = await resolveActorName(env, leaderEmail);
    const emailResult = await sendEmail(env, {
      to: [backupLeader.Email],
      subject: `Ανέλαβες κάλυψη ομάδας — ${leader.Name || leaderEmail} λείπει`,
      html: emailTemplate({
        badge: "Κάλυψη ομάδας",
        badgeColor: "blue",
        title: "Καλύπτεις την ομάδα ενός συναδέλφου",
        intro: `Ο/Η <strong>${leader.Name || leaderEmail}</strong> ενεργοποίησε "Λείπω" και σε όρισε ως αντικαταστάτη. Μέχρι να επιστρέψει, θα βλέπεις την ομάδα του στο tab «Άδειες Ομάδας» και θα ενημερώνεσαι για νέες αιτήσεις/δικαιολογητικά της ομάδας του.`,
        rows: [["Team Leader", leader.Name || leaderEmail]],
        ctaText: "Άδειες Ομάδας",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Η κάλυψη σταματάει αυτόματα μόλις επιστρέψει και απενεργοποιήσει το \"Λείπω\".",
      }),
      replyTo: leaderEmail,
      replyToName: actorName,
    });
    await logEmailFailure(env, "leader_away_email_failed", leaderEmail, emailResult, { to: backupLeader.Email });
  }

  // Αντίστροφη ειδοποίηση όταν ο κύριος TL ΓΥΡΙΖΕΙ (away: true -> false,
  // ρητή απαίτηση χρήστη) — στον backup που τον κάλυπτε, ώστε να ξέρει ότι η
  // κάλυψή του τελείωσε. `leader.Away`/`leader.BackupEmail` εδώ είναι η ΠΡΙΝ
  // την αλλαγή τιμή (από το `leaders` που διαβάστηκε στην αρχή) — το
  // BackupEmail στο Sheet ΔΕΝ καθαρίζεται όταν κλείνει το "Λείπω" (μένει σαν
  // ιστορικό/προεπιλογή για την επόμενη φορά), άρα δείχνει ακριβώς ποιος
  // κάλυπτε μέχρι τώρα. Καμία ειδοποίηση αν δεν ήταν ήδη "Λείπω" (καμία
  // πραγματική αλλαγή) ή αν δεν υπάρχει καταχωρημένος backup/email.
  if (!away && String(leader.Away || "").trim().toUpperCase() === "TRUE" && leader.BackupEmail) {
    const priorBackup = leaders.find((l) => l.Email === leader.BackupEmail);
    if (priorBackup && priorBackup.Email) {
      const actorName = await resolveActorName(env, leaderEmail);
      const emailResult = await sendEmail(env, {
        to: [priorBackup.Email],
        subject: `Η κάλυψη ολοκληρώθηκε — ${leader.Name || leaderEmail} επέστρεψε`,
        html: emailTemplate({
          badge: "Κάλυψη ολοκληρώθηκε",
          badgeColor: "green",
          title: "Ο συνάδελφος επέστρεψε",
          intro: `Ο/Η <strong>${leader.Name || leaderEmail}</strong> απενεργοποίησε το "Λείπω" — η κάλυψη που έκανες για την ομάδα του σταμάτησε, ευχαριστούμε!`,
          rows: [["Team Leader", leader.Name || leaderEmail]],
          ctaText: "Portal",
          ctaUrl: `${PORTAL_URL}/hub`,
        }),
        replyTo: leaderEmail,
        replyToName: actorName,
      });
      await logEmailFailure(env, "leader_away_email_failed", leaderEmail, emailResult, { to: priorBackup.Email });
    }
  }

  return { success: true, away: !!away };
}

export async function getTeamLeaderData(env, leaderEmail) {
  // Οι 3 αναγνώσεις φύλλων παρακάτω είναι ανεξάρτητες μεταξύ τους — καμία δεν
  // χρειάζεται το αποτέλεσμα κάποιας άλλης για να ξεκινήσει το δικό της
  // Sheets API call, το φιλτράρισμα (coveredEmails/employeeIds) γίνεται ΜΕΤΑ
  // στη μνήμη. Τρέχουν πλέον παράλληλα (Promise.all) αντί διαδοχικά — fix
  // ταχύτητας (25/08/2026, ρητό αίτημα χρήστη "πιο γρήγορο portal"), καμία
  // αλλαγή στη λογική/αποτέλεσμα.
  const [allLeaders, allEmployees, allLeavesRaw] = await Promise.all([
    readSheetAsObjects(env, SHEET_TEAMLEADERS),
    readSheetAsObjects(env, SHEET_EMPLOYEES),
    readLeavesRows(env),
  ]);

  const me = allLeaders.find((l) => l.Email === leaderEmail);
  const isAway = me ? String(me.Away || "").trim().toUpperCase() === "TRUE" : false;

  // Ομάδες που ο τρέχων χρήστης βλέπει: η δική του + όσων TL είναι ορισμένος
  // backup ΚΑΙ αυτοί έχουν ενεργοποιήσει το "Λείπω" toggle.
  const backupFor = allLeaders.filter(
    (l) => l.BackupEmail === leaderEmail && String(l.Away || "").trim().toUpperCase() === "TRUE"
  );
  const coveredEmails = [leaderEmail, ...backupFor.map((l) => l.Email)];

  // Λίστα λοιπών TL για το dropdown επιλογής αντικαταστάτη στο UI ("Λείπω")
  const otherLeaders = allLeaders
    .filter((l) => l.Email && l.Email !== leaderEmail)
    .map((l) => ({ Email: l.Email, Name: l.Name || l.Email }));
  const myBackup = me && me.BackupEmail ? allLeaders.find((l) => l.Email === me.BackupEmail) : null;

  const employees = allEmployees.filter((e) => coveredEmails.includes(e.TeamLeaderEmail));
  const employeeIds = employees.map((e) => String(e.EmployeeID));
  // Κανονικοποίηση StartDate/EndDate σε ISO ΑΜΕΣΩΣ μετά την ανάγνωση — βλ.
  // src/dateutil.js (bug garbled ημερομηνιών, 24/08/2026). Τροφοδοτεί
  // pending/decided (πίνακας «Αιτήσεις άδειας» στο hub.html) ΚΑΙ
  // calendarLeaves παρακάτω.
  const allLeaves = allLeavesRaw
    .filter((l) => employeeIds.includes(String(l.EmployeeID)))
    .map((l) => ({ ...l, StartDate: normalizeSheetDate(l.StartDate), EndDate: normalizeSheetDate(l.EndDate) }));

  const pending = allLeaves.filter((l) => l.Status === "Εκκρεμεί");
  const decided = allLeaves
    .filter((l) => l.Status !== "Εκκρεμεί")
    .sort((a, b) => new Date(b.DecisionDate) - new Date(a.DecisionDate))
    .slice(0, 15);

  // Για το ημερολόγιο αδειών ομάδας (οπτική εικόνα μήνα): όλες οι εγκεκριμένες
  // + εκκρεμείς αιτήσεις (όχι απορριφθείσες), ώστε ο TL να βλέπει ποιος λείπει
  // πότε και να αποφεύγει επικαλύψεις στο ίδιο συνεργείο. Καμία περικοπή σε
  // αριθμό εγγραφών εδώ (σε αντίθεση με το `decided`) — το UI φιλτράρει ανά μήνα.
  const calendarLeaves = allLeaves
    .filter((l) => l.Status === "Εγκρίθηκε" || l.Status === "Εκκρεμεί")
    .map((l) => ({
      EmployeeName: l.EmployeeName,
      Type: l.Type,
      // Κανονικοποίηση σε ISO — βλ. src/dateutil.js (bug garbled ημερομηνιών,
      // 24/08/2026). Τροφοδοτεί ΚΑΙ το ημερολόγιο αδειών ομάδας (hub.html)
      // ΚΑΙ το leavesInRange() των weekly/monthly TL reports (reports.js).
      StartDate: normalizeSheetDate(l.StartDate),
      EndDate: normalizeSheetDate(l.EndDate),
      Status: l.Status,
    }));

  const daysPerEmployee = employees.map((emp) => {
    // Τηλεργασία εξαιρείται εδώ επίσης — ίδια λογική με getEmployeeBalance.
    const used = allLeaves
      .filter(
        (l) => String(l.EmployeeID) === String(emp.EmployeeID) && l.Status === "Εγκρίθηκε" && l.Type !== "Τηλεργασία"
      )
      .reduce((sum, l) => sum + Number(l.Days || 0), 0);
    return { name: emp.Name, days: used };
  });

  return {
    team: employees,
    pending,
    decided,
    calendarLeaves,
    daysPerEmployee,
    pendingCount: pending.length,
    isAway,
    backupFor: backupFor.map((l) => l.Name || l.Email),
    otherLeaders,
    myBackupName: myBackup ? (myBackup.Name || myBackup.Email) : null,
  };
}

/** Καταχώρηση αίτησης εκ μέρους τεχνικού — ο ανατεθειμένος TL του, ή ο backup του όσο εκείνος λείπει */
export async function submitLeaveRequestAsLeader(env, leaderEmail, data) {
  const emp = await getEmployeeById(env, data.employeeId);
  if (!emp) throw new Error("Άγνωστος υπάλληλος.");
  const authorized = await isAuthorizedForTeam(env, leaderEmail, emp.TeamLeaderEmail);
  if (!authorized) throw new Error("Ο τεχνικός δεν ανήκει στην ομάδα σου.");
  // autoApprove: ΠΑΝΤΑ true εδώ (ρητή απαίτηση χρήστη, ΓΙΑ ΟΛΟΥΣ τους τύπους)
  // — βλ. σχόλιο στο submitLeaveRequest παραπάνω.
  return submitLeaveRequest(env, { ...data, enteredBy: leaderEmail, autoApprove: true });
}

/**
 * Μαζική καταχώρηση άδειας σε ΟΛΟΥΣ τους ενεργούς υπαλλήλους (τεχνικοί + TL +
 * Backoffice + Director self-rows) ταυτόχρονα — ρητή απαίτηση χρήστη
 * (19/08/2026), π.χ. για εταιρικές διακοπές/διακοπή λειτουργίας. Αυστηρά
 * Director-only (gate στο index.js, requireDirector).
 *
 * Reuse 100% του submitLeaveRequest() ανά υπάλληλο, autoApprove πάντα true
 * (ίδια λογική με submitLeaveRequestAsLeader — η ίδια η μαζική καταχώρηση
 * από τον Director ΕΙΝΑΙ η απόφαση, καμία ενδιάμεση «Προς έγκριση»). Καμία
 * ειδική εξαίρεση από το μπλοκάρισμα υπολοίπου (LEAVE_TYPES_EXEMPT_FROM_
 * BALANCE_CAP ισχύει κανονικά ανά τύπο, όπως παντού) — αν κάποιος υπάλληλος
 * δεν έχει αρκετό υπόλοιπο, ΜΟΝΟ η δική του καταχώρηση αποτυγχάνει (καταγράφεται
 * στο failures[]), όλοι οι υπόλοιποι προχωράνε κανονικά. Εξαιρούνται οι
 * Ανενεργοί υπάλληλοι (`Status === "Ανενεργός"`).
 */
export async function submitBulkLeave(env, { type, startDate, endDate, note, enteredBy }) {
  const employees = (await readSheetAsObjects(env, SHEET_EMPLOYEES)).filter(
    (e) => e.EmployeeID && e.Status !== "Ανενεργός"
  );

  const results = { total: employees.length, success: 0, failed: [] };
  for (const emp of employees) {
    try {
      await submitLeaveRequest(env, {
        employeeId: emp.EmployeeID,
        type,
        startDate,
        endDate,
        note,
        enteredBy,
        autoApprove: true,
      });
      results.success++;
    } catch (err) {
      results.failed.push({ employeeId: emp.EmployeeID, name: emp.Name, reason: err.message || String(err) });
    }
  }

  await appendAuditLog(env, "bulk_leave_created", enteredBy, {
    type,
    startDate,
    endDate,
    total: results.total,
    success: results.success,
    failedCount: results.failed.length,
  });

  return results;
}

/** Έγκριση/απόρριψη αίτησης, με βασικό race-condition guard (re-check πριν το write) */
export async function decideLeaveRequest(env, leaderEmail, requestId, decision, decisionNote) {
  const allLeaves = await readLeavesRows(env);
  const request = allLeaves.find((l) => l.ID === requestId);
  if (!request) throw new Error("Η αίτηση δεν βρέθηκε");
  const authorized = await isAuthorizedForTeam(env, leaderEmail, request.TeamLeaderEmail);
  if (!authorized) {
    throw new Error("Δεν έχεις δικαίωμα να αποφασίσεις για αυτή την αίτηση");
  }
  if (request.Status !== "Εκκρεμεί") throw new Error("Η αίτηση έχει ήδη απαντηθεί");

  const statusCol = LEAVES_HEADER_ORDER.indexOf("Status") + 1;
  const decisionDateCol = LEAVES_HEADER_ORDER.indexOf("DecisionDate") + 1;
  const decisionNoteCol = LEAVES_HEADER_ORDER.indexOf("DecisionNote") + 1;
  const sheetRow = request._row;

  // Re-check τρέχουσας τιμής αμέσως πριν το write, ως βασική προστασία race condition
  // (χωρίς πραγματικό distributed lock — αποδεκτό ρίσκο για την κλίμακα του συστήματος)
  const currentStatus = await readCell(env, SHEET_LEAVES, sheetRow, statusCol);
  if (currentStatus !== "Εκκρεμεί") throw new Error("Η αίτηση έχει ήδη απαντηθεί");

  const newStatus = decision === "approve" ? "Εγκρίθηκε" : "Απορρίφθηκε";
  await updateCell(env, SHEET_LEAVES, sheetRow, statusCol, newStatus);
  await updateCell(env, SHEET_LEAVES, sheetRow, decisionDateCol, new Date().toISOString());
  await updateCell(env, SHEET_LEAVES, sheetRow, decisionNoteCol, decisionNote || "");

  await appendAuditLog(env, "leave_decided", leaderEmail, { requestId, decision: newStatus });

  const emp = await getEmployeeById(env, request.EmployeeID);
  if (emp && emp.Email) {
    const approved = newStatus === "Εγκρίθηκε";
    const typeLabel = request.Type === "Τηλεργασία" ? "τηλεργασίας" : "άδειας";
    const actorName = await resolveActorName(env, leaderEmail);
    const emailResult = await sendEmail(env, {
      to: [emp.Email],
      subject: approved ? "Η αίτησή σου εγκρίθηκε" : "Η αίτησή σου απορρίφθηκε",
      html: emailTemplate({
        badge: newStatus,
        badgeColor: approved ? "green" : "red",
        title: approved ? "Η αίτησή σου εγκρίθηκε" : "Η αίτησή σου απορρίφθηκε",
        intro: `Η αίτηση ${typeLabel} σου ${approved ? "εγκρίθηκε" : "απορρίφθηκε"}.`,
        rows: [
          ["Τύπος", request.Type],
          ["Από", formatSheetDateEl(request.StartDate)],
          ["Έως", formatSheetDateEl(request.EndDate)],
          ["Κατάσταση", newStatus],
          ["Σχόλιο", decisionNote || "—"],
        ],
        ctaText: "Οι άδειές μου",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Στο tab «Οι Άδειές μου» του Demo Portal.",
      }),
      replyTo: leaderEmail,
      replyToName: actorName,
    });
    await logEmailFailure(env, "leave_decided_email_failed", leaderEmail, emailResult, { requestId, to: emp.Email });
  }

  return { success: true, status: newStatus };
}

/**
 * Ομαδική έγκριση/απόρριψη τηλεργασίας — αποφασίζει ΟΛΕΣ τις ημέρες μιας
 * υποβολής (κοινό GroupID, βλ. submitTeleworkRequest) με ΜΙΑ ενέργεια αντί
 * για ξεχωριστά ανά ημέρα (ρητή απαίτηση χρήστη). Ίδια εξουσιοδότηση με
 * decideLeaveRequest, εφαρμοσμένη σε κάθε γραμμή της ομάδας. Αποφασίζει μόνο
 * τις ΑΚΟΜΑ εκκρεμείς γραμμές (αγνοεί σιωπηλά όποια έχει ήδη απαντηθεί —
 * π.χ. διπλό κλικ) και στέλνει ΕΝΑ συγκεντρωτικό email στον τεχνικό αντί για
 * ένα ανά ημέρα.
 */
export async function decideLeaveRequestGroup(env, leaderEmail, groupId, decision, decisionNote) {
  const allLeaves = await readLeavesRows(env);
  const members = allLeaves.filter((l) => l.GroupID === groupId);
  if (!members.length) throw new Error("Δεν βρέθηκε η ομάδα αιτήσεων τηλεργασίας");

  const authorized = await isAuthorizedForTeam(env, leaderEmail, members[0].TeamLeaderEmail);
  if (!authorized) throw new Error("Δεν έχεις δικαίωμα να αποφασίσεις για αυτή την αίτηση");

  const pendingMembers = members.filter((l) => l.Status === "Εκκρεμεί");
  if (!pendingMembers.length) throw new Error("Η αίτηση έχει ήδη απαντηθεί");

  const statusCol = LEAVES_HEADER_ORDER.indexOf("Status") + 1;
  const decisionDateCol = LEAVES_HEADER_ORDER.indexOf("DecisionDate") + 1;
  const decisionNoteCol = LEAVES_HEADER_ORDER.indexOf("DecisionNote") + 1;
  const newStatus = decision === "approve" ? "Εγκρίθηκε" : "Απορρίφθηκε";
  const decisionDate = new Date().toISOString();

  const decidedMembers = [];
  for (const member of pendingMembers) {
    // Ίδιο re-check race-condition guard με decideLeaveRequest, ανά γραμμή.
    const currentStatus = await readCell(env, SHEET_LEAVES, member._row, statusCol);
    if (currentStatus !== "Εκκρεμεί") continue;
    await updateCell(env, SHEET_LEAVES, member._row, statusCol, newStatus);
    await updateCell(env, SHEET_LEAVES, member._row, decisionDateCol, decisionDate);
    await updateCell(env, SHEET_LEAVES, member._row, decisionNoteCol, decisionNote || "");
    decidedMembers.push(member);
  }

  await appendAuditLog(env, "leave_decided_group", leaderEmail, { groupId, decision: newStatus, count: decidedMembers.length });

  const emp = await getEmployeeById(env, members[0].EmployeeID);
  if (emp && emp.Email && decidedMembers.length) {
    const approved = newStatus === "Εγκρίθηκε";
    const actorName = await resolveActorName(env, leaderEmail);
    const dates = decidedMembers
      .map((m) => normalizeSheetDate(m.StartDate))
      .filter(Boolean)
      .sort()
      .map(formatSheetDateEl)
      .join(", ");
    const emailResult = await sendEmail(env, {
      to: [emp.Email],
      subject: approved ? "Η αίτηση τηλεργασίας σου εγκρίθηκε" : "Η αίτηση τηλεργασίας σου απορρίφθηκε",
      html: emailTemplate({
        badge: newStatus,
        badgeColor: approved ? "green" : "red",
        title: approved ? "Η αίτηση τηλεργασίας σου εγκρίθηκε" : "Η αίτηση τηλεργασίας σου απορρίφθηκε",
        intro: `Η αίτηση τηλεργασίας σου (${decidedMembers.length} ${decidedMembers.length === 1 ? "ημέρα" : "ημέρες"}) ${approved ? "εγκρίθηκε" : "απορρίφθηκε"}.`,
        rows: [
          ["Ημερομηνίες", dates],
          ["Κατάσταση", newStatus],
          ["Σχόλιο", decisionNote || "—"],
        ],
        ctaText: "Οι άδειές μου",
        ctaUrl: `${PORTAL_URL}/hub`,
        footer: "Στο tab «Οι Άδειές μου» του Demo Portal.",
      }),
      replyTo: leaderEmail,
      replyToName: actorName,
    });
    await logEmailFailure(env, "leave_decided_email_failed", leaderEmail, emailResult, { groupId, to: emp.Email });
  }

  return { success: true, status: newStatus, count: decidedMembers.length };
}

/**
 * Αναζήτηση όλων των αδειών (οποιαδήποτε κατάσταση) ενός συγκεκριμένου
 * τεχνικού εντός εύρους ημερομηνιών — για τον TL του (ή backup του, βλ.
 * isAuthorizedForTeam). ΔΕΝ περιορίζεται στις τελευταίες 15 όπως το
 * `decided` του getTeamLeaderData — σκοπός είναι πλήρες ιστορικό για export.
 */
export async function searchTeamLeaves(env, leaderEmail, { employeeId, startDate, endDate }) {
  const emp = await getEmployeeById(env, employeeId);
  if (!emp) throw new Error("Άγνωστος τεχνικός.");

  const authorized = await isAuthorizedForTeam(env, leaderEmail, emp.TeamLeaderEmail);
  if (!authorized) throw new Error("Ο τεχνικός δεν ανήκει στην ομάδα σου.");

  const allLeaves = (await readLeavesRows(env)).filter(
    (l) => String(l.EmployeeID) === String(employeeId)
  );

  // Κανονικοποίηση ΠΡΙΝ τη σύγκριση/ταξινόμηση — βλ. src/dateutil.js (bug
  // garbled ημερομηνιών, 24/08/2026): οι raw Sheet τιμές μπορεί να μην είναι
  // ήδη σε ISO μορφή.
  const normalized = allLeaves.map((l) => ({
    ...l,
    StartDate: normalizeSheetDate(l.StartDate),
    EndDate: normalizeSheetDate(l.EndDate),
  }));

  const filtered = normalized.filter((l) => {
    if (startDate && l.EndDate && l.EndDate < startDate) return false;
    if (endDate && l.StartDate && l.StartDate > endDate) return false;
    return true;
  });

  return filtered
    .sort((a, b) => String(b.StartDate || "").localeCompare(String(a.StartDate || "")))
    .map((l) => ({
      ID: l.ID,
      EmployeeName: l.EmployeeName,
      Type: l.Type,
      StartDate: l.StartDate,
      EndDate: l.EndDate,
      Days: l.Days,
      Status: l.Status,
      Note: l.Note,
      DecisionDate: l.DecisionDate,
    }));
}

/**
 * Διαγραφή άδειας — ρητή απαίτηση χρήστη (15/08/2026): ο TL/Director μπορεί
 * να διαγράψει ΟΠΟΙΑΔΗΠΟΤΕ άδεια της ομάδας του, ανεξαρτήτως κατάστασης
 * (Εκκρεμεί/Εγκρίθηκε/Απορρίφθηκε) — π.χ. διόρθωση λάθους καταχώρησης. Ίδιο
 * gate/authorization με decideLeaveRequest (isAuthorizedForTeam, καλύπτει
 * αυτόματα και backup TL όσο διαρκεί το "Λείπω"). Πραγματική διαγραφή
 * γραμμής (deleteRow), όχι soft-delete — ίδιο μοτίβο με deleteAnnouncement/
 * deleteAvailabilityQuery. Καμία ειδοποίηση email (δεν ζητήθηκε — η
 * διαγραφή είναι συνήθως διόρθωση λάθους καταχώρησης, όχι κάτι που πρέπει
 * να μάθει ο τεχνικός).
 */
export async function deleteLeaveRequest(env, leaderEmail, requestId) {
  const allLeaves = await readLeavesRows(env);
  const request = allLeaves.find((l) => l.ID === requestId);
  if (!request) throw new Error("Η αίτηση δεν βρέθηκε.");

  const authorized = await isAuthorizedForTeam(env, leaderEmail, request.TeamLeaderEmail);
  if (!authorized) throw new Error("Δεν έχεις δικαίωμα να διαγράψεις αυτή την αίτηση.");

  // Πλήρες snapshot της γραμμής (χωρίς το εσωτερικό _row) πριν τη διαγραφή —
  // η διαγραφή είναι μόνιμη (πραγματικό deleteRow, όχι soft-delete), άρα
  // αυτό το log είναι το ΜΟΝΟ ίχνος που απομένει αν χρειαστεί ποτέ να δει
  // κανείς τι ακριβώς διαγράφηκε (π.χ. λάθος διαγραφή). Πρόταση Claude,
  // αποδεκτή από χρήστη — δεν προσφέρει restore, μόνο ορατότητα στο
  // Ιστορικό Ενεργειών (Director-only).
  const { _row, ...snapshot } = request;
  await deleteRow(env, SHEET_LEAVES, request._row);
  await appendAuditLog(env, "leave_deleted", leaderEmail, {
    requestId,
    employeeId: request.EmployeeID,
    employeeName: request.EmployeeName,
    type: request.Type,
    status: request.Status,
    snapshot,
  });

  return { success: true };
}

/**
 * Ενιαίο «Προφίλ Τεχνικού» — σκέλος αδειών (βλ. src/index.js,
 * handleEmployeeProfile, που το συνδυάζει με getTechnicianHoldings του
 * src/assignments.js για το πλήρες προφίλ). Ρητή απαίτηση χρήστη: μια σελίδα
 * που δείχνει μαζί ό,τι σήμερα είναι σκόρπιο σε 3 σημεία (Εξοπλισμός →
 * αναζήτηση τεχνικού, Άδειες Ομάδας → αναζήτηση αδειών, Αξιολόγηση).
 * Εξουσιοδότηση (ΑΝΑΘΕΩΡΗΘΗΚΕ 15/08/2026, ρητή απαίτηση χρήστη — "ο TL να
 * επιλέγει ποια ομάδα θα βλέπει"): ΚΑΘΕ TL/Director βλέπει πλέον
 * ΟΠΟΙΟΝΔΗΠΟΤΕ τεχνικό, όχι μόνο τη δική του ομάδα — πριν ήταν TL-only
 * scoped στη δική του ομάδα (reuse isAuthorizedForTeam), Director πάντα
 * πλήρης εποπτεία. Λόγος αλλαγής: το Reset PIN (που ΔΕΝ είχε ΠΟΤΕ
 * περιορισμό ομάδας, βλ. handleResetPin στο index.js) μετακόμισε μέσα σε
 * αυτό το tab (βλ. Προφίλ Τεχνικού § Κατάσταση) — για να μη χαθεί αυτή η
 * δυνατότητα έπρεπε να ανοίξει και η ίδια η προβολή προφίλ σε όλους τους
 * τεχνικούς, όχι μόνο της δικής του ομάδας. Η ίδια συνάρτηση χρησιμοποιείται
 * ΜΟΝΟ από το handleEmployeeProfile — καμία επίπτωση αλλού.
 */
export async function getTechnicianLeaveProfile(env, viewerEmail, employeeId) {
  // Παράλληλα — fix ταχύτητας 25/08/2026 (το getEmployeeBalance κάνει ήδη
  // δικό του, ξεχωριστό parallel fetch από μέσα, βλ. εκεί).
  const [emp, balance] = await Promise.all([
    getEmployeeById(env, employeeId),
    getEmployeeBalance(env, employeeId),
  ]);
  if (!emp) throw new Error("Άγνωστος τεχνικός.");
  return {
    employee: emp,
    annualDays: balance.annualDays,
    usedDays: balance.usedDays,
    remainingDays: balance.remainingDays,
    pendingCount: balance.pendingCount,
    // Πλήρες ιστορικό ήδη ταξινομημένο (πιο πρόσφατο πρώτο) από
    // getEmployeeBalance — αρκετό cap για προφίλ, ίδιο μοτίβο με «Πρόσφατες
    // αποφάσεις» του tab Άδειες Ομάδας.
    history: balance.history.slice(0, 30),
  };
}

/**
 * Όλες οι ΕΓΚΕΚΡΙΜΕΝΕΣ άδειες όλων των τεχνικών (όλες οι ομάδες μαζί, σε
 * αντίθεση με searchTeamLeaves/getTeamLeaderData που είναι scoped ανά TL) που
 * τέμνουν το [rangeStart, rangeEnd] (YYYY-MM-DD) — για τη μηνιαία αναφορά
 * προς τον λογιστή (βλ. src/reports.js, sendAccountantMonthlyReport). Ρητή
 * απαίτηση χρήστη: κάθε άδεια εμφανίζεται με την ΠΛΗΡΗ περίοδό της
 * (StartDate–EndDate), όχι περικομμένη στα όρια του μήνα — π.χ. άδεια που
 * ξεκινά στο τέλος του μήνα και συνεχίζεται στον επόμενο φαίνεται ολόκληρη
 * (ο φιλτράρισμα εδώ αποφασίζει μόνο αν ΣΥΜΠΕΡΙΛΗΦΘΕΙ, όχι πώς εμφανίζεται).
 * Περιλαμβάνει όλους τους τύπους άδειας, και Τηλεργασία — ο λογιστής βλέπει
 * τον Τύπο ανά γραμμή και αποφασίζει ο ίδιος τι καταχωρεί στη μισθοδοσία.
 */
export async function getApprovedLeavesInRange(env, rangeStart, rangeEnd) {
  const allLeaves = await readLeavesRows(env);
  // Κανονικοποίηση ΠΡΙΝ τη σύγκριση — βλ. src/dateutil.js (bug garbled
  // ημερομηνιών, 24/08/2026).
  return allLeaves
    .map((l) => ({ ...l, StartDate: normalizeSheetDate(l.StartDate), EndDate: normalizeSheetDate(l.EndDate) }))
    .filter((l) => l.Status === "Εγκρίθηκε" && l.StartDate <= rangeEnd && l.EndDate >= rangeStart)
    .sort(
      (a, b) =>
        String(a.StartDate || "").localeCompare(String(b.StartDate || "")) ||
        String(a.EmployeeName || "").localeCompare(String(b.EmployeeName || ""), "el")
    );
}

// Γραμμές Backoffice/Team Leader στο Υπάλληλοι (μόνο για να βλέπουν τη
// δική τους άδεια, βλ. SETUP.md) ΔΕΝ είναι πεδίου τεχνικοί. Διάκριση μέσω
// της στήλης Team (ΟΧΙ email — βλ. σχόλιο στο getAllTechniciansAvailability).
function isBackofficeRow(emp) {
  const team = String(emp.Team || "").trim().toLowerCase();
  return team === "back office" || team === "backoffice" || team === "team leader";
}

/**
 * Flat λίστα ΟΛΩΝ των πεδίου τεχνικών με ζωντανή κατάσταση διαθεσιμότητας —
 * κοινός πυρήνας για το "Διαθεσιμότητα Τεχνικών" (grouped ανά Team) ΚΑΙ τη
 * δεξαμενή τεχνικών του "Συνεργεία" (flat, με HasDrivingLicense). 3 status:
 * "onleave" (σε άδεια σήμερα, με μέρες μέχρι επιστροφή), "soon-leave"
 * (εγκεκριμένη άδεια ξεκινά εντός `soonDays` ημερών), "avail" (τίποτα από
 * τα δύο). Έμπνευση από εξωτερικό demo app (μόνο η λογική κατηγοριοποίησης,
 * όχι κώδικας/UI) — ρητό αίτημα χρήστη.
 */
async function computeAvailabilityList(env, { withinDays = 30, soonDays = 3 } = {}) {
  // Παράλληλα, ανεξάρτητα reads — fix ταχύτητας 25/08/2026 (βλ. σχόλιο στο
  // getTeamLeaderData παραπάνω για το ίδιο σκεπτικό).
  const [employees, leaders, allLeaves] = await Promise.all([
    readSheetAsObjects(env, SHEET_EMPLOYEES),
    readSheetAsObjects(env, SHEET_TEAMLEADERS),
    readLeavesRows(env),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const horizonStr = dateStr(new Date(today.getTime() + withinDays * 86400000));
  const soonStr = dateStr(new Date(today.getTime() + soonDays * 86400000));
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

  return employees
    .filter((emp) => !isBackofficeRow(emp))
    .map((emp) => {
      // Κανονικοποίηση ΠΡΙΝ τη σύγκριση με todayStr/horizonStr/soonStr — βλ.
      // src/dateutil.js (bug garbled ημερομηνιών, 24/08/2026).
      const empLeaves = allLeaves
        .filter((l) => String(l.EmployeeID) === String(emp.EmployeeID) && l.Status === "Εγκρίθηκε")
        .map((l) => ({ ...l, StartDate: normalizeSheetDate(l.StartDate), EndDate: normalizeSheetDate(l.EndDate) }));
      const onLeaveToday = empLeaves.find((l) => l.StartDate <= todayStr && l.EndDate >= todayStr);
      const upcoming = empLeaves
        .filter((l) => l.StartDate > todayStr && l.StartDate <= horizonStr)
        .sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)));
      const leader = leaders.find((l) => l.Email === emp.TeamLeaderEmail);

      let status = "avail";
      let statusLabel = "Διαθέσιμος";
      let daysUntilReturn = null;
      let daysUntilLeave = null;

      if (onLeaveToday) {
        status = "onleave";
        daysUntilReturn = daysBetween(todayStr, onLeaveToday.EndDate);
        statusLabel = daysUntilReturn <= 0
          ? "Σε άδεια · επιστρέφει σήμερα"
          : `Σε άδεια · επιστρέφει σε ${daysUntilReturn}ημ.`;
      } else {
        const soonLeave = upcoming.find((l) => l.StartDate <= soonStr);
        if (soonLeave) {
          status = "soon-leave";
          daysUntilLeave = daysBetween(todayStr, soonLeave.StartDate);
          statusLabel = daysUntilLeave <= 0 ? "Φεύγει σήμερα" : `Φεύγει σε ${daysUntilLeave}ημ.`;
        }
      }

      return {
        EmployeeID: emp.EmployeeID,
        Name: emp.Name,
        Team: emp.Team || "",
        HasDrivingLicense: emp.HasDrivingLicense || "",
        // Κενό/απόν = "Ενεργός" (τεχνικοί πριν από το feature #5, 13/08/2026).
        // Χρησιμοποιείται από τους καλούντες που θέλουν να αποκλείσουν
        // ανενεργούς (π.χ. δεξαμενή Συνεργείων, reset-pin dropdown, εδώ ίδιο
        // getAllTechniciansAvailability) — ΟΧΙ από όλους (π.χ. το tab Προφίλ
        // Τεχνικού σκόπιμα δείχνει ΚΑΙ ανενεργούς, για ιστορικό).
        Status: emp.Status || "Ενεργός",
        TeamLeaderName: leader ? (leader.Name || leader.Email) : (emp.TeamLeaderEmail || "—"),
        available: !onLeaveToday,
        status,
        statusLabel,
        daysUntilReturn,
        daysUntilLeave,
        currentLeave: onLeaveToday
          ? { Type: onLeaveToday.Type, StartDate: onLeaveToday.StartDate, EndDate: onLeaveToday.EndDate }
          : null,
        upcomingLeaves: upcoming.map((l) => ({ Type: l.Type, StartDate: l.StartDate, EndDate: l.EndDate })),
      };
    })
    .sort((a, b) => a.Name.localeCompare(b.Name, "el"));
}

/**
 * Backoffice-only: αναλυτική διαθεσιμότητα ΟΛΩΝ των τεχνικών (όλες οι
 * ομάδες) — ποιος είναι σε άδεια σήμερα + ποιος έχει επερχόμενη εγκεκριμένη
 * άδεια εντός `withinDays` ημερών. Read-only σύνοψη διαθεσιμότητας, ΟΧΙ
 * πλήρης διαχείριση/έγκριση αδειών άλλων ομάδων (αυτό παραμένει αποκλειστικά
 * TL — βλ. CLAUDE.md decision #1). Ρητή απαίτηση χρήστη να δει το BO αυτό.
 */
export async function getAllTechniciansAvailability(env, { withinDays = 30 } = {}) {
  // Ανενεργοί τεχνικοί αποκλείονται εδώ (ρητή απόφαση χρήστη, item #5,
  // 13/08/2026) — δεν έχει νόημα «Διαθέσιμος/Σε άδεια» για κάποιον που δεν
  // εργάζεται πια. Παραμένουν ορατοί στο tab «Προφίλ Τεχνικού» για ιστορικό.
  const list = (await computeAvailabilityList(env, { withinDays })).filter((t) => t.Status !== "Ανενεργός");

  // Ομαδοποίηση ανά Team (π.χ. "Τεχνικός Αυτοψίας", "Τεχνικός Εμφύσησης") —
  // ρητή απαίτηση χρήστη. Όσοι δεν έχουν Team πάνε σε ομάδα "Χωρίς ομάδα",
  // πάντα τελευταία.
  const groups = new Map();
  for (const t of list) {
    const key = t.Team || "Χωρίς ομάδα";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const teamNames = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Χωρίς ομάδα") return 1;
    if (b === "Χωρίς ομάδα") return -1;
    return a.localeCompare(b, "el");
  });

  return teamNames.map((team) => ({ team, technicians: groups.get(team) }));
}

/**
 * Backoffice-only: flat δεξαμενή τεχνικών για το "Συνεργεία" (drag & drop
 * builder) — ίδιος πυρήνας με getAllTechniciansAvailability, χωρίς grouping
 * ανά Team, με HasDrivingLicense (χρήσιμο badge στην κάρτα τεχνικού).
 */
export async function getTechniciansPool(env) {
  return computeAvailabilityList(env, { withinDays: 30, soonDays: 3 });
}

/**
 * Ενεργός/Ανενεργός τεχνικός (item #5, 13/08/2026, ρητή απαίτηση χρήστη).
 * Μόνο TL/Director (gate `requireTeamLeader` στο index.js — αποκλείει
 * Backoffice, ρητή απόφαση χρήστη). Όταν γίνεται Ανενεργός, γράφεται η
 * σημερινή ημερομηνία στο `InactiveDate` (μαζί με το ήδη υπάρχον `HireDate`
 * δίνει το «Διάστημα Απασχόλησης» — βλ. tpEmploymentDuration στο hub.html).
 * Όταν ξαναγίνεται Ενεργός, το `InactiveDate` καθαρίζεται (δεν έχει νόημα
 * πια). Το login (PIN) ενός Ανενεργού μπλοκάρεται ξεχωριστά στο
 * handleTechnicianLogin (src/index.js) — εδώ μόνο η αλλαγή κατάστασης.
 */
export async function setEmployeeStatus(env, { employeeId, status, actorEmail }) {
  if (!EMPLOYEE_STATUSES.includes(status)) throw new Error("Μη έγκυρη κατάσταση (Ενεργός/Ανενεργός).");

  const employees = await readSheetAsObjects(env, SHEET_EMPLOYEES);
  const row = employees.find((e) => String(e.EmployeeID) === String(employeeId));
  if (!row) throw new Error("Ο τεχνικός δεν βρέθηκε.");

  const statusCol = EMPLOYEE_HEADER_ORDER.indexOf("Status") + 1;
  const inactiveDateCol = EMPLOYEE_HEADER_ORDER.indexOf("InactiveDate") + 1;
  const inactiveDate = status === "Ανενεργός" ? new Date().toISOString().slice(0, 10) : "";

  await updateCell(env, SHEET_EMPLOYEES, row._row, statusCol, status);
  await updateCell(env, SHEET_EMPLOYEES, row._row, inactiveDateCol, inactiveDate);
  await appendAuditLog(env, "employee_status_changed", actorEmail, { employeeId: row.EmployeeID, name: row.Name, status });

  return { employeeId: row.EmployeeID, name: row.Name, status, inactiveDate };
}
