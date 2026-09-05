/**
 * OptikiTec Portal — Worker
 * Χειρίζεται:
 *   - /api/auth/technician   POST { employeeId, pin } -> session cookie
 *   - /api/auth/logout       POST -> καθαρίζει cookie
 *   - /api/whoami            GET  -> { role, name, employeeId|email }
 *   - /api/integration-token GET  -> βραχύβιο signed token (legacy, Apps Script)
 *   - /api/admin/set-pin     POST { employeeId, pin } (χρειάζεται ADMIN_SECRET header) -> seed KV
 *   - /api/admin/bulk-welcome/technicians GET -> λίστα υποψήφιων τεχνικών (επιλογή παραληπτών, 20/08/2026) · POST -> εφάπαξ μαζικό PIN reset + email καλωσορίσματος σε ενεργούς τεχνικούς με email, προαιρετικό body {employeeIds:[...]} για επιλεκτική αποστολή (ΜΟΝΟ BULK_WELCOME_OWNER_EMAIL, 19/08/2026)
 *   - /api/admin/bulk-welcome/staff       GET -> λίστα υποψήφιου staff (επιλογή παραληπτών, 20/08/2026) · POST -> εφάπαξ ενημερωτικό email καλωσορίσματος σε Backoffice/TL/Director, χωρίς credentials, προαιρετικό body {emails:[...]} για επιλεκτική αποστολή (ΜΟΝΟ BULK_WELCOME_OWNER_EMAIL)
 *   - /api/leaves/my         GET  -> ισοζύγιο + ιστορικό αδειών του συνδεδεμένου χρήστη
 *   - /api/calendar/my       GET  -> ημερολόγιο τεχνικού: άδειες/τηλεργασία + παραλαβή/επιστροφή/ΚΤΕΟ/Service οχήματος (ΜΟΝΟ τεχνικός, tab «Ημερολόγιο» — item #9, 15/08/2026)
 *   - /api/leaves/submit     POST -> υποβολή νέας αίτησης (τεχνικός/staff για τον εαυτό του — αν ο αιτών είναι ο ίδιος TL, δρομολογείται σε Director)
 *   - /api/leaves/team       GET  -> δεδομένα ομάδας (TL ή Director, + ομάδα backup αν είναι ενεργό)
 *   - /api/leaves/team       GET ?employeeId&startDate&endDate -> αναζήτηση αδειών συγκεκριμένου τεχνικού (πλήρες ιστορικό)
 *   - /api/leaves/team       POST { away } -> toggle "Λείπω" (backup TL ενεργοποιείται/απενεργοποιείται)
 *   - /api/leaves/decide     POST { requestId } ή { groupId } -> έγκριση/απόρριψη (TL ή Director, μόνο δικές του αιτήσεις) — groupId αποφασίζει ΟΛΕΣ τις ημερομηνίες μιας τηλεργασίας μαζί
 *   - /api/leaves/delete     POST { requestId } -> διαγραφή άδειας, οποιαδήποτε κατάσταση (TL ή Director, μόνο δικές του, 15/08/2026)
 *   - /api/leaves/submit-for-team POST -> καταχώρηση εκ μέρους τεχνικού (TL ή Director, μόνο ομάδα του)
 *   - /api/admin/bulk-leave  POST -> μαζική άδεια σε ΟΛΟΥΣ τους ενεργούς υπαλλήλους (αυστηρά Director, 19/08/2026)
 *   - /api/fleet              GET  -> λίστα οχημάτων + types (dropdown) + EpassLabel ανά όχημα (TL ή Director, κοινός στόλος)
 *   - /api/fleet/add          POST -> προσθήκη οχήματος (TL ή Director)
 *   - /api/fleet/update       POST -> επεξεργασία οχήματος (TL ή Director)
 *   - /api/fleet/delete       POST -> διαγραφή οχήματος (TL ή Director)
 *   - /api/fleet/accident     POST -> καταγραφή ατυχήματος οχήματος (TL ή Director)
 *   - /api/fleet/accidents    GET  -> ιστορικό ατυχημάτων ενός οχήματος (TL ή Director)
 *   - /api/fleet/accident/attachment/upload POST -> συνημμένο συμβάντος, raw bytes (TL ή Director)
 *   - /api/fleet/accident/attachment GET  -> λήψη συνημμένου συμβάντος (TL ή Director)
 *   - /api/charges/pickup/mileage POST -> καταγραφή χιλιομέτρων παραλαβής οχήματος (ο ίδιος ο τεχνικός)
 *   - /api/charges/pickup/photo/upload POST -> φωτογραφία παραλαβής, raw bytes, μία ανά κλήση (ο ίδιος ο τεχνικός)
 *   - /api/charges/pickup/photo GET  -> λήψη φωτογραφίας παραλαβής (ο τεχνικός ή TL/Director)
 *   - /api/charges/pickup/return-mileage POST -> καταγραφή χιλιομέτρων επιστροφής οχήματος (ο ίδιος ο τεχνικός)
 *   - /api/charges/pickup/odometer-photo/upload POST -> υποχρεωτική φωτογραφία κοντέρ παραλαβής, raw bytes (ο ίδιος ο τεχνικός) — item #1 «Προς Συζήτηση», 15/08/2026
 *   - /api/charges/return/odometer-photo/upload POST -> υποχρεωτική φωτογραφία κοντέρ επιστροφής, raw bytes (ο ίδιος ο τεχνικός)
 *   - /api/charges/odometer-photo GET ?chargeId&which=pickup|return -> λήψη φωτογραφίας κοντέρ (ο τεχνικός ή TL/Director)
 *   - /api/analytics/kpi      GET  -> tab «Αναλυτικά»: χρήση αδειών/μήνα (6μηνο), ποσοστό χρήσης στόλου, μ.ο. τεχνικών/ημέρα σε συνεργεία (TL ή Director, εταιρικά στοιχεία — όχι scoped)
 *   - /api/handover/create     POST -> νέο έγγραφο παράδοσης από το τρέχον σύνολο κατοχής τεχνικού (TL ή Director) — item «Ψηφιακή υπογραφή», 15/08/2026
 *   - /api/handover/list       GET  ?employeeId=... -> ιστορικό εγγράφων ενός τεχνικού (TL ή Director, «Αναζήτηση τεχνικού»)
 *   - /api/handover/my         GET  -> τα δικά μου έγγραφα προς υπογραφή/ιστορικό (μόνο τεχνικός, «Στην Κατοχή μου»)
 *   - /api/handover/sign       POST -> υπογραφή (εικόνα canvas), raw bytes, ο ίδιος ο τεχνικός, μόνο μία φορά (ο ίδιος ο τεχνικός)
 *   - /api/handover/signature  GET  ?id=... -> λήψη/προβολή εικόνας υπογραφής (ο τεχνικός ή TL/Director)
 *   - /api/documents/create   POST -> tab «Έγγραφα»: νέο συμπληρωμένο έγγραφο (π.χ. Αίτηση Άδειας Άνευ Αποδοχών), μόνο TL/Director — 31/08/2026
 *   - /api/documents/list     GET  ?employeeId=... -> ιστορικό εγγράφων ενός τεχνικού (TL ή Director)
 *   - /api/documents/get      GET  ?id=... -> ένα έγγραφο, για επανα-εκτύπωση/προβολή (TL ή Director)
 *   - /api/charges            GET  -> χρεώσεις του συνδεδεμένου χρήστη (τεχνικός/staff, εμπλουτισμένες με Deductible για οχήματα)
 *   - /api/employees/create   GET  -> στοιχεία φόρμας (λίστα TL για Backoffice) (μόνο TL/Backoffice)
 *   - /api/employees/create   POST -> προσθήκη νέου τεχνικού + PIN + email credentials (μόνο TL/Backoffice)
 *   - /api/employees/update   POST -> επεξεργασία στοιχείων υπάρχοντος τεχνικού, tab «Προφίλ Τεχνικού» (μόνο TL/Director, 19/08/2026)
 *   - /api/employees/reset-pin GET  -> λίστα τεχνικών (μόνο TL/Director, καλείται από το tab «Προφίλ Τεχνικού» — ΟΧΙ πια Backoffice, βλ. 15/08/2026)
 *   - /api/employees/reset-pin POST -> νέο τυχαίο PIN για τεχνικό + email αν έχει (μόνο TL/Director, staff-assisted only — item #5)
 *   - /api/employees/status    POST -> Ενεργός/Ανενεργός τεχνικός (μόνο TL/Director — item #5, 13/08/2026)
 *   - /api/employees/document/upload POST -> ανέβασμα συνημμένου τεχνικού (βιογραφικό/ταυτότητα/άδεια διαμονής), raw bytes (μόνο TL/Backoffice)
 *   - /api/employees/document  GET  ?employeeId=...&docType=... -> λήψη συνημμένου τεχνικού (ΜΟΝΟ TL/Director — ευαίσθητα δεδομένα)
 *   - /api/employees/huskies/send-email POST -> email με ΜΟΝΟ τα Huskies credentials, tab «Προφίλ Τεχνικού» (μόνο TL/Director, 24/08/2026)
 *   - /api/backoffice/availability GET -> διαθεσιμότητα ΟΛΩΝ των τεχνικών, όλες οι ομάδες (μόνο Backoffice)
 *   - /api/audit-log           GET  -> ιστορικό ενεργειών (AuditLog sheet), πιο πρόσφατα πρώτα (μόνο Director)
 *   - /api/dashboard/activity  GET  -> «Τελευταία δραστηριότητα» Αρχικής: 8 πιο πρόσφατες, επιμελημένες/φιλτραρισμένες εγγραφές AuditLog (TL/Backoffice/Director — βλ. ACTIVITY_ACTION_META, ΚΑΜΙΑ άδεια/τηλεργασία εκτός Director)
 *   - /api/equipment          GET  -> λίστα εξοπλισμού/αντικειμένων (μόνο TL, κοινή λίστα)
 *   - /api/equipment/add      POST -> προσθήκη αντικειμένου (μόνο TL)
 *   - /api/equipment/update   POST -> επεξεργασία αντικειμένου (μόνο TL)
 *   - /api/equipment/delete   POST -> διαγραφή αντικειμένου (μόνο TL)
 *   - /api/equipment/technician-holdings GET ?employeeId=... -> στοιχεία τεχνικού + ό,τι έχει ΤΩΡΑ πάνω του (οχήματα+εξοπλισμός+e-pass), για αναζήτηση + PDF παράδοσης/παραλαβής (μόνο TL)
 *   - /api/sims                GET  -> λίστα καρτών SIM (αριθμός/PIN/PUK/tablet, μόνο TL, κοινή λίστα)
 *   - /api/sims/add            POST -> προσθήκη κάρτας SIM (μόνο TL)
 *   - /api/sims/update         POST -> επεξεργασία κάρτας SIM (μόνο TL)
 *   - /api/sims/delete         POST -> διαγραφή κάρτας SIM (μόνο TL)
 *   - /api/epass               GET  -> λίστα e-pass (μόνο TL, κοινή λίστα)
 *   - /api/epass/add           POST -> προσθήκη e-pass (μόνο TL)
 *   - /api/epass/update        POST -> επεξεργασία e-pass — ανάθεση σε τεχνικό Ή/ΚΑΙ όχημα (μόνο TL)
 *   - /api/epass/delete        POST -> διαγραφή e-pass (μόνο TL)
 *   - /api/leaves/telework     POST -> δήλωση τηλεργασίας, πολλαπλές μη-συνεχόμενες ημέρες (μόνο Backoffice)
 *   - /api/leaves/attachment/upload POST -> ανέβασμα δικαιολογητικού PDF σε αίτηση Αναρρωτικής, raw bytes (ο ίδιος ο αιτών)
 *   - /api/leaves/attachment   GET  ?id=... -> λήψη δικαιολογητικού (ο αιτών ή ο TL της αίτησης)
 *   - /api/leaves/decide-link  GET  ?token=... -> σελίδα επιβεβαίωσης one-click έγκρισης/απόρριψης από email (χωρίς login, ΔΕΝ αποφασίζει)
 *   - /api/leaves/decide-link  POST { token } -> πραγματική έγκριση/απόρριψη μετά την επιβεβαίωση (signed token, λήξη 14 ημερών)
 *   - /api/crews/pool          GET  -> δεξαμενή τεχνικών με ζωντανή κατάσταση (μόνο Backoffice)
 *   - /api/crews/dates         GET  -> ημερομηνίες με αποθηκευμένη σύνθεση συνεργείων (μόνο Backoffice)
 *   - /api/crews               GET  ?date=YYYY-MM-DD -> σύνθεση συνεργείων συγκεκριμένης ημέρας (μόνο Backoffice)
 *   - /api/crews               POST -> αποθήκευση σύνθεσης ημέρας (μόνο Backoffice)
 *   - /api/announcements        GET  -> λίστα ενημερώσεων/οδηγιών· τεχνικός βλέπει μόνο όσες αφορούν την ειδικότητά του, staff βλέπει πάντα όλες (+ teamOptions, 20/08/2026)
 *   - /api/announcements        POST -> νέα ενημέρωση, προαιρετική στόχευση ανά ειδικότητα (μόνο TL/Backoffice, 20/08/2026) + email στοχευμένων τεχνικών αν δεν είναι "όλοι"
 *   - /api/announcements/upload POST -> ανέβασμα συνημμένου PDF/Word, raw bytes (μόνο TL/Backoffice)
 *   - /api/announcements/delete POST -> διαγραφή ενημέρωσης (μόνο TL/Backoffice)
 *   - /api/announcements/file   GET  ?id=... -> λήψη συνημμένου αρχείου (όλοι οι συνδεδεμένοι ρόλοι)
 *   - /api/availability/queries GET  -> όλα τα ερωτήματα διαθεσιμότητας + συγκεντρωτικές απαντήσεις + teamOptions (μόνο TL/Director, tab «Ανακοινώσεις»)
 *   - /api/availability/query   POST -> νέο ερώτημα διαθεσιμότητας, multi-team target, προαιρετική ετεροχρονισμένη δημοσίευση/χωρίς λήξη (μόνο TL/Director, 20/08/2026), τύπος Ναι/Όχι ή «Έλαβα γνώση» (responseMode, 21/08/2026) + email στοχευμένων τεχνικών
 *   - /api/availability/query/update POST -> επεξεργασία υπάρχοντος ερωτήματος (μόνο TL/Director, οποιοσδήποτε — όχι μόνο ο δημιουργός· ΧΩΡΙΣ επανα-αποστολή email, εκτός αν η επεξεργασία φέρνει τη δημοσίευση στο σήμερα)
 *   - /api/availability/query/delete POST -> διαγραφή ερωτήματος (μόνο TL/Director, οποιοσδήποτε — όχι μόνο ο δημιουργός)
 *   - /api/availability/my-queries GET -> ενεργά+ληγμένα ΔΗΜΟΣΙΕΥΜΕΝΑ ερωτήματα που αφορούν τον συνδεδεμένο τεχνικό, με τη δική του απάντηση (μόνο τεχνικός)
 *   - /api/availability/answer  POST -> καταχώρηση/αλλαγή απάντησης Ναι/Όχι ή «Έλαβα γνώση» (ανάλογα με το ResponseMode του ερωτήματος), μπλοκάρεται μετά την προθεσμία (αν υπάρχει — «χωρίς λήξη»/«Έλαβα γνώση» ποτέ δεν κλειδώνει, μόνο τεχνικός)
 *   - οτιδήποτε άλλο -> static assets (index.html, hub.html, κλπ)
 *   - scheduled() (Cron Triggers) -> εβδομαδιαίες/μηνιαίες email αναφορές ανά TL + ημερήσια σύνοψη χρεώσεων 19:00 (src/reports.js) + καθημερινή δημοσίευση ετεροχρονισμένων ερωτημάτων διαθεσιμότητας 05:00 UTC (src/availability.js)
 *
 * TL / Backoffice / Director ταυτοποιούνται μέσω Cloudflare Access — το
 * header "Cf-Access-Authenticated-User-Email" μπαίνει αυτόματα από το Access
 * proxy όταν η route προστατεύεται (βλ. SETUP.md, βήμα Access policy).
 * Director (νέο φύλλο `Directors`, Email|Name) = πλήρης εποπτεία, ρητή
 * απαίτηση χρήστη — περνάει ΚΑΙ το requireTeamLeader ΚΑΙ το requireBackoffice
 * gate (βλ. src/index.js), άρα βλέπει ό,τι TL + Backoffice μαζί. Κύριος
 * σκοπός: έγκριση αδειών των ίδιων των Team Leaders (βλ. src/leaves.js,
 * submitLeaveRequest).
 *
 * Οι λειτουργίες /api/leaves/* μιλάνε ΑΠΕΥΘΕΙΑΣ με το Google Sheet μέσω
 * Sheets API (service account) — βλ. src/sheets.js, src/leaves.js.
 * Δεν χρησιμοποιούν πλέον το Apps Script backend.
 */

import {
  getEmployeeById,
  getEmployeeByEmail,
  getTeamLeaderByEmail,
  getBackofficeByEmail,
  getEmployeeBalance,
  submitLeaveRequest,
  getTeamLeaderData,
  submitLeaveRequestAsLeader,
  submitBulkLeave,
  decideLeaveRequest,
  deleteLeaveRequest,
  decideLeaveRequestGroup,
  setLeaderAway,
  listTeamLeaders,
  listTeamOptions,
  createTechnicianRecord,
  searchTeamLeaves,
  getAllTechniciansAvailability,
  getTechniciansPool,
  submitTeleworkRequest,
  uploadLeaveAttachment,
  getLeaveAttachmentById,
  getDirectorByEmail,
  getLeaveRequestById,
  getLeaveRequestsByGroupId,
  getTechnicianLeaveProfile,
  uploadEmployeeDocument,
  getEmployeeDocument,
  setEmployeeStatus,
  updateTechnicianRecord,
} from "./leaves.js";
import { getOidcDiscoveryJson, getJwksJson, appendAuditLog, getAuditLog, readSheetAsObjects } from "./sheets.js";
import { normalizeSheetDate, formatSheetDateEl } from "./dateutil.js";
import { listVehicles, addVehicle, updateVehicle, deleteVehicle, listDrivers, listVehicleTypes, listVehicleEpassMap, reportVehicleAccident, listVehicleAccidents, uploadAccidentAttachment, getAccidentAttachment } from "./fleet.js";
import { listEquipment, addEquipment, updateEquipment, deleteEquipment, listEquipmentDrivers, listEquipmentCategories } from "./equipment.js";
import { listSims, addSim, updateSim, deleteSim } from "./sims.js";
import { listEpass, addEpass, updateEpass, deleteEpass, listEpassDrivers, listEpassVehicles } from "./epass.js";
import { listCrewDates, getCrewsForDate, saveCrewsForDate } from "./crews.js";
import {
  listAnnouncements,
  listAnnouncementsForTechnician,
  uploadAnnouncementFile,
  getAnnouncementFileById,
  createAnnouncement,
  deleteAnnouncement,
} from "./announcements.js";
import {
  createAvailabilityQuery,
  listAvailabilityQueries,
  listMyAvailabilityQueries,
  submitAvailabilityAnswer,
  updateAvailabilityQuery,
  deleteAvailabilityQuery,
  publishScheduledAvailabilityQueries,
} from "./availability.js";
import { listAssignmentsForEmployee, getTechnicianHoldings, setVehiclePickupMileage, uploadVehiclePickupPhoto, getVehiclePickupPhoto, setVehicleReturnMileage, getVehicleCalendarEvents, uploadOdometerPickupPhoto, uploadOdometerReturnPhoto, getOdometerPhoto } from "./assignments.js";
import { getKpiSummary } from "./analytics.js";
import { createHandoverDocument, listHandoverDocumentsForEmployee, signHandoverDocument, getHandoverSignature } from "./handover.js";
import { createDocument, listDocumentsForEmployee, listAllDocuments, getDocumentById } from "./documents.js";
import { sendWeeklyReports, sendMonthlyReports, sendDailyChargesDigest } from "./reports.js";
import { createSheetBackup, listSheetBackups, getSheetBackupRaw } from "./backup.js";
import { sendEmail, emailTemplate, PORTAL_URL, logEmailFailure } from "./email.js";
import { signPayload, verifyPayload } from "./tokens.js";

const SESSION_COOKIE = "optikitec_session";
const SESSION_TTL_SECONDS = 60 * 60 * 10; // 10 ώρες
const INTEGRATION_TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 ώρες - καλύπτει ολόκληρη συνεδρία TL/backoffice dashboard, χρησιμοποιείται και για re-verification σε write actions, όχι μόνο στο αρχικό redirect

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/auth/technician" && request.method === "POST") {
      return handleTechnicianLogin(request, env);
    }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
      return handleLogout();
    }
    if (pathname === "/api/whoami" && request.method === "GET") {
      return handleWhoami(request, env);
    }
    if (pathname === "/api/integration-token" && request.method === "GET") {
      return handleIntegrationToken(request, env);
    }
    if (pathname === "/api/admin/set-pin" && request.method === "POST") {
      return handleAdminSetPin(request, env);
    }
    // Μαζική αποστολή καλωσορίσματος — εφάπαξ ενέργεια, ορατή/χρησιμοποιήσιμη
    // ΜΟΝΟ σε BULK_WELCOME_OWNER_EMAIL (βλ. requireBulkWelcomeOwner παρακάτω),
    // ρητή απαίτηση χρήστη 19/08/2026. GET -> λίστα υποψήφιων παραληπτών (για
    // την επιλογή στο UI, 20/08/2026) — POST -> αποστολή, με προαιρετικό body
    // {employeeIds:[...]} / {emails:[...]} για επιλεκτικούς παραλήπτες· χωρίς
    // body στέλνει σε όλους (ίδια συμπεριφορά με πριν, backward-compatible).
    if (pathname === "/api/admin/bulk-welcome/technicians" && request.method === "GET") {
      return handleBulkWelcomeTechniciansList(request, env);
    }
    if (pathname === "/api/admin/bulk-welcome/technicians" && request.method === "POST") {
      return handleBulkWelcomeTechnicians(request, env);
    }
    if (pathname === "/api/admin/bulk-welcome/staff" && request.method === "GET") {
      return handleBulkWelcomeStaffList(request, env);
    }
    if (pathname === "/api/admin/bulk-welcome/staff" && request.method === "POST") {
      return handleBulkWelcomeStaff(request, env);
    }
    if (pathname === "/api/leaves/my" && request.method === "GET") {
      return handleLeavesMy(request, env);
    }
    if (pathname === "/api/calendar/my" && request.method === "GET") {
      return handleTechnicianCalendar(request, env);
    }
    if (pathname === "/api/leaves/submit" && request.method === "POST") {
      return handleLeavesSubmit(request, env);
    }
    if (pathname === "/api/leaves/team" && request.method === "GET") {
      // Ίδιο path, extra query params -> αναζήτηση αδειών συγκεκριμένου
      // τεχνικού (reuse αντί για νέο Access-protected path).
      if (url.searchParams.get("employeeId")) {
        return handleLeavesTeamSearch(request, env, url.searchParams);
      }
      return handleLeavesTeam(request, env);
    }
    // Ίδιο path (ήδη Access-protected) — reuse αντί για νέο endpoint, γιατί
    // το Cloudflare Access έχει ήδη γεμίσει τα 5 προστατευμένα paths.
    if (pathname === "/api/leaves/team" && request.method === "POST") {
      return handleLeavesTeamAway(request, env);
    }
    if (pathname === "/api/leaves/decide" && request.method === "POST") {
      return handleLeavesDecide(request, env);
    }
    // Διαγραφή άδειας — TL/Director, οποιαδήποτε κατάσταση, ρητή απαίτηση
    // χρήστη (15/08/2026, π.χ. διόρθωση λάθους καταχώρησης).
    if (pathname === "/api/leaves/delete" && request.method === "POST") {
      return handleLeavesDelete(request, env);
    }
    if (pathname === "/api/leaves/submit-for-team" && request.method === "POST") {
      return handleLeavesSubmitForTeam(request, env);
    }
    // Μαζική άδεια σε ΟΛΟΥΣ τους ενεργούς υπαλλήλους — αυστηρά μόνο Director.
    if (pathname === "/api/admin/bulk-leave" && request.method === "POST") {
      return handleBulkLeave(request, env);
    }
    if (pathname === "/api/fleet" && request.method === "GET") {
      return handleFleetList(request, env);
    }
    if (pathname === "/api/fleet/add" && request.method === "POST") {
      return handleFleetAdd(request, env);
    }
    if (pathname === "/api/fleet/update" && request.method === "POST") {
      return handleFleetUpdate(request, env);
    }
    if (pathname === "/api/fleet/delete" && request.method === "POST") {
      return handleFleetDelete(request, env);
    }
    // Ατυχήματα οχημάτων — καταγραφή/ιστορικό/συνημμένο. Ίδιο gate
    // requireTeamLeader με το υπόλοιπο tab Στόλος (TL+Director).
    if (pathname === "/api/fleet/accident" && request.method === "POST") {
      return handleFleetAccidentReport(request, env);
    }
    if (pathname === "/api/fleet/accidents" && request.method === "GET") {
      return handleFleetAccidentsList(request, env);
    }
    if (pathname === "/api/fleet/accident/attachment/upload" && request.method === "POST") {
      return handleFleetAccidentAttachmentUpload(request, env);
    }
    if (pathname === "/api/fleet/accident/attachment" && request.method === "GET") {
      return handleFleetAccidentAttachmentFile(request, env, url.searchParams);
    }
    // Παραλαβή οχήματος (χιλιόμετρα + πολλαπλές φωτογραφίες) — ο ΙΔΙΟΣ ο
    // τεχνικός το συμπληρώνει από το tab «Στην Κατοχή μου» (session-based
    // check ότι η χρέωση είναι δική του, βλ. handlers παρακάτω).
    if (pathname === "/api/charges/pickup/mileage" && request.method === "POST") {
      return handleChargePickupMileage(request, env);
    }
    if (pathname === "/api/charges/pickup/photo/upload" && request.method === "POST") {
      return handleChargePickupPhotoUpload(request, env);
    }
    if (pathname === "/api/charges/pickup/photo" && request.method === "GET") {
      return handleChargePickupPhotoFile(request, env, url.searchParams);
    }
    // Επιστροφή οχήματος (χιλιόμετρα) — ίδιο σκεπτικό/gate με την παραλαβή
    // παραπάνω, ο ίδιος ο τεχνικός, ρητή απαίτηση χρήστη (βλ. CLAUDE.md).
    if (pathname === "/api/charges/pickup/return-mileage" && request.method === "POST") {
      return handleChargeReturnMileage(request, env);
    }
    // Φωτογραφία κοντέρ (χιλιομετρητή) — ΞΕΧΩΡΙΣΤΟ υποχρεωτικό πεδίο από τις
    // γενικές φωτογραφίες παραλαβής παραπάνω, ΚΑΙ στην Παραλαβή ΚΑΙ στην
    // Επιστροφή (item #1 «Προς Συζήτηση», 15/08/2026, ρητή απαίτηση χρήστη).
    if (pathname === "/api/charges/pickup/odometer-photo/upload" && request.method === "POST") {
      return handleChargeOdometerPhotoUpload(request, env, "pickup");
    }
    if (pathname === "/api/charges/return/odometer-photo/upload" && request.method === "POST") {
      return handleChargeOdometerPhotoUpload(request, env, "return");
    }
    if (pathname === "/api/charges/odometer-photo" && request.method === "GET") {
      return handleChargeOdometerPhotoFile(request, env, url.searchParams);
    }
    if (pathname === "/api/charges" && request.method === "GET") {
      return handleCharges(request, env);
    }
    // Tab «Αναλυτικά»/KPI — εταιρικά στοιχεία, ορατά ΚΑΙ σε TL ΚΑΙ σε
    // Director (πρόταση Claude, αποδεκτή από χρήστη, 15/08/2026).
    if (pathname === "/api/analytics/kpi" && request.method === "GET") {
      return handleAnalyticsKpi(request, env);
    }
    // Ψηφιακή υπογραφή εγγράφου παράδοσης/παραλαβής (15/08/2026, σχεδιάστηκε
    // μέσω διευκρινιστικών ερωτήσεων) — TL/Director δημιουργεί από το τρέχον
    // σύνολο κατοχής, ο ίδιος ο τεχνικός υπογράφει απομακρυσμένα (βλ.
    // src/handover.js).
    if (pathname === "/api/handover/create" && request.method === "POST") {
      return handleHandoverCreate(request, env);
    }
    if (pathname === "/api/handover/list" && request.method === "GET") {
      return handleHandoverList(request, env, url.searchParams);
    }
    if (pathname === "/api/handover/my" && request.method === "GET") {
      return handleHandoverMy(request, env);
    }
    if (pathname === "/api/handover/sign" && request.method === "POST") {
      return handleHandoverSign(request, env);
    }
    if (pathname === "/api/handover/signature" && request.method === "GET") {
      return handleHandoverSignatureFile(request, env, url.searchParams);
    }
    // Tab «Έγγραφα» (31/08/2026) — αυτοματοποιημένα έγγραφα προσωπικού (π.χ.
    // Αίτηση Άδειας Άνευ Αποδοχών), μόνο TL+Director (βλ. src/documents.js).
    if (pathname === "/api/documents/create" && request.method === "POST") {
      return handleDocumentCreate(request, env);
    }
    if (pathname === "/api/documents/list" && request.method === "GET") {
      return handleDocumentList(request, env, url.searchParams);
    }
    if (pathname === "/api/documents/get" && request.method === "GET") {
      return handleDocumentGet(request, env, url.searchParams);
    }
    if (pathname === "/api/equipment" && request.method === "GET") {
      return handleEquipmentList(request, env);
    }
    if (pathname === "/api/equipment/add" && request.method === "POST") {
      return handleEquipmentAdd(request, env);
    }
    if (pathname === "/api/equipment/update" && request.method === "POST") {
      return handleEquipmentUpdate(request, env);
    }
    if (pathname === "/api/equipment/delete" && request.method === "POST") {
      return handleEquipmentDelete(request, env);
    }
    if (pathname === "/api/equipment/technician-holdings" && request.method === "GET") {
      return handleEquipmentTechnicianHoldings(request, env, url.searchParams);
    }
    if (pathname === "/api/sims" && request.method === "GET") {
      return handleSimsList(request, env);
    }
    if (pathname === "/api/sims/add" && request.method === "POST") {
      return handleSimsAdd(request, env);
    }
    if (pathname === "/api/sims/update" && request.method === "POST") {
      return handleSimsUpdate(request, env);
    }
    if (pathname === "/api/sims/delete" && request.method === "POST") {
      return handleSimsDelete(request, env);
    }
    // Ενιαίο «Προφίλ Τεχνικού» (TL+Director) — χωρίς employeeId: λίστα
    // τεχνικών scoped ανά ρόλο (dropdown)· με employeeId: πλήρες προφίλ
    // (ισοζύγιο/ιστορικό αδειών + ό,τι έχει ΤΩΡΑ πάνω του). Βλ.
    // handleEmployeeProfile παρακάτω.
    if (pathname === "/api/employees/profile" && request.method === "GET") {
      return handleEmployeeProfile(request, env, url.searchParams);
    }
    if (pathname === "/api/epass" && request.method === "GET") {
      return handleEpassList(request, env);
    }
    if (pathname === "/api/epass/add" && request.method === "POST") {
      return handleEpassAdd(request, env);
    }
    if (pathname === "/api/epass/update" && request.method === "POST") {
      return handleEpassUpdate(request, env);
    }
    if (pathname === "/api/epass/delete" && request.method === "POST") {
      return handleEpassDelete(request, env);
    }
    if (pathname === "/api/leaves/telework" && request.method === "POST") {
      return handleLeavesTelework(request, env);
    }
    if (pathname === "/api/leaves/attachment/upload" && request.method === "POST") {
      return handleLeaveAttachmentUpload(request, env);
    }
    if (pathname === "/api/leaves/attachment" && request.method === "GET") {
      return handleLeaveAttachmentFile(request, env, url.searchParams);
    }
    if (pathname === "/api/leaves/decide-link" && request.method === "GET") {
      return handleLeaveDecideLinkConfirm(request, env, url.searchParams);
    }
    if (pathname === "/api/leaves/decide-link" && request.method === "POST") {
      return handleLeaveDecideLinkSubmit(request, env);
    }
    if (pathname === "/api/crews/pool" && request.method === "GET") {
      return handleCrewsPool(request, env);
    }
    if (pathname === "/api/crews/dates" && request.method === "GET") {
      return handleCrewsDates(request, env);
    }
    if (pathname === "/api/crews" && request.method === "GET") {
      return handleCrewsGet(request, env, url.searchParams);
    }
    if (pathname === "/api/crews" && request.method === "POST") {
      return handleCrewsSave(request, env);
    }
    if (pathname === "/api/announcements" && request.method === "GET") {
      return handleAnnouncementsList(request, env);
    }
    if (pathname === "/api/announcements" && request.method === "POST") {
      return handleAnnouncementCreate(request, env);
    }
    if (pathname === "/api/announcements/upload" && request.method === "POST") {
      return handleAnnouncementUpload(request, env);
    }
    if (pathname === "/api/announcements/delete" && request.method === "POST") {
      return handleAnnouncementDelete(request, env);
    }
    if (pathname === "/api/announcements/file" && request.method === "GET") {
      return handleAnnouncementFile(request, env, url.searchParams);
    }
    if (pathname === "/api/availability/queries" && request.method === "GET") {
      return handleAvailabilityQueriesList(request, env);
    }
    if (pathname === "/api/availability/query" && request.method === "POST") {
      return handleAvailabilityQueryCreate(request, env);
    }
    if (pathname === "/api/availability/query/update" && request.method === "POST") {
      return handleAvailabilityQueryUpdate(request, env);
    }
    if (pathname === "/api/availability/query/delete" && request.method === "POST") {
      return handleAvailabilityQueryDelete(request, env);
    }
    if (pathname === "/api/availability/my-queries" && request.method === "GET") {
      return handleAvailabilityMyQueries(request, env);
    }
    if (pathname === "/api/availability/answer" && request.method === "POST") {
      return handleAvailabilityAnswer(request, env);
    }
    if (pathname === "/api/employees/create" && request.method === "GET") {
      return handleEmployeesCreateInfo(request, env);
    }
    if (pathname === "/api/employees/create" && request.method === "POST") {
      return handleEmployeesCreate(request, env);
    }
    // Επεξεργασία στοιχείων υπάρχοντος τεχνικού — κουμπί «Επεξεργασία» στο
    // tab «Προφίλ Τεχνικού» (ρητή απαίτηση χρήστη 19/08/2026). ΜΟΝΟ TL/
    // Director (requireTeamLeader, ίδιο gate με το υπόλοιπο tab — αποκλείει
    // Backoffice, συνεπές με το ότι το Backoffice δεν έχει καν πρόσβαση στο
    // «Προφίλ Τεχνικού»).
    if (pathname === "/api/employees/update" && request.method === "POST") {
      return handleEmployeeUpdate(request, env);
    }
    // Email με ΜΟΝΟ τα Huskies credentials — ρητή απαίτηση χρήστη
    // 24/08/2026, ίδιο gate requireTeamLeader με το υπόλοιπο tab.
    if (pathname === "/api/employees/huskies/send-email" && request.method === "POST") {
      return handleEmployeeHuskiesEmail(request, env);
    }
    if (pathname === "/api/employees/reset-pin" && request.method === "GET") {
      return handleResetPinInfo(request, env);
    }
    if (pathname === "/api/employees/reset-pin" && request.method === "POST") {
      return handleResetPin(request, env);
    }
    // Ενεργός/Ανενεργός τεχνικός (item #5, 13/08/2026) — μόνο TL/Director
    // (requireTeamLeader, ρητή απόφαση χρήστη, αποκλείει Backoffice).
    if (pathname === "/api/employees/status" && request.method === "POST") {
      return handleEmployeeStatus(request, env);
    }
    // Συνημμένα τεχνικού (βιογραφικό/ταυτότητα-διαβατήριο/άδεια διαμονής) —
    // upload: ίδιο gate με «Νέος Τεχνικός» (TL+Backoffice, ώστε όποιος
    // καταχωρεί τον νέο τεχνικό να μπορεί να ανεβάσει και τα έγγραφά του).
    // download: ΜΟΝΟ TL+Director (requireTeamLeader), ρητή απόφαση χρήστη
    // λόγω ευαισθησίας δεδομένων — βλ. handleEmployeeDocumentUpload/File.
    if (pathname === "/api/employees/document/upload" && request.method === "POST") {
      return handleEmployeeDocumentUpload(request, env);
    }
    if (pathname === "/api/employees/document" && request.method === "GET") {
      return handleEmployeeDocumentFile(request, env, url.searchParams);
    }
    if (pathname === "/api/backoffice/availability" && request.method === "GET") {
      return handleBackofficeAvailability(request, env);
    }
    if (pathname === "/api/audit-log" && request.method === "GET") {
      return handleAuditLog(request, env);
    }
    if (pathname === "/api/dashboard/activity" && request.method === "GET") {
      return handleDashboardActivity(request, env);
    }
    // Καθημερινό backup Google Sheet (JSON σε KV) — ρητή απαίτηση χρήστη,
    // βλ. src/backup.js. Director-only, ίδιο gate με το Ιστορικό Ενεργειών.
    if (pathname === "/api/backups" && request.method === "GET") {
      return handleBackupsList(request, env);
    }
    if (pathname === "/api/backups/create" && request.method === "POST") {
      return handleBackupCreate(request, env);
    }
    if (pathname === "/api/backups/download" && request.method === "GET") {
      return handleBackupDownload(request, env, url.searchParams);
    }
    // Access-protected "gate": μόνο αυτό το path είναι προστατευμένο από
    // Cloudflare Access (το /hub ΔΕΝ είναι, ώστε να μπορούν να το ανοίξουν
    // και οι τεχνικοί). Μόλις η Google/Access ταυτοποίηση ολοκληρωθεί εδώ,
    // κάνουμε mint ΔΙΚΟ ΜΑΣ session cookie (ίδιος μηχανισμός με τους
    // τεχνικούς) ώστε το /hub και το /api/whoami να ξέρουν ποιος είσαι
    // χωρίς να χρειάζονται τα ίδια να είναι πίσω από το Access.
    if (pathname === "/api/auth/staff-login" && request.method === "GET") {
      return handleStaffLoginGate(request, env);
    }
    // Δημόσια OIDC endpoints — τα χρειάζεται η Google για να επαληθεύσει τα
    // WIF assertion JWTs μας (Workload Identity Federation, βλ. sheets.js).
    // ΔΕΝ προστατεύονται από login/Access — πρέπει να είναι δημόσια προσβάσιμα.
    if (pathname === "/.well-known/openid-configuration" && request.method === "GET") {
      return json(getOidcDiscoveryJson());
    }
    if (pathname === "/.well-known/jwks.json" && request.method === "GET") {
      return json(getJwksJson());
    }

    // Static assets (index.html, hub.html, mockups, Apps Script sources κλπ)
    return env.ASSETS.fetch(request);
  },

  // Cron Triggers (βλ. wrangler.toml [triggers]) — εβδομαδιαίες/μηνιαίες
  // email αναφορές ανά Team Leader + ημερήσια σύνοψη χρεώσεων στις 19:00
  // (src/reports.js). Μπλοκάρει σιωπηλά μέχρι να μπουν τα
  // EMAIL_RELAY_URL/EMAIL_RELAY_SECRET secrets (βλ. CLAUDE.md).
  async scheduled(event, env, ctx) {
    if (event.cron === "0 6 * * 1") {
      ctx.waitUntil(sendWeeklyReports(env));
    } else if (event.cron === "0 6 1 * *") {
      ctx.waitUntil(sendMonthlyReports(env));
    } else if (event.cron === "0 16 * * *") {
      ctx.waitUntil(sendDailyChargesDigest(env));
    } else if (event.cron === "0 3 * * *") {
      ctx.waitUntil(createSheetBackup(env));
    } else if (event.cron === "0 5 * * *") {
      // Δημοσιεύει ερωτήματα διαθεσιμότητας με ετεροχρονισμένη δημοσίευση
      // που έφτασε η ώρα τους (βλ. src/availability.js, 20/08/2026).
      ctx.waitUntil(publishScheduledAvailabilityQueries(env));
    }
  },
};

// ============================================================
// TECHNICIAN LOGIN (επώνυμο έμμεσα μέσω employeeId + 4ψήφιο PIN)
// ============================================================

// Rate-limit στο login τεχνικού (fix ασφαλείας 25/08/2026, ρητό αίτημα
// χρήστη μετά από code review): το PIN είναι μόνο 4 ψηφία (10.000 συνδυασμοί)
// χωρίς αυτό κανένα όριο προσπαθειών δεν υπήρχε. Sliding-window μετρητής στο
// ίδιο KV `TECHNICIAN_AUTH` (ήδη bound, καμία νέα υποδομή) — key
// `loginfail:<employeeId>`, JSON `{count, exp}`, TTL ίσο με το lockout
// window ώστε να αυτοκαθαρίζεται. Καθαρίζεται επίσης άμεσα σε επιτυχές
// login. Σκόπιμα ανά employeeId (όχι ανά IP — πίσω από Cloudflare τα
// τεχνικά headers IP δεν είναι πάντα αξιόπιστα, και το ρίσκο εδώ είναι
// κάποιος να δοκιμάζει PIN για ΣΥΓΚΕΚΡΙΜΕΝΟ γνωστό EmployeeID).
const LOGIN_LOCKOUT_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60;

async function checkLoginLockout(env, employeeId) {
  const key = `loginfail:${employeeId}`;
  const state = await env.TECHNICIAN_AUTH.get(key, "json");
  if (state && state.count >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
    return { locked: true };
  }
  return { locked: false, key, count: state ? state.count : 0 };
}

async function recordLoginFailure(env, employeeId, currentCount) {
  const key = `loginfail:${employeeId}`;
  await env.TECHNICIAN_AUTH.put(key, JSON.stringify({ count: currentCount + 1 }), {
    expirationTtl: LOGIN_LOCKOUT_WINDOW_SECONDS,
  });
}

async function clearLoginLockout(env, employeeId) {
  await env.TECHNICIAN_AUTH.delete(`loginfail:${employeeId}`).catch(() => {});
}

async function handleTechnicianLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId, pin } = body || {};
  if (!employeeId || !pin || !/^\d{4}$/.test(String(pin))) {
    return json({ error: "Χρειάζεται employeeId και 4ψήφιο PIN." }, 400);
  }

  const lockout = await checkLoginLockout(env, employeeId);
  if (lockout.locked) {
    return json({ error: "Πολλές αποτυχημένες προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά ή επικοινώνησε με τον υπεύθυνό σου για επαναφορά PIN." }, 429);
  }

  const record = await env.TECHNICIAN_AUTH.get(`emp:${employeeId}`, "json");
  if (!record) {
    await recordLoginFailure(env, employeeId, lockout.count);
    return json({ error: "Άγνωστος κωδικός υπαλλήλου." }, 401);
  }

  // Άμυνα: γραμμές Backoffice/Team Leader στο Υπάλληλοι (δική τους γραμμή
  // μόνο για να βλέπουν την προσωπική τους άδεια, βλ. CLAUDE.md) δεν πρέπει
  // να μπορούν να μπουν από εδώ σαν τεχνικοί, ακόμα κι αν υπάρχει παλιό PIN
  // seeded στο KV για το EmployeeID τους. Ο ρόλος τους δίνεται αποκλειστικά
  // μέσω Google SSO (/api/auth/staff-login).
  const employee = await getEmployeeById(env, employeeId);
  const team = String(employee?.Team || "").trim().toLowerCase();
  if (team === "back office" || team === "backoffice" || team === "team leader") {
    return json({ error: "Αυτός ο κωδικός δεν συνδέεται με λογαριασμό τεχνικού. Χρησιμοποίησε το Google login." }, 403);
  }

  // Ανενεργός τεχνικός (item #5, 13/08/2026, ρητή απαίτηση χρήστη) — το login
  // μπλοκάρεται ανεξάρτητα από το αν το PIN είναι σωστό. Ο TL/Director τον
  // ξανακάνει Ενεργό (/api/employees/status) αν χρειαστεί να ξαναμπεί.
  if (employee?.Status === "Ανενεργός") {
    return json({ error: "Ο λογαριασμός σου είναι ανενεργός. Επικοινώνησε με τον υπεύθυνό σου." }, 403);
  }

  const hashedInput = await hashPin(employeeId, pin, env.LINK_SECRET);
  if (hashedInput !== record.pinHash) {
    await recordLoginFailure(env, employeeId, lockout.count);
    return json({ error: "Λάθος PIN." }, 401);
  }

  // Επιτυχές login — καθαρίζει τυχόν μετρητή αποτυχημένων προσπαθειών.
  await clearLoginLockout(env, employeeId);

  const session = {
    role: "technician",
    employeeId,
    name: record.name || employeeId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signPayload(session, env.SESSION_SECRET || env.LINK_SECRET);

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  );
  return new Response(JSON.stringify({ ok: true, role: "technician", name: session.name }), {
    status: 200,
    headers,
  });
}

async function handleStaffLoginGate(request, env) {
  const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!accessEmail) {
    // Δεν πρέπει να συμβεί ποτέ αφού το path είναι Access-protected, αλλά
    // για καλό και για κακό.
    return json({ error: "Δεν εντοπίστηκε σύνδεση Google." }, 401);
  }

  const session = {
    role: "staff",
    email: accessEmail,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signPayload(session, env.SESSION_SECRET || env.LINK_SECRET);

  const headers = new Headers({ Location: new URL("/hub", request.url).toString() });
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`
  );
  return new Response(null, { status: 302, headers });
}

function handleLogout() {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ============================================================
// WHOAMI — καθορίζει role είτε από Cloudflare Access header,
// είτε από το τεχνικό session cookie
// ============================================================

/**
 * Ξεχωρίζει Team Leader από Backoffice από Director: όλοι μπαίνουν με
 * εταιρικό Google λογαριασμό (ίδιο Access gate), αλλά ο πραγματικός ρόλος
 * καθορίζεται από το φύλλο στο οποίο είναι καταχωρημένο το email τους.
 * Director = πλήρης εποπτεία (ό,τι Backoffice + Team Leader μαζί), βλ.
 * requireTeamLeader/requireBackoffice/requireTeamLeaderOrBackoffice
 * παρακάτω — κύριος σκοπός η έγκριση αδειών των ίδιων των Team Leaders.
 * Επιστρέφει "leader" | "backoffice" | "director" | null.
 */
async function resolveStaffRole(env, email) {
  try {
    const leader = await getTeamLeaderByEmail(env, email);
    if (leader) return { staffRole: "leader", name: leader.Name || "" };
    const backoffice = await getBackofficeByEmail(env, email);
    if (backoffice) return { staffRole: "backoffice", name: backoffice.Name || "" };
    const director = await getDirectorByEmail(env, email);
    if (director) return { staffRole: "director", name: director.Name || "" };
  } catch (err) {
    // Αν αποτύχει το Sheets lookup, μη μπλοκάρεις το login — πέφτουμε στα
    // ελάχιστα δικαιώματα (μόνο προσωπικά tools).
  }
  return { staffRole: null, name: "" };
}

async function handleWhoami(request, env) {
  const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (accessEmail) {
    const { staffRole, name } = await resolveStaffRole(env, accessEmail);
    return json({ role: "staff", email: accessEmail, staffRole, name });
  }

  const session = await readSession(request, env);
  if (session && session.role === "technician") {
    return json({ role: "technician", employeeId: session.employeeId, name: session.name });
  }
  if (session && session.role === "staff") {
    const { staffRole, name } = await resolveStaffRole(env, session.email);
    return json({ role: "staff", email: session.email, staffRole, name });
  }

  return json({ role: "anonymous" });
}

// ============================================================
// INTEGRATION TOKEN — βραχύβιο signed token προς Apps Script,
// χρησιμοποιεί το ΙΔΙΟ shared secret με το LINK_SECRET στο Code.gs
// ============================================================

async function handleIntegrationToken(request, env) {
  const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  const session = await readSession(request, env);

  let subject;
  if (accessEmail) {
    subject = { type: "staff", email: accessEmail };
  } else if (session && session.role === "technician") {
    subject = { type: "technician", employeeId: session.employeeId };
  } else {
    return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  }

  const payload = {
    ...subject,
    exp: Math.floor(Date.now() / 1000) + INTEGRATION_TOKEN_TTL_SECONDS,
  };
  const token = await signPayload(payload, env.LINK_SECRET);
  return json({ token });
}

// ============================================================
// ADMIN: seed/rotate τεχνικού PIN στο KV
// Header: X-Admin-Secret: <ADMIN_SECRET>  (wrangler secret put ADMIN_SECRET)
// ============================================================

async function handleAdminSetPin(request, env) {
  const provided = request.headers.get("X-Admin-Secret");
  if (!env.ADMIN_SECRET || provided !== env.ADMIN_SECRET) {
    return json({ error: "Unauthorized." }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId, pin, name } = body || {};
  if (!employeeId || !/^\d{4}$/.test(String(pin))) {
    return json({ error: "Χρειάζεται employeeId και 4ψήφιο PIN." }, 400);
  }
  const pinHash = await hashPin(employeeId, pin, env.LINK_SECRET);
  await env.TECHNICIAN_AUTH.put(`emp:${employeeId}`, JSON.stringify({ pinHash, name: name || employeeId }));
  return json({ ok: true });
}

// ============================================================
// HELPERS
// ============================================================

// ============================================================
// LEAVES API — μιλάει απευθείας με το Google Sheet (src/leaves.js)
// ============================================================

/** Επιστρέφει είτε {type:'technician', employeeId} είτε {type:'staff', email}, ή null αν δεν έχει συνδεθεί */
async function resolveIdentity(request, env) {
  const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (accessEmail) return { type: "staff", email: accessEmail };

  const session = await readSession(request, env);
  if (session && session.role === "technician") {
    return { type: "technician", employeeId: session.employeeId };
  }
  if (session && session.role === "staff") {
    return { type: "staff", email: session.email };
  }
  return null;
}

/** Βρίσκει το employeeId ενός χρήστη (τεχνικός ή staff καταχωρημένος στο φύλλο Υπάλληλοι) */
async function resolveEmployeeId(env, identity) {
  if (identity.type === "technician") return identity.employeeId;
  const emp = await getEmployeeByEmail(env, identity.email);
  return emp ? emp.EmployeeID : null;
}

async function handleLeavesMy(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) {
    return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);
  }
  try {
    const balance = await getEmployeeBalance(env, employeeId);
    return json(balance);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Ημερολόγιο τεχνικού — item #9 (15/08/2026), σχεδιάστηκε μέσω
 * διευκρινιστικών ερωτήσεων: ΜΟΝΟ στο δικό του tab (ΟΧΙ μέσα στο Προφίλ
 * Τεχνικού του TL/Director — ρητή απόφαση χρήστη, διαφορετικό scope από
 * το "Απαντήσεις Ανακοινώσεων" που ΕΙΝΑΙ εκεί). Συνδυάζει δύο ήδη
 * υπάρχοντα read paths, καμία νέα αποθήκευση: το ιστορικό αδειών (reuse
 * getEmployeeBalance, ίδια πηγή με "Οι Άδειές μου") + τα γεγονότα οχήματος
 * (reuse getVehicleCalendarEvents, νέα συνάρτηση στο assignments.js).
 * Απορριφθείσες αιτήσεις αποκλείονται (δεν είναι πραγματικά "γεγονότα").
 */
async function handleTechnicianCalendar(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "technician") return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  try {
    const [balance, vehicleEvents] = await Promise.all([
      getEmployeeBalance(env, identity.employeeId),
      getVehicleCalendarEvents(env, identity.employeeId),
    ]);
    const leaveEvents = (balance.history || [])
      .filter((l) => l.Status !== "Απορρίφθηκε")
      .map((l) => ({
        date: l.StartDate,
        endDate: l.EndDate,
        type: l.Type === "Τηλεργασία" ? "telework" : "leave",
        status: l.Status,
        title: `${l.Type}${l.Status === "Εκκρεμεί" ? " (εκκρεμεί)" : ""}`,
      }));
    return json({ events: [...leaveEvents, ...vehicleEvents] });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleLeavesSubmit(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) {
    return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { type, startDate, endDate, note } = body || {};
  if (!type || !startDate || !endDate) {
    return json({ error: "Χρειάζεται τύπο και ημερομηνίες." }, 400);
  }

  try {
    const enteredBy = identity.type === "staff" ? identity.email : undefined;
    const result = await submitLeaveRequest(env, { employeeId, type, startDate, endDate, note, enteredBy });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Ανέβασμα δικαιολογητικού PDF σε αίτηση Αναρρωτικής — raw bytes στο body,
 * requestId+filename σε query param. Επιτρέπεται στον ίδιο τον αιτούντα Ή
 * στον TL/Director της αίτησης (βλ. uploadLeaveAttachment/isAuthorizedForTeam,
 * επεκτάθηκε 03/09/2026 ώστε ο TL να μπορεί να ανεβάσει δικαιολογητικό όταν
 * καταχωρεί ο ίδιος αναρρωτική άδεια εκ μέρους τεχνικού).
 */
async function handleLeaveAttachmentUpload(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const employeeId = await resolveEmployeeId(env, identity);
  const staffEmail = identity.type === "staff" ? identity.email : null;
  if (!employeeId && !staffEmail) {
    return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);
  }

  const params = new URL(request.url).searchParams;
  const requestId = params.get("requestId");
  const filename = params.get("filename") || "δικαιολογητικό.pdf";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!requestId) return json({ error: "Χρειάζεται requestId." }, 400);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενό αρχείο." }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "Το αρχείο είναι πολύ μεγάλο (μέγιστο 20MB)." }, 400);
    const result = await uploadLeaveAttachment(env, { requestId, employeeId, staffEmail, bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Λήψη δικαιολογητικού — μόνο ο αιτών ή ο TL της συγκεκριμένης αίτησης */
async function handleLeaveAttachmentFile(request, env, params) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const id = params.get("id");
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  const employeeId = await resolveEmployeeId(env, identity);
  const staffEmail = identity.type === "staff" ? identity.email : null;

  try {
    const file = await getLeaveAttachmentById(env, id, { employeeId, staffEmail });
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε ή δεν έχεις δικαίωμα πρόσβασης." }, 404);
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// ONE-CLICK DECIDE LINKS — έγκριση/απόρριψη άδειας απευθείας από email,
// χωρίς login (βλ. CLAUDE.md). Tokens minted στο src/leaves.js
// (decideLinksHtml), verified εδώ με το ΙΔΙΟ LINK_SECRET.
//
// ΣΗΜΑΝΤΙΚΟ: το GET ΔΕΝ αποφασίζει ΠΟΤΕ, μόνο δείχνει μια σελίδα
// επιβεβαίωσης — προστασία από email clients/εταιρικά security scanners
// που κάνουν prefetch σε GET links (θα ενεργοποιούσαν αλλιώς κατά λάθος
// έγκριση/απόρριψη χωρίς κανένα ανθρώπινο κλικ). Η πραγματική ενέργεια
// γίνεται ΜΟΝΟ στο POST, μετά το κλικ «Ναι» στη φόρμα της σελίδας.
// ============================================================

const DECIDE_LINK_LABELS = { approve: "Έγκριση", reject: "Απόρριψη" };

/** Επαληθεύει το token ενός decide-link· επιστρέφει { payload } ή { errorHtml }. Δέχεται είτε μεμονωμένη αίτηση ("leave-decide") είτε ομαδική τηλεργασία ("leave-decide-group", βλ. decideLinksHtmlGroup στο src/leaves.js). */
async function verifyDecideLinkToken(token, env) {
  if (!token) return { errorHtml: decideLinkPage({ badge: "Σφάλμα", badgeColor: "red", heading: "Μη έγκυρος σύνδεσμος", message: "Λείπει το token." }) };
  const payload = await verifyPayload(token, env.LINK_SECRET);
  if (!payload || (payload.type !== "leave-decide" && payload.type !== "leave-decide-group")) {
    return { errorHtml: decideLinkPage({ badge: "Σφάλμα", badgeColor: "red", heading: "Μη έγκυρος σύνδεσμος", message: "Ο σύνδεσμος δεν είναι έγκυρος. Συνδέσου κανονικά στο portal." }) };
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { errorHtml: decideLinkPage({ badge: "Έληξε", badgeColor: "red", heading: "Ο σύνδεσμος έχει λήξει", message: "Οι σύνδεσμοι έγκρισης/απόρριψης μέσω email ισχύουν 14 ημέρες. Συνδέσου κανονικά στο portal για να αποφασίσεις." }) };
  }
  return { payload };
}

/** GET — μόνο προβολή/επιβεβαίωση, καμία μεταβολή δεδομένων (βλ. σχόλιο παραπάνω) */
async function handleLeaveDecideLinkConfirm(request, env, params) {
  const token = params.get("token");
  const { payload, errorHtml } = await verifyDecideLinkToken(token, env);
  if (errorHtml) return errorHtml;

  // Ομαδική τηλεργασία (πολλαπλές μη-συνεχόμενες ημέρες, κοινό GroupID) —
  // ξεχωριστό κλαδί από τη μεμονωμένη αίτηση παρακάτω, ίδιο μοτίβο
  // επιβεβαίωσης/idempotency, βλ. decideLeaveRequestGroup στο src/leaves.js.
  if (payload.type === "leave-decide-group") {
    const members = await getLeaveRequestsByGroupId(env, payload.groupId);
    if (!members.length) {
      return decideLinkPage({ badge: "Σφάλμα", badgeColor: "red", heading: "Η ομάδα αιτήσεων δεν βρέθηκε", message: "Πιθανόν να έχει διαγραφεί." });
    }
    const pending = members.filter((m) => m.Status === "Εκκρεμεί");
    if (!pending.length) {
      return decideLinkPage({
        badge: "Ήδη απαντήθηκε",
        badgeColor: "blue",
        heading: "Η αίτηση έχει ήδη απαντηθεί",
        message: `Τρέχουσα κατάσταση: <strong>${members[0].Status}</strong>. Καμία περαιτέρω ενέργεια δεν χρειάζεται.`,
      });
    }
    const decisionLabel = DECIDE_LINK_LABELS[payload.decision] || payload.decision;
    // Κανονικοποίηση ΠΡΙΝ την ταξινόμηση/εμφάνιση — βλ. src/dateutil.js
    // (bug garbled ημερομηνιών, 24/08/2026: ακριβώς αυτό το σημείο ήταν η
    // πηγή του "01/01/46267"-style bug που αναφέρθηκε στα emails).
    const dates = pending
      .map((m) => normalizeSheetDate(m.StartDate))
      .filter(Boolean)
      .sort()
      .map(formatSheetDateEl)
      .join(", ");
    return decideLinkPage({
      badge: "Επιβεβαίωση",
      badgeColor: payload.decision === "approve" ? "green" : "red",
      heading: `${decisionLabel} αίτησης τηλεργασίας (${pending.length} ${pending.length === 1 ? "ημέρα" : "ημέρες"})`,
      message: `<strong>${pending[0].EmployeeName}</strong> — Τηλεργασία — ${dates}.`,
      formToken: token,
      decisionLabel,
      decisionColor: payload.decision === "approve" ? "green" : "red",
    });
  }

  const leaveRequest = await getLeaveRequestById(env, payload.requestId);
  if (!leaveRequest) {
    return decideLinkPage({ badge: "Σφάλμα", badgeColor: "red", heading: "Η αίτηση δεν βρέθηκε", message: "Πιθανόν να έχει διαγραφεί." });
  }
  if (leaveRequest.Status !== "Εκκρεμεί") {
    return decideLinkPage({
      badge: "Ήδη απαντήθηκε",
      badgeColor: "blue",
      heading: "Η αίτηση έχει ήδη απαντηθεί",
      message: `Τρέχουσα κατάσταση: <strong>${leaveRequest.Status}</strong>. Καμία περαιτέρω ενέργεια δεν χρειάζεται.`,
    });
  }

  const decisionLabel = DECIDE_LINK_LABELS[payload.decision] || payload.decision;
  return decideLinkPage({
    badge: "Επιβεβαίωση",
    badgeColor: payload.decision === "approve" ? "green" : "red",
    heading: `${decisionLabel} αίτησης άδειας`,
    message: `<strong>${leaveRequest.EmployeeName}</strong> — ${leaveRequest.Type} — ${formatSheetDateEl(leaveRequest.StartDate)} έως ${formatSheetDateEl(leaveRequest.EndDate)} (${leaveRequest.Days} ημέρες).`,
    formToken: token,
    decisionLabel,
    decisionColor: payload.decision === "approve" ? "green" : "red",
  });
}

/** POST — η πραγματική ενέργεια, μόνο μετά το κλικ επιβεβαίωσης στη σελίδα του GET */
async function handleLeaveDecideLinkSubmit(request, env) {
  let token;
  try {
    const form = await request.formData();
    token = form.get("token");
  } catch {
    return decideLinkPage({ badge: "Σφάλμα", badgeColor: "red", heading: "Μη έγκυρο αίτημα", message: "Δοκίμασε ξανά από το email." });
  }

  const { payload, errorHtml } = await verifyDecideLinkToken(token, env);
  if (errorHtml) return errorHtml;

  try {
    if (payload.type === "leave-decide-group") {
      await decideLeaveRequestGroup(env, payload.approverEmail, payload.groupId, payload.decision, "");
    } else {
      await decideLeaveRequest(env, payload.approverEmail, payload.requestId, payload.decision, "");
    }
  } catch (err) {
    return decideLinkPage({ badge: "Σφάλμα", badgeColor: "red", heading: "Δεν ολοκληρώθηκε", message: err.message || String(err) });
  }

  const decisionLabel = DECIDE_LINK_LABELS[payload.decision] || payload.decision;
  return decideLinkPage({
    badge: "Ολοκληρώθηκε",
    badgeColor: payload.decision === "approve" ? "green" : "red",
    heading: `Η αίτηση ${payload.decision === "approve" ? "εγκρίθηκε" : "απορρίφθηκε"}`,
    message: "Ο τεχνικός θα ειδοποιηθεί αυτόματα (αν έχει καταχωρημένο email).",
  });
}

/**
 * Απλή, αυτόνομη branded σελίδα (ίδιο navy/μπλε στυλ με το emailTemplate) —
 * για τα decide-link GET/POST παραπάνω, ΕΚΤΟΣ hub.html (δεν χρειάζεται
 * login/JS). `formToken`+`decisionLabel`+`decisionColor` (προαιρετικά):
 * εμφανίζουν το κουμπί επιβεβαίωσης (POST την ίδια διεύθυνση).
 */
function decideLinkPage({ badge, badgeColor = "blue", heading, message, formToken, decisionLabel, decisionColor }) {
  const colors = { blue: "#0C447C", green: "#0F6E56", red: "#A32D2D" };
  const bg = { blue: "#E6F1FB", green: "#E3F5EC", red: "#FBEAEA" };
  const btnColor = decisionColor === "green" ? "#0F6E56" : "#A32D2D";
  const formHtml = formToken
    ? `<form method="POST" action="/api/leaves/decide-link" style="margin-top:22px;">
         <input type="hidden" name="token" value="${formToken}">
         <button type="submit" style="background:${btnColor};color:#fff;border:none;border-radius:8px;padding:12px 22px;font-size:14px;font-weight:700;cursor:pointer;">Ναι, ${decisionLabel}</button>
       </form>`
    : `<a href="${PORTAL_URL}/hub" style="display:inline-block;margin-top:22px;color:#2E9BFF;font-size:13px;font-weight:600;text-decoration:none;">Μετάβαση στο portal →</a>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OptikiTec Portal</title></head>
  <body style="margin:0;padding:40px 20px;background:#F4F6F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #E7EAF0;border-radius:12px;overflow:hidden;">
      <div style="padding:20px 26px;border-bottom:3px solid #2E9BFF;">
        <span style="font-weight:800;font-size:16px;color:#0F1A2E;">Οπτική Τεχνική</span>
      </div>
      <div style="padding:26px;">
        ${badge ? `<span style="display:inline-block;background:${bg[badgeColor] || bg.blue};color:${colors[badgeColor] || colors.blue};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:5px 10px;border-radius:100px;margin-bottom:14px;">${badge}</span>` : ""}
        <h1 style="font-size:19px;color:#1B2333;margin:0 0 12px;font-weight:700;">${heading}</h1>
        <p style="font-size:13.5px;color:#5F6674;line-height:1.6;margin:0;">${message}</p>
        ${formHtml}
      </div>
    </div>
  </body></html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function handleLeavesTeam(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  try {
    const data = await getTeamLeaderData(env, leader.Email);
    return json({ ...data, leaderName: leader.Name, leaderEmail: leader.Email });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Αναζήτηση αδειών συγκεκριμένου τεχνικού (πλήρες ιστορικό, όχι μόνο τελευταίες 15) — ίδιο path με GET /api/leaves/team, μέσω query params */
async function handleLeavesTeamSearch(request, env, params) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  try {
    const results = await searchTeamLeaves(env, leader.Email, {
      employeeId: params.get("employeeId"),
      startDate: params.get("startDate") || "",
      endDate: params.get("endDate") || "",
    });
    return json({ results });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Toggle "Λείπω" (backup TL) — μόνο για τον εαυτό του TL, ίδιο Access-protected path με GET /api/leaves/team */
async function handleLeavesTeamAway(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  try {
    const result = await setLeaderAway(env, leader.Email, !!body.away, body.backupEmail);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleLeavesDecide(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { requestId, groupId, decision, decisionNote } = body || {};
  if ((!requestId && !groupId) || (decision !== "approve" && decision !== "reject")) {
    return json({ error: "Χρειάζεται requestId ή groupId, και decision (approve/reject)." }, 400);
  }

  try {
    // groupId: ομαδική έγκριση/απόρριψη τηλεργασίας (όλες οι ημερομηνίες της
    // ίδιας υποβολής μαζί, ρητή απαίτηση χρήστη) — βλ. decideLeaveRequestGroup
    // στο src/leaves.js. requestId: κανονική μεμονωμένη αίτηση, αμετάβλητο.
    const result = groupId
      ? await decideLeaveRequestGroup(env, leader.Email, groupId, decision, decisionNote)
      : await decideLeaveRequest(env, leader.Email, requestId, decision, decisionNote);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Διαγραφή άδειας — TL/Director, οποιαδήποτε κατάσταση (ίδιο gate/authorization με handleLeavesDecide, βλ. deleteLeaveRequest στο src/leaves.js) */
async function handleLeavesDelete(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { requestId } = body || {};
  if (!requestId) return json({ error: "Χρειάζεται requestId." }, 400);

  try {
    const result = await deleteLeaveRequest(env, leader.Email, requestId);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleLeavesSubmitForTeam(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId, type, startDate, endDate, note } = body || {};
  if (!employeeId || !type || !startDate || !endDate) {
    return json({ error: "Χρειάζεται τεχνικό, τύπο και ημερομηνίες." }, 400);
  }

  try {
    const result = await submitLeaveRequestAsLeader(env, leader.Email, { employeeId, type, startDate, endDate, note });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Μαζική καταχώρηση άδειας σε ΟΛΟΥΣ τους ενεργούς υπαλλήλους — ρητή απαίτηση
 * χρήστη (19/08/2026, π.χ. εταιρικές διακοπές). Αυστηρά μόνο Director
 * (requireDirector, ΟΧΙ requireTeamLeader — ρητή επιλογή χρήστη, κάθε
 * Director μπορεί να το χρησιμοποιήσει, δεν είναι owner-only single-user
 * gate σαν το bulk-welcome).
 */
async function handleBulkLeave(request, env) {
  const { director, error } = await requireDirector(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { type, startDate, endDate, note } = body || {};
  if (!type || !startDate || !endDate) {
    return json({ error: "Χρειάζεται τύπο και ημερομηνίες." }, 400);
  }

  try {
    const result = await submitBulkLeave(env, {
      type,
      startDate,
      endDate,
      note,
      enteredBy: (director && director.Email) || "director",
    });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// CHARGES API — ό,τι έχει χρεωθεί στον συνδεδεμένο χρήστη
// ============================================================

async function handleCharges(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) {
    return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);
  }
  try {
    const charges = await listAssignmentsForEmployee(env, employeeId);
    return json({ charges });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// EMPLOYEES API — προσθήκη νέου τεχνικού. Και TL και Backoffice μπορούν να
// τον αναθέσουν σε ΟΠΟΙΟΝΔΗΠΟΤΕ Team Leader (dropdown, όχι μόνο ο εαυτός
// του TL) — ρητή απαίτηση χρήστη, βλ. requireTeamLeaderOrBackoffice.
// ΔΕΝ είναι στα 5 Cloudflare Access-protected paths (βλ. CLAUDE.md) —
// βασίζεται στο ίδιο session-based role check που ήδη προστατεύει τα
// περισσότερα endpoints (π.χ. /api/leaves/submit, /api/charges).
// ============================================================

async function handleEmployeesCreateInfo(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;

  try {
    // Και οι δύο ρόλοι επιλέγουν TL από την ίδια πλήρη λίστα — ο TL απλά
    // βλέπει τον εαυτό του προεπιλεγμένο, για ευκολία, όχι κλειδωμένος.
    const leaders = await listTeamLeaders(env);
    const teamOptions = await listTeamOptions(env);
    return json({
      staffRole: auth.staffRole,
      leaders,
      teamOptions,
      defaultTeamLeaderEmail: auth.staffRole === "leader" ? auth.leader.Email : null,
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEmployeesCreate(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }

  const { employeeId, name, email, teamLeaderEmail, annualDays, team, hasDrivingLicense, ama, amka, afm, phone, companyPhone, address, hireDate, technicalTraining, huskiesUsername, huskiesPassword, priorExperience, fatherName, idNumber } = body || {};

  try {
    const employee = await createTechnicianRecord(
      env,
      { employeeId, name, email, teamLeaderEmail, annualDays, team, hasDrivingLicense, ama, amka, afm, phone, companyPhone, address, hireDate, technicalTraining, huskiesUsername, huskiesPassword, priorExperience, fatherName, idNumber },
      auth.email
    );

    // Seed PIN στο KV — ίδιος μηχανισμός με /api/admin/set-pin, χωρίς
    // ADMIN_SECRET: η εξουσιοδότηση εδώ είναι το session role check παραπάνω.
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const pinHash = await hashPin(employee.EmployeeID, pin, env.LINK_SECRET);
    await env.TECHNICIAN_AUTH.put(`emp:${employee.EmployeeID}`, JSON.stringify({ pinHash, name: employee.Name }));

    // Email με τα credentials — no-op αν λείπουν EMAIL_RELAY_URL/EMAIL_RELAY_SECRET
    // (βλ. src/email.js). Το PIN επιστρέφεται ΠΑΝΤΑ στην απάντηση ώστε το UI
    // να το δείχνει μία φορά on-screen ως fallback όσο το email μπλοκάρει.
    let emailResult = { skipped: "no email" };
    if (employee.Email) {
      const actorName = actorNameFromAuth(auth);
      // Huskies credentials — προαιρετικά (ρητή απόφαση χρήστη 24/08/2026),
      // αν δόθηκαν στη φόρμα «Νέος Τεχνικός» στέλνονται ΜΑΖΙ με τα portal
      // credentials, στο ίδιο email (ρητή απαίτηση χρήστη — "να στέλνονται
      // μαζί με τα credentials του portal").
      const welcomeRows = [
        ["Κωδικός υπαλλήλου", employee.EmployeeID],
        ["PIN", pin],
      ];
      if (employee.HuskiesUsername || employee.HuskiesPassword) {
        welcomeRows.push(["Huskies — Username", employee.HuskiesUsername || "—"]);
        welcomeRows.push(["Huskies — Password", employee.HuskiesPassword || "—"]);
      }
      emailResult = await sendEmail(env, {
        to: [employee.Email],
        subject: "Τα στοιχεία σύνδεσής σου στο OptikiTec Portal",
        html: emailTemplate({
          badge: "Καλωσόρισμα",
          badgeColor: "green",
          title: "Καλωσήρθες στο OptikiTec Portal",
          intro: `Δημιουργήθηκε λογαριασμός για εσένα, ${employee.Name}. Χρησιμοποίησε αυτά τα στοιχεία για να συνδεθείς.`,
          rows: welcomeRows,
          ctaText: "Σύνδεση στο Portal",
          ctaUrl: PORTAL_URL,
          footer: "Κράτησε το PIN ασφαλές.",
        }),
        replyTo: auth.email,
        replyToName: actorName,
      });
      await logEmailFailure(env, "new_technician_email_failed", auth.email, emailResult, { employeeId: employee.EmployeeID, to: employee.Email });
    }

    return json({ success: true, employee, pin, emailSent: !!emailResult.success });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Ανέβασμα ενός από τα 3 συνημμένα τεχνικού (βιογραφικό, ταυτότητα/
 * διαβατήριο, άδεια διαμονής) — ίδιο gate με «Νέος Τεχνικός»
 * (requireTeamLeaderOrBackoffice), ίδιο μοτίβο raw-bytes upload με
 * /api/leaves/attachment/upload. `docType` στο query string ∈ {cv, id, residence}.
 */
async function handleEmployeeDocumentUpload(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;

  const params = new URL(request.url).searchParams;
  const employeeId = params.get("employeeId");
  const docType = params.get("docType");
  const filename = params.get("filename") || "έγγραφο";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!employeeId) return json({ error: "Χρειάζεται employeeId." }, 400);
  if (!docType) return json({ error: "Χρειάζεται docType." }, 400);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενό αρχείο." }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "Το αρχείο είναι πολύ μεγάλο (μέγιστο 20MB)." }, 400);
    const result = await uploadEmployeeDocument(env, { employeeId, docType, bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Λήψη συνημμένου τεχνικού — ΜΟΝΟ TL+Director (requireTeamLeader, ΟΧΙ
 * requireTeamLeaderOrBackoffice) — ρητή απόφαση χρήστη λόγω ευαισθησίας
 * δεδομένων (ΑΜΚΑ/ταυτότητα/άδεια διαμονής), ίδιο gate με το tab «Προφίλ
 * Τεχνικού» όπου εμφανίζονται οι σύνδεσμοι λήψης.
 */
async function handleEmployeeDocumentFile(request, env, params) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const employeeId = params.get("employeeId");
  const docType = params.get("docType");
  if (!employeeId || !docType) return json({ error: "Χρειάζεται employeeId και docType." }, 400);

  try {
    const file = await getEmployeeDocument(env, employeeId, docType);
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε." }, 404);
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Reset PIN τεχνικού ("Ξέχασες τον κωδικό;", item #5 — ρητή απαίτηση
 * χρήστη). Staff-assisted ΜΟΝΟ (καμία self-service φόρμα στο login) —
 * καλείται πλέον ΑΠΟΚΛΕΙΣΤΙΚΑ από το tab «Προφίλ Τεχνικού» (κουμπί δίπλα στο
 * Ενεργοποίηση/Απενεργοποίηση). ΑΝΑΘΕΩΡΗΘΗΚΕ 15/08/2026, ρητή απαίτηση
 * χρήστη: η παλιά ξεχωριστή κάρτα στο "Νέος Τεχνικός" αφαιρέθηκε, άρα το
 * gate έγινε αυστηρότερο requireTeamLeader (πριν requireTeamLeaderOrBackoffice)
 * — το Backoffice ΔΕΝ έχει πρόσβαση στο «Προφίλ Τεχνικού» (βλ. CLAUDE.md
 * §Ρόλοι § Backoffice) άρα χάνει σκόπιμα και τη δυνατότητα reset PIN, ρητή
 * απόφαση χρήστη. Χωρίς περιορισμό ανά ομάδα (ένας TL μπορεί να κάνει reset
 * σε ΟΠΟΙΟΝΔΗΠΟΤΕ τεχνικό, όχι μόνο τη δική του ομάδα — συνεπές με τη
 * γενικότερη 15/08/2026 απόφαση "ο TL να βλέπει όλες τις ομάδες" στο ίδιο
 * tab). Self-service μέσω email αποφασίστηκε ΡΗΤΑ να ΜΗΝ γίνει: πολλοί
 * τεχνικοί μοιράζονται το ίδιο placeholder email στην πράξη (βλ. σχόλιο στο
 * getAllTechniciansAvailability), οπότε ένα ανοιχτό "δώσε EmployeeID, πάρε
 * PIN με email" θα επέτρεπε σε κάποιον να πάρει το PIN συναδέλφου που
 * μοιράζεται το ίδιο inbox. Αν/όταν όλοι αποκτήσουν μοναδικό εταιρικό
 * email, το self-service γίνεται ασφαλές by design και μπορεί να
 * προστεθεί τότε (βλ. CLAUDE.md §Εκκρεμότητες).
 */
async function handleResetPinInfo(request, env) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  try {
    // Ανενεργοί αποκλείονται (item #5, 13/08/2026) — δεν έχει νόημα reset PIN
    // για κάποιον που έτσι κι αλλιώς έχει μπλοκαρισμένο login.
    const technicians = (await getTechniciansPool(env)).filter((t) => t.Status !== "Ανενεργός");
    return json({
      technicians: technicians.map((t) => ({ EmployeeID: t.EmployeeID, Name: t.Name, Team: t.Team })),
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleResetPin(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }

  const { employeeId } = body || {};
  if (!employeeId) return json({ error: "Χρειάζεται κωδικός τεχνικού." }, 400);

  try {
    const employee = await getEmployeeById(env, employeeId);
    if (!employee) return json({ error: "Ο τεχνικός δεν βρέθηκε." }, 400);

    // Ίδιος μηχανισμός με handleEmployeesCreate — νέο τυχαίο 4ψήφιο PIN,
    // αντικαθιστά ό,τι υπήρχε στο KV για αυτό το EmployeeID.
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const pinHash = await hashPin(employee.EmployeeID, pin, env.LINK_SECRET);
    await env.TECHNICIAN_AUTH.put(`emp:${employee.EmployeeID}`, JSON.stringify({ pinHash, name: employee.Name }));
    await appendAuditLog(env, "technician_pin_reset", leader.Email, { employeeId: employee.EmployeeID, name: employee.Name });

    // Email με το νέο PIN — no-op αν λείπουν EMAIL_RELAY_URL/EMAIL_RELAY_SECRET
    // ή αν ο τεχνικός δεν έχει καταχωρημένο email. Το PIN επιστρέφεται ΠΑΝΤΑ
    // στην απάντηση ώστε το UI να το δείχνει μία φορά on-screen ως fallback.
    let emailResult = { skipped: "no email" };
    if (employee.Email) {
      const actorName = leader.Name || leader.Email;
      emailResult = await sendEmail(env, {
        to: [employee.Email],
        subject: "Νέος κωδικός σύνδεσης (PIN) — OptikiTec Portal",
        html: emailTemplate({
          badge: "Reset PIN",
          badgeColor: "blue",
          title: "Ο κωδικός σύνδεσής σου άλλαξε",
          intro: `Ο/Η ${actorName} έκανε reset στο PIN σου. Χρησιμοποίησε το νέο PIN για να συνδεθείς.`,
          rows: [
            ["Κωδικός υπαλλήλου", employee.EmployeeID],
            ["Νέο PIN", pin],
          ],
          ctaText: "Σύνδεση στο Portal",
          ctaUrl: PORTAL_URL,
          footer: "Αν δεν το ζήτησες εσύ, επικοινώνησε άμεσα με τον Team Leader σου.",
        }),
        replyTo: leader.Email,
        replyToName: actorName,
      });
      await logEmailFailure(env, "reset_pin_email_failed", leader.Email, emailResult, { employeeId: employee.EmployeeID, to: employee.Email });
    }

    return json({
      success: true,
      employee: { EmployeeID: employee.EmployeeID, Name: employee.Name },
      pin,
      emailSent: !!emailResult.success,
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Ενεργός/Ανενεργός τεχνικός (item #5, 13/08/2026, ρητή απαίτηση χρήστη) —
 * μόνο TL/Director (requireTeamLeader, αποκλείει Backoffice, ρητή απόφαση
 * χρήστη μετά από ερώτηση πριν την υλοποίηση). Καλείται από το tab «Προφίλ
 * Τεχνικού» (ήδη gated με requireTeamLeader, βλ. handleEmployeeProfile).
 */
async function handleEmployeeStatus(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId, status } = body || {};

  try {
    const result = await setEmployeeStatus(env, { employeeId, status, actorEmail: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Backoffice-only: αναλυτική διαθεσιμότητα ΟΛΩΝ των τεχνικών, όλες οι
 * ομάδες — ποιος είναι σε άδεια σήμερα + επερχόμενες άδειες 30 ημερών.
 * Read-only, ρητή απαίτηση χρήστη (βλ. CLAUDE.md, refine του decision #1).
 */
async function handleBackofficeAvailability(request, env) {
  const { error } = await requireBackoffice(request, env);
  if (error) return error;

  try {
    const groups = await getAllTechniciansAvailability(env, { withinDays: 30 });
    return json({ groups });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Director-only: read-only προβολή του φύλλου AuditLog (ρητή απαίτηση
 * χρήστη, πρόταση #1 — μέχρι τώρα οι καταγραφές appendAuditLog ήταν ορατές
 * μόνο ανοίγοντας απευθείας το Google Sheet). Πιο πρόσφατα πρώτα.
 */
async function handleAuditLog(request, env) {
  const { error } = await requireDirector(request, env);
  if (error) return error;

  try {
    const entries = await getAuditLog(env, { limit: 300 });
    return json({ entries });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Χάρτης δράσεων -> {κατηγορία, επιτρεπόμενοι ρόλοι, human-readable label} για
 * το widget «Τελευταία δραστηριότητα» της Αρχικής (βλ. handleDashboardActivity
 * παρακάτω). Δράσεις που ΔΕΝ υπάρχουν εδώ αγνοούνται σιωπηλά — π.χ.
 * technician_pin_reset, employee_status_changed, leave_attachment_uploaded,
 * availability_answer_submitted, οποιοδήποτε *_email_failed.
 */
const ACTIVITY_ACTION_META = {
  fleet_add: { category: "Στόλος", roles: ["leader", "director"], label: (d) => `Νέο όχημα${d.plate ? ` ${d.plate}` : ""}` },
  fleet_update: { category: "Στόλος", roles: ["leader", "director"], label: () => "Ενημέρωση στοιχείων οχήματος" },
  fleet_delete: { category: "Στόλος", roles: ["leader", "director"], label: (d) => `Διαγραφή οχήματος${d.plate ? ` ${d.plate}` : ""}` },
  vehicle_accident_report: { category: "Στόλος", roles: ["leader", "director"], label: (d) => `Καταγραφή ατυχήματος${d.plate ? ` – ${d.plate}` : ""}` },
  equipment_add: { category: "Εξοπλισμός", roles: ["leader", "director"], label: (d) => `Νέο αντικείμενο${d.name ? ` «${d.name}»` : ""}` },
  equipment_update: { category: "Εξοπλισμός", roles: ["leader", "director"], label: () => "Ενημέρωση αντικειμένου" },
  equipment_delete: { category: "Εξοπλισμός", roles: ["leader", "director"], label: (d) => `Διαγραφή αντικειμένου${d.name ? ` «${d.name}»` : ""}` },
  sim_add: { category: "SIMs", roles: ["leader", "director"], label: (d) => `Νέα κάρτα SIM${d.cardNumber ? ` «${d.cardNumber}»` : ""}` },
  sim_update: { category: "SIMs", roles: ["leader", "director"], label: () => "Ενημέρωση κάρτας SIM" },
  sim_delete: { category: "SIMs", roles: ["leader", "director"], label: (d) => `Διαγραφή κάρτας SIM${d.cardNumber ? ` «${d.cardNumber}»` : ""}` },
  epass_add: { category: "e-pass", roles: ["leader", "director"], label: (d) => `Νέα κάρτα e-pass${d.label ? ` «${d.label}»` : ""}` },
  epass_update: { category: "e-pass", roles: ["leader", "director"], label: () => "Ενημέρωση e-pass" },
  epass_delete: { category: "e-pass", roles: ["leader", "director"], label: (d) => `Διαγραφή e-pass${d.label ? ` «${d.label}»` : ""}` },
  charge_open: { category: "Χρεώσεις", roles: ["leader", "director"], label: (d) => `Χρέωση ${d.type || "αντικειμένου"}${d.itemLabel ? ` – ${d.itemLabel}` : ""}` },
  handover_document_created: { category: "Παράδοση", roles: ["leader", "director"], label: () => "Δημιουργία εγγράφου παράδοσης" },
  document_created: { category: "Έγγραφα", roles: ["leader", "director"], label: (d) => `Νέο έγγραφο${d.docType ? `: ${d.docType}` : ""}` },
  handover_document_signed: { category: "Παράδοση", roles: ["leader", "director"], label: () => "Υπογραφή εγγράφου παράδοσης" },
  availability_query_created: { category: "Ανακοινώσεις", roles: ["leader", "director"], label: () => "Νέο ερώτημα διαθεσιμότητας" },
  availability_query_updated: { category: "Ανακοινώσεις", roles: ["leader", "director"], label: () => "Επεξεργασία ερωτήματος διαθεσιμότητας" },
  availability_query_deleted: { category: "Ανακοινώσεις", roles: ["leader", "director"], label: () => "Διαγραφή ερωτήματος διαθεσιμότητας" },
  crews_saved: { category: "Συνεργεία", roles: ["backoffice", "director"], label: (d) => `Αποθήκευση σύνθεσης συνεργείων${d.crewCount ? ` (${d.crewCount} τεχνικοί)` : ""}` },
  announcement_created: { category: "Ενημερώσεις", roles: ["leader", "backoffice", "director"], label: (d) => `Νέα ενημέρωση${d.title ? ` «${d.title}»` : ""}` },
  announcement_deleted: { category: "Ενημερώσεις", roles: ["leader", "backoffice", "director"], label: (d) => `Διαγραφή ενημέρωσης${d.title ? ` «${d.title}»` : ""}` },
  employee_created: { category: "Προσωπικό", roles: ["leader", "backoffice", "director"], label: (d) => `Νέος τεχνικός${d.name ? ` – ${d.name}` : ""}` },
  leave_submitted: { category: "Άδειες", roles: ["director"], label: (d) => `Νέα αίτηση άδειας${d.days ? ` (${d.days} ημ.)` : ""}` },
  leave_decided: { category: "Άδειες", roles: ["director"], label: (d) => (d.decision === "Εγκρίθηκε" ? "Έγκριση αίτησης άδειας" : "Απόρριψη αίτησης άδειας") },
  leave_decided_group: { category: "Άδειες", roles: ["director"], label: (d) => `${d.decision === "Εγκρίθηκε" ? "Έγκριση" : "Απόρριψη"} τηλεργασίας${d.count ? ` (${d.count} ημ.)` : ""}` },
  leave_deleted: { category: "Άδειες", roles: ["director"], label: () => "Διαγραφή αίτησης άδειας" },
  telework_submitted: { category: "Άδειες", roles: ["director"], label: (d) => `Δήλωση τηλεργασίας${(d.dates || []).length ? ` (${d.dates.length} ημ.)` : ""}` },
};

/**
 * Αρχική: «Τελευταία δραστηριότητα» — μικρή, επιμελημένη προβολή του
 * AuditLog (ΟΧΙ το πλήρες raw log, βλ. handleAuditLog παραπάνω). Ρητή
 * απαίτηση χρήστη (18/08/2026). Το φιλτράρισμα ανά ρόλο (βλ.
 * ACTIVITY_ACTION_META) είναι σχεδιαστική απόφαση Claude — καμία νέα
 * ορατότητα πέρα από όσα ήδη βλέπει ο ρόλος κάπου αλλού στο portal.
 */
async function handleDashboardActivity(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;
  const role = auth.staffRole;

  try {
    const entries = await getAuditLog(env, { limit: 80 });
    const curated = entries.filter((e) => {
      const meta = ACTIVITY_ACTION_META[e.Action];
      return meta && meta.roles.includes(role);
    });
    const top = curated.slice(0, 8);

    // Batch email->όνομα, μία ανάγνωση ανά φύλλο (όχι ανά εγγραφή) — ίδια
    // πηγή/προτεραιότητα με resolveActorName() (src/email.js).
    const [leaders, backoffice, employees] = await Promise.all([
      readSheetAsObjects(env, "TeamLeaders").catch(() => []),
      readSheetAsObjects(env, "Backoffice").catch(() => []),
      readSheetAsObjects(env, "Υπάλληλοι").catch(() => []),
    ]);
    const nameByEmail = new Map();
    for (const list of [leaders, backoffice, employees]) {
      for (const row of list) {
        if (row.Email && !nameByEmail.has(row.Email)) nameByEmail.set(row.Email, row.Name);
      }
    }

    const result = top.map((e) => {
      const meta = ACTIVITY_ACTION_META[e.Action];
      let details = {};
      try {
        details = JSON.parse(e.Details || "{}");
      } catch (err) {
        details = {};
      }
      return {
        actor: nameByEmail.get(e.User) || e.User || "—",
        label: meta.label(details),
        category: meta.category,
        at: e.Timestamp,
      };
    });

    return json({ entries: result });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Director-only: λίστα διαθέσιμων backups (μεταδεδομένα μόνο — ημερομηνία,
 * μέγεθος κλπ, όχι το πλήρες περιεχόμενο). Βλ. src/backup.js.
 */
async function handleBackupsList(request, env) {
  const { error } = await requireDirector(request, env);
  if (error) return error;
  try {
    const backups = await listSheetBackups(env);
    return json({ backups });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Director-only: χειροκίνητη δημιουργία backup τώρα, πέρα από το καθημερινό
 * cron (03:00 UTC) — π.χ. πριν από μια ρισκαρισμένη μαζική αλλαγή.
 */
async function handleBackupCreate(request, env) {
  const { director, error } = await requireDirector(request, env);
  if (error) return error;
  try {
    const result = await createSheetBackup(env, { triggeredBy: (director && director.Email) || "director" });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Director-only: λήψη ενός backup ως αρχείο JSON για download.
 */
async function handleBackupDownload(request, env, params) {
  const { error } = await requireDirector(request, env);
  if (error) return error;
  const date = params.get("date");
  if (!date) return json({ error: "Χρειάζεται date." }, 400);
  try {
    const raw = await getSheetBackupRaw(env, date);
    if (!raw) return json({ error: "Το backup δεν βρέθηκε." }, 404);
    return new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="optikitec-backup-${date}.json"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// FLEET API — κοινός στόλος οχημάτων, μόνο για Team Leaders (πλήρες CRUD)
// ============================================================

/**
 * Επαληθεύει ότι ο συνδεδεμένος χρήστης είναι staff ΚΑΙ καταχωρημένος TL —
 * Ή Director (πλήρης εποπτεία, βλ. resolveStaffRole). Ο Director περνάει
 * κάτω από το ΙΔΙΟ κλειδί `leader`, ώστε όλα τα endpoints TL (fleet,
 * equipment, epass, άδειες ομάδας κλπ) να δουλεύουν αυτόματα και για
 * Director, χωρίς άλλη αλλαγή. Επιστρέφει το leader/director row ή null.
 */
async function requireTeamLeader(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "staff") return { error: json({ error: "Δεν έχεις συνδεθεί." }, 401) };
  const leader = await getTeamLeaderByEmail(env, identity.email);
  if (leader) return { leader };
  const director = await getDirectorByEmail(env, identity.email);
  if (director) return { leader: director };
  return { error: json({ error: "Ο λογαριασμός σου δεν είναι καταχωρημένος ως Team Leader." }, 403) };
}

/** Team Leader Ή Backoffice Ή Director — π.χ. για προσθήκη νέου τεχνικού, που επιτρέπεται και στους τρεις ρόλους */
async function requireTeamLeaderOrBackoffice(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "staff") return { error: json({ error: "Δεν έχεις συνδεθεί." }, 401) };

  const leader = await getTeamLeaderByEmail(env, identity.email);
  if (leader) return { staffRole: "leader", leader, email: identity.email };

  const backoffice = await getBackofficeByEmail(env, identity.email);
  if (backoffice) return { staffRole: "backoffice", backoffice, email: identity.email };

  const director = await getDirectorByEmail(env, identity.email);
  if (director) return { staffRole: "director", director, email: identity.email };

  return { error: json({ error: "Δεν έχεις δικαίωμα πρόσβασης." }, 403) };
}

/**
 * Ρητός περιορισμός σε ΕΝΑ συγκεκριμένο email — μοναδική εξαίρεση στο πρότυπο
 * role-based gating του υπόλοιπου portal (requireDirector/requireTeamLeader
 * κλπ. δεν κοιτάνε ΠΟΤΕ συγκεκριμένο άτομο, μόνο ρόλο). Ρητή απαίτηση χρήστη
 * (19/08/2026): το κουμπί «Μαζική αποστολή καλωσορίσματος» (βλ.
 * handleBulkWelcomeTechnicians/handleBulkWelcomeStaff παρακάτω, UI στο
 * hub.html -> renderNewTechnician) πρέπει να είναι ορατό/χρησιμοποιήσιμο ΜΟΝΟ
 * σε αυτόν — εφάπαξ ενέργεια (μαζικό PIN reset τεχνικών), όχι μόνιμο εργαλείο
 * για κάθε Director. Το server-side check εδώ είναι η πραγματική προστασία·
 * το client-side hide στο hub.html είναι απλά UX, όχι ασφάλεια.
 */
const BULK_WELCOME_OWNER_EMAIL = "s.xronis@optikitec.gr";

async function requireBulkWelcomeOwner(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "staff") return { error: json({ error: "Δεν έχεις συνδεθεί." }, 401) };
  if (identity.email !== BULK_WELCOME_OWNER_EMAIL) {
    return { error: json({ error: "Δεν έχεις δικαίωμα πρόσβασης." }, 403) };
  }
  const director = await getDirectorByEmail(env, identity.email);
  return { email: identity.email, name: (director && director.Name) || identity.email };
}

/** Αυστηρά μόνο Director (όχι TL/Backoffice) — π.χ. για το ιστορικό ενεργειών (AuditLog), δεν έχει νόημα να το βλέπουν όλοι */
async function requireDirector(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "staff") return { error: json({ error: "Δεν έχεις συνδεθεί." }, 401) };
  const director = await getDirectorByEmail(env, identity.email);
  if (director) return { director };
  return { error: json({ error: "Μόνο για Director." }, 403) };
}

/** Μόνο Backoffice — Ή Director (πλήρης εποπτεία) — π.χ. για την αναλυτική διαθεσιμότητα τεχνικών (όλες οι ομάδες) */
async function requireBackoffice(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "staff") return { error: json({ error: "Δεν έχεις συνδεθεί." }, 401) };
  const backoffice = await getBackofficeByEmail(env, identity.email);
  if (backoffice) return { backoffice };
  const director = await getDirectorByEmail(env, identity.email);
  if (director) return { backoffice: director };
  return { error: json({ error: "Μόνο για Backoffice." }, 403) };
}

/** Εμφανιζόμενο όνομα από ένα auth αντικείμενο (leader/backoffice/director) — ανεξάρτητο ρόλου */
function actorNameFromAuth(auth) {
  return (auth.leader && auth.leader.Name) || (auth.backoffice && auth.backoffice.Name) || (auth.director && auth.director.Name) || auth.email;
}

/**
 * Tab «Αναλυτικά»/KPI — ίδιο gate requireTeamLeader με το Στόλος/Εξοπλισμός
 * (καλύπτει αυτόματα και Director). Εταιρικά στοιχεία, ΟΧΙ scoped ανά ομάδα
 * TL — ρητή απαίτηση χρήστη: οι TL βλέπουν τα ΙΔΙΑ στοιχεία με τον Director.
 */
async function handleAnalyticsKpi(request, env) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;
  try {
    const summary = await getKpiSummary(env);
    return json(summary);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetList(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;
  try {
    const [vehicles, drivers, types, epassMap] = await Promise.all([
      listVehicles(env),
      listDrivers(env),
      listVehicleTypes(env),
      listVehicleEpassMap(env),
    ]);
    // EpassLabel: μη-κενό αν το όχημα έχει ΤΩΡΑ e-pass ανατεθειμένο πάνω του
    // (βλ. listVehicleEpassMap στο src/fleet.js) — για τη νέα στήλη "e-pass".
    const vehiclesWithEpass = vehicles.map((v) => ({ ...v, EpassLabel: epassMap[v.ID] || "" }));
    return json({ vehicles: vehiclesWithEpass, drivers, types });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetAdd(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { plate, type, assignedTo, status, serviceNote, kteoDate, serviceDate, deductible, currentMileage, insuranceCompany, policyNumber, insuranceRenewalDate } = body || {};
  try {
    const result = await addVehicle(env, { plate, type, assignedTo, status, serviceNote, kteoDate, serviceDate, deductible, currentMileage, insuranceCompany, policyNumber, insuranceRenewalDate, updatedBy: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetUpdate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { vehicleId, plate, type, assignedTo, status, serviceNote, kteoDate, serviceDate, deductible, currentMileage, insuranceCompany, policyNumber, insuranceRenewalDate } = body || {};
  if (!vehicleId) return json({ error: "Χρειάζεται vehicleId." }, 400);
  try {
    const result = await updateVehicle(env, vehicleId, { plate, type, assignedTo, status, serviceNote, kteoDate, serviceDate, deductible, currentMileage, insuranceCompany, policyNumber, insuranceRenewalDate }, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetDelete(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { vehicleId } = body || {};
  if (!vehicleId) return json({ error: "Χρειάζεται vehicleId." }, 400);
  try {
    const result = await deleteVehicle(env, vehicleId, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// ΑΤΥΧΗΜΑΤΑ ΟΧΗΜΑΤΩΝ — ίδιο gate requireTeamLeader (TL ή Director) με το
// υπόλοιπο tab Στόλος. Ξεχωριστό, προαιρετικό συμβάν (ρητή απόφαση χρήστη).
// ============================================================

async function handleFleetAccidentReport(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { vehicleId, employeeId, date, comments } = body || {};
  if (!vehicleId) return json({ error: "Χρειάζεται vehicleId." }, 400);
  try {
    const result = await reportVehicleAccident(env, { vehicleId, employeeId, date, comments, reportedBy: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetAccidentsList(request, env) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const vehicleId = new URL(request.url).searchParams.get("vehicleId");
  if (!vehicleId) return json({ error: "Χρειάζεται vehicleId." }, 400);
  try {
    const accidents = await listVehicleAccidents(env, vehicleId);
    return json({ accidents });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetAccidentAttachmentUpload(request, env) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const params = new URL(request.url).searchParams;
  const accidentId = params.get("accidentId");
  const filename = params.get("filename") || "συμβάν";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!accidentId) return json({ error: "Χρειάζεται accidentId." }, 400);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενό αρχείο." }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "Το αρχείο είναι πολύ μεγάλο (μέγιστο 20MB)." }, 400);
    const result = await uploadAccidentAttachment(env, { accidentId, bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleFleetAccidentAttachmentFile(request, env, params) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const accidentId = params.get("accidentId");
  if (!accidentId) return json({ error: "Χρειάζεται accidentId." }, 400);
  try {
    const file = await getAccidentAttachment(env, accidentId);
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε." }, 404);
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// ΠΑΡΑΛΑΒΗ ΟΧΗΜΑΤΟΣ — χιλιόμετρα + πολλαπλές φωτογραφίες, συμπληρώνεται
// από τον ΙΔΙΟ τον τεχνικό (ρητή απόφαση χρήστη). Η ιδιοκτησία της
// χρέωσης ελέγχεται μέσα στο src/assignments.js (EmployeeID === resolved
// employeeId) — εδώ μόνο resolveIdentity/resolveEmployeeId.
// ============================================================

async function handleChargePickupMileage(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { chargeId, mileage } = body || {};
  if (!chargeId) return json({ error: "Χρειάζεται chargeId." }, 400);
  try {
    const result = await setVehiclePickupMileage(env, { chargeId, employeeId, mileage });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Καταγραφή χιλιομέτρων επιστροφής — ίδιο μοτίβο/gate με την παραλαβή
 * παραπάνω (ο ίδιος ο τεχνικός, session-based). Ρητή απαίτηση χρήστη: η
 * επιστροφή καταγράφεται όποτε τη συμπληρώσει ο τεχνικός, ανεξάρτητα από
 * το αν η χρέωση είναι ακόμα ανοιχτή στο σύστημα (βλ. setVehicleReturnMileage).
 */
async function handleChargeReturnMileage(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { chargeId, mileage } = body || {};
  if (!chargeId) return json({ error: "Χρειάζεται chargeId." }, 400);
  try {
    const result = await setVehicleReturnMileage(env, { chargeId, employeeId, mileage });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleChargePickupPhotoUpload(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);

  const params = new URL(request.url).searchParams;
  const chargeId = params.get("chargeId");
  const filename = params.get("filename") || "φωτογραφία.jpg";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!chargeId) return json({ error: "Χρειάζεται chargeId." }, 400);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενό αρχείο." }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "Το αρχείο είναι πολύ μεγάλο (μέγιστο 20MB)." }, 400);
    const result = await uploadVehiclePickupPhoto(env, { chargeId, employeeId, bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Λήψη φωτογραφίας παραλαβής — ο ίδιος ο τεχνικός (owner της χρέωσης) Ή
 * TL/Director. Το getVehiclePickupPhoto() επιστρέφει chargeEmployeeId ώστε
 * να ελέγξουμε εδώ ποιος ζητάει τη λήψη, ίδιο σκεπτικό με τα υπόλοιπα
 * συνημμένα (owner + staff gate μαζί).
 */
async function handleChargePickupPhotoFile(request, env, params) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const chargeId = params.get("chargeId");
  const fileKey = params.get("fileKey");
  if (!chargeId || !fileKey) return json({ error: "Χρειάζεται chargeId και fileKey." }, 400);

  try {
    const file = await getVehiclePickupPhoto(env, { chargeId, fileKey });
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε." }, 404);

    let authorized = false;
    if (identity.type === "technician" && String(identity.employeeId) === String(file.chargeEmployeeId)) {
      authorized = true;
    } else if (identity.type === "staff") {
      const leader = await getTeamLeaderByEmail(env, identity.email);
      const director = leader ? null : await getDirectorByEmail(env, identity.email);
      if (leader || director) authorized = true;
    }
    if (!authorized) return json({ error: "Δεν έχεις πρόσβαση σε αυτή τη φωτογραφία." }, 403);

    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Ανέβασμα φωτογραφίας κοντέρ (χιλιομετρητή) — ΞΕΧΩΡΙΣΤΟ υποχρεωτικό πεδίο
 * από τις γενικές φωτογραφίες παραλαβής (item #1 «Προς Συζήτηση», 15/08/2026,
 * ρητή απαίτηση χρήστη). `which` = "pickup" ή "return", καθορίζει ποια από
 * τις 2 ενέργειες/στήλες αφορά — ίδιο session-based owner gate με τα
 * υπόλοιπα charges/pickup endpoints.
 */
async function handleChargeOdometerPhotoUpload(request, env, which) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);

  const params = new URL(request.url).searchParams;
  const chargeId = params.get("chargeId");
  const filename = params.get("filename") || "κοντέρ.jpg";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!chargeId) return json({ error: "Χρειάζεται chargeId." }, 400);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενό αρχείο." }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "Το αρχείο είναι πολύ μεγάλο (μέγιστο 20MB)." }, 400);
    const uploadFn = which === "return" ? uploadOdometerReturnPhoto : uploadOdometerPickupPhoto;
    const result = await uploadFn(env, { chargeId, employeeId, bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Λήψη φωτογραφίας κοντέρ — ο ίδιος ο τεχνικός (owner της χρέωσης) Ή
 * TL/Director, ίδιο dual-auth gate με handleChargePickupPhotoFile.
 * `which` query param: "pickup" (προεπιλογή) ή "return".
 */
async function handleChargeOdometerPhotoFile(request, env, params) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const chargeId = params.get("chargeId");
  const which = params.get("which") === "return" ? "return" : "pickup";
  if (!chargeId) return json({ error: "Χρειάζεται chargeId." }, 400);

  try {
    const file = await getOdometerPhoto(env, { chargeId, which });
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε." }, 404);

    let authorized = false;
    if (identity.type === "technician" && String(identity.employeeId) === String(file.chargeEmployeeId)) {
      authorized = true;
    } else if (identity.type === "staff") {
      const leader = await getTeamLeaderByEmail(env, identity.email);
      const director = leader ? null : await getDirectorByEmail(env, identity.email);
      if (leader || director) authorized = true;
    }
    if (!authorized) return json({ error: "Δεν έχεις πρόσβαση σε αυτή τη φωτογραφία." }, 403);

    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// EQUIPMENT API — κοινή λίστα εξοπλισμού/αντικειμένων προς χρέωση, μόνο για
// Team Leaders (πλήρες CRUD). ΔΕΝ είναι στα 5 Access-protected paths (ίδιο
// σκεπτικό με /api/employees/create) — session-based requireTeamLeader.
// ============================================================

async function handleEquipmentList(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;
  try {
    const [items, drivers, categories] = await Promise.all([listEquipment(env), listEquipmentDrivers(env), listEquipmentCategories(env)]);
    return json({ items, drivers, categories });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEquipmentAdd(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { name, category, assignedTo, status, note, serialNumber, model, imei } = body || {};
  try {
    const result = await addEquipment(env, { name, category, assignedTo, status, note, serialNumber, model, imei, updatedBy: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEquipmentUpdate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { itemId, name, category, assignedTo, status, note, serialNumber, model, imei } = body || {};
  if (!itemId) return json({ error: "Χρειάζεται itemId." }, 400);
  try {
    const result = await updateEquipment(env, itemId, { name, category, assignedTo, status, note, serialNumber, model, imei }, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEquipmentDelete(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { itemId } = body || {};
  if (!itemId) return json({ error: "Χρειάζεται itemId." }, 400);
  try {
    const result = await deleteEquipment(env, itemId, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Στοιχεία τεχνικού + ό,τι έχει ΤΩΡΑ πάνω του (οχήματα+εξοπλισμός+e-pass) —
 * για την αναζήτηση στο tab Εξοπλισμός + το PDF παράδοσης/παραλαβής
 * (browser print, βλ. hub.html). Βλ. src/assignments.js, getTechnicianHoldings.
 */
async function handleEquipmentTechnicianHoldings(request, env, searchParams) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const employeeId = searchParams.get("employeeId");
  if (!employeeId) return json({ error: "Χρειάζεται employeeId." }, 400);
  try {
    const result = await getTechnicianHoldings(env, employeeId);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// SIMs (05/09/2026) — κάρτες SIM: αριθμός κάρτας/PIN/PUK/σε ποιο tablet
// είναι τοποθετημένη. Ίδιο απλό CRUD μοτίβο με το Εξοπλισμό, ίδιο gate
// requireTeamLeader (TL+Director, ΟΧΙ Backoffice) — βλ. src/sims.js.
// ============================================================

async function handleSimsList(request, env) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;
  try {
    // Το dropdown "Tablet" αντλείται πλέον από το φύλλο Εξοπλισμός (ρητή
    // απαίτηση χρήστη, 05/09/2026, ΑΝΑΘΕΩΡΕΙ το αρχικό ελεύθερο dropdown) —
    // κάθε αντικείμενο εξοπλισμού με Category που περιέχει "tablet"
    // (case-insensitive, ίδιο ελεύθερο πεδίο Category με το tab Εξοπλισμός,
    // καμία hardcoded λίστα). Reuse του ήδη υπάρχοντος listEquipment().
    // Το εμφανιζόμενο κείμενο δείχνει ΜΟΝΟ τον Σειριακό Αριθμό (ρητή
    // απαίτηση χρήστη, 05/09/2026, ΑΝΑΘΕΩΡΕΙ το ενδιάμεσο "Όνομα — ΣΝ: ...")
    // — αντικείμενα εξοπλισμού κατηγορίας "tablet" ΧΩΡΙΣ καταχωρημένο
    // σειριακό αριθμό αποκλείονται από το dropdown (δεν μπορούν να
    // αναγνωριστούν έτσι) — παραμένει η επιλογή «Άλλο tablet...» για αυτά.
    const [items, equipmentItems] = await Promise.all([listSims(env), listEquipment(env)]);
    const tablets = Array.from(
      new Set(
        equipmentItems
          .filter((i) => (i.Category || "").toLowerCase().includes("tablet"))
          .map((i) => (i.SerialNumber || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "el"));
    return json({ items, tablets });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleSimsAdd(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { cardNumber, pin, puk, tablet, note } = body || {};
  try {
    const result = await addSim(env, { cardNumber, pin, puk, tablet, note, updatedBy: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleSimsUpdate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { simId, cardNumber, pin, puk, tablet, note } = body || {};
  if (!simId) return json({ error: "Χρειάζεται simId." }, 400);
  try {
    const result = await updateSim(env, simId, { cardNumber, pin, puk, tablet, note }, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleSimsDelete(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { simId } = body || {};
  if (!simId) return json({ error: "Χρειάζεται simId." }, 400);
  try {
    const result = await deleteSim(env, simId, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// ΨΗΦΙΑΚΗ ΥΠΟΓΡΑΦΗ ΕΓΓΡΑΦΟΥ ΠΑΡΑΔΟΣΗΣ/ΠΑΡΑΛΑΒΗΣ (15/08/2026) — βλ.
// src/handover.js για την πλήρη ροή/σχεδιασμό. Ίδιο gate requireTeamLeader
// με το technician-holdings (TL ή Director) για δημιουργία/ιστορικό·
// υπογραφή/λήψη δικού του εγγράφου γίνεται από τον ίδιο τον τεχνικό
// (session-based, ίδιο μοτίβο με τα charges/pickup/* endpoints).
// ============================================================

async function handleHandoverCreate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId } = body || {};
  if (!employeeId) return json({ error: "Χρειάζεται employeeId." }, 400);

  try {
    const result = await createHandoverDocument(env, { employeeId, createdBy: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Ιστορικό εγγράφων ενός τεχνικού — TL/Director, από την «Αναζήτηση τεχνικού» στο tab Εξοπλισμός */
async function handleHandoverList(request, env, searchParams) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const employeeId = searchParams.get("employeeId");
  if (!employeeId) return json({ error: "Χρειάζεται employeeId." }, 400);
  try {
    const documents = await listHandoverDocumentsForEmployee(env, employeeId);
    return json({ documents });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Τα δικά μου έγγραφα — μόνο τεχνικός, tab «Στην Κατοχή μου» */
async function handleHandoverMy(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "technician") return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  try {
    const documents = await listHandoverDocumentsForEmployee(env, identity.employeeId);
    return json({ documents });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Ανέβασμα εικόνας υπογραφής (canvas PNG) — ο ίδιος ο τεχνικός, raw bytes στο body, id+filename σε query param */
async function handleHandoverSign(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const filename = params.get("filename") || "υπογραφή.png";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενή υπογραφή." }, 400);
    if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: "Η υπογραφή είναι πολύ μεγάλη." }, 400);
    const result = await signHandoverDocument(env, { id, employeeId, bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Λήψη/προβολή εικόνας υπογραφής — ο ίδιος ο τεχνικός (owner) Ή TL/Director,
 * ίδιο dual-auth gate με τις φωτογραφίες παραλαβής οχήματος. Content-
 * Disposition "inline" (ΟΧΙ "attachment") ώστε να μπορεί να ενσωματωθεί ως
 * <img> στο browser-print PDF (βλ. hub.html, exportHandoverPdf).
 */
async function handleHandoverSignatureFile(request, env, params) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const id = params.get("id");
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  try {
    const file = await getHandoverSignature(env, id);
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε." }, 404);

    let authorized = false;
    if (identity.type === "technician" && String(identity.employeeId) === String(file.docEmployeeId)) {
      authorized = true;
    } else if (identity.type === "staff") {
      const leader = await getTeamLeaderByEmail(env, identity.email);
      const director = leader ? null : await getDirectorByEmail(env, identity.email);
      if (leader || director) authorized = true;
    }
    if (!authorized) return json({ error: "Δεν έχεις πρόσβαση σε αυτή την υπογραφή." }, 403);

    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// TAB «ΕΓΓΡΑΦΑ» (31/08/2026) — βλ. src/documents.js. Αυτοματοποιημένα
// επίσημα έγγραφα προσωπικού (π.χ. Αίτηση Άδειας Άνευ Αποδοχών) — ο
// TL/Director επιλέγει τεχνικό (αυτόματη συμπλήρωση από το προφίλ) +
// συμπληρώνει τα υπόλοιπα με το χέρι, browser-print, καμία ψηφιακή
// υπογραφή (φυσική υπογραφή/σφραγίδα στο χαρτί). Ίδιο gate requireTeamLeader
// με το Προφίλ Τεχνικού (TL+Director, ΟΧΙ Backoffice — ρητή απόφαση χρήστη).
// ============================================================

async function handleDocumentCreate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId, docType, fields } = body || {};
  if (!employeeId) return json({ error: "Χρειάζεται employeeId." }, 400);
  if (!docType) return json({ error: "Χρειάζεται τύπος εγγράφου." }, 400);

  try {
    const doc = await createDocument(env, { employeeId, docType, fields, createdBy: leader.Email });
    return json(doc);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Ιστορικό εγγράφων ενός τεχνικού· χωρίς employeeId -> γενικό ιστορικό (πιο πρόσφατα πρώτα, cap 200) */
async function handleDocumentList(request, env, searchParams) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const employeeId = searchParams.get("employeeId");
  try {
    const documents = employeeId
      ? await listDocumentsForEmployee(env, employeeId)
      : await listAllDocuments(env);
    return json({ documents });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleDocumentGet(request, env, searchParams) {
  const { error } = await requireTeamLeader(request, env);
  if (error) return error;

  const id = searchParams.get("id");
  if (!id) return json({ error: "Χρειάζεται id." }, 400);
  try {
    const doc = await getDocumentById(env, id);
    if (!doc) return json({ error: "Το έγγραφο δεν βρέθηκε." }, 404);
    return json(doc);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Ενιαίο «Προφίλ Τεχνικού» — ρητή απαίτηση χρήστη: σήμερα τα στοιχεία ενός
 * τεχνικού είναι σκόρπια σε 3 σημεία (αναζήτηση Εξοπλισμού, αναζήτηση
 * Άδειες Ομάδας, ξεχωριστή φόρμα Αξιολόγηση) — αυτό το endpoint συνδυάζει τα
 * πρώτα δύο σε ΜΙΑ κλήση (getTechnicianLeaveProfile + getTechnicianHoldings,
 * ίδιο reuse philosophy με τα υπόλοιπα endpoints — καμία νέα αποθήκευση
 * δεδομένων). Ίδιο gate requireTeamLeader με το technician-holdings παραπάνω
 * — λειτουργεί αυτόματα και για Director (περνάει το ίδιο gate). ΔΕΝ
 * εκτίθεται στο Backoffice (νέο TOOLS entry μόνο σε leader/director στο
 * hub.html) — συνεπές με απόφαση #1 του CLAUDE.md, το Backoffice δεν βλέπει
 * λεπτομέρειες αδειών.
 *
 * Χωρίς employeeId: επιστρέφει τη λίστα τεχνικών για το dropdown, scoped
 * ανάλογα με το ρόλο του viewer — Director βλέπει όλους (getTechniciansPool,
 * ίδια λίστα με το Συνεργεία pool), TL βλέπει μόνο τη δική του ομάδα
 * (getTeamLeaderData.team, ίδια λίστα με το Άδειες Ομάδας dropdown).
 *
 * **Απαντήσεις Ανακοινώσεων — ΕΓΙΝΕ** (15/08/2026, ρητή απαίτηση χρήστη·
 * ΑΝΑΘΕΩΡΕΙ το "εκτός scope" σχόλιο του CLAUDE.md item #7): reuse ΑΥΤΟΥΣΙΟ
 * `listMyAvailabilityQueries()` (ίδια συνάρτηση με το tab «Ανακοινώσεις» του
 * ίδιου του τεχνικού) — καμία νέα συνάρτηση/αποθήκευση χρειάστηκε, απλά
 * καλείται εδώ επιπλέον με το `employeeId` του επιλεγμένου τεχνικού αντί για
 * το employeeId του συνδεδεμένου χρήστη. Επιστρέφει ΚΑΙ ενεργά ΚΑΙ ληγμένα
 * ερωτήματα (με `Active`/`MyAnswer` ανά ερώτημα) — το UI αποφασίζει τι δείχνει.
 */
async function handleEmployeeProfile(request, env, searchParams) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  const employeeId = searchParams.get("employeeId");
  if (!employeeId) {
    // Ανοίχτηκε σε ΟΛΟΥΣ τους τεχνικούς για ΚΑΘΕ TL (όχι μόνο Director πια)
    // — ρητή απαίτηση χρήστη 15/08/2026, βλ. σχόλιο στο
    // getTechnicianLeaveProfile (leaves.js) για το γιατί. Πριν, ένας TL
    // έβλεπε μόνο τη δική του ομάδα (getTeamLeaderData().team) εδώ.
    try {
      const technicians = (await getTechniciansPool(env)).map((t) => ({ EmployeeID: t.EmployeeID, Name: t.Name, Team: t.Team || "", Status: t.Status || "Ενεργός" }));
      technicians.sort((a, b) => String(a.Name).localeCompare(String(b.Name), "el"));
      return json({ technicians });
    } catch (err) {
      return json({ error: err.message || String(err) }, 400);
    }
  }

  try {
    const [leaveProfile, holdingsData, availabilityAnswers] = await Promise.all([
      getTechnicianLeaveProfile(env, leader.Email, employeeId),
      getTechnicianHoldings(env, employeeId),
      listMyAvailabilityQueries(env, employeeId),
    ]);
    return json({ ...leaveProfile, holdings: holdingsData.holdings, availabilityAnswers });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEmployeeUpdate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId, name, email, teamLeaderEmail, annualDays, team, hasDrivingLicense, ama, amka, afm, phone, companyPhone, address, hireDate, technicalTraining, huskiesUsername, huskiesPassword, priorExperience, fatherName, idNumber } = body || {};
  if (!employeeId) return json({ error: "Λείπει ο κωδικός υπαλλήλου." }, 400);

  try {
    const employee = await updateTechnicianRecord(
      env,
      employeeId,
      { name, email, teamLeaderEmail, annualDays, team, hasDrivingLicense, ama, amka, afm, phone, companyPhone, address, hireDate, technicalTraining, huskiesUsername, huskiesPassword, priorExperience, fatherName, idNumber },
      leader.Email
    );
    return json({ success: true, employee });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Αποστολή/επανα-αποστολή email με ΜΟΝΟ τα Huskies credentials (username/
 * password τρίτου συστήματος) — ρητή απαίτηση χρήστη 24/08/2026, κουμπί
 * «Αποστολή email» στην κάρτα Huskies του tab «Προφίλ Τεχνικού». Ρητή
 * απόφαση χρήστη μέσω ερώτησης: το email περιέχει ΜΟΝΟ τα Huskies στοιχεία,
 * ΟΧΙ υπενθύμιση των portal credentials (αυτά ήδη στάλθηκαν στο welcome
 * email της δημιουργίας, βλ. handleEmployeesCreate). Ίδιο gate
 * requireTeamLeader με το υπόλοιπο tab Προφίλ Τεχνικού (TL+Director, ΟΧΙ
 * Backoffice — δεν έχει πρόσβαση στο tab ούτως ή άλλως).
 */
async function handleEmployeeHuskiesEmail(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { employeeId } = body || {};
  if (!employeeId) return json({ error: "Λείπει ο κωδικός υπαλλήλου." }, 400);

  try {
    const employee = await getEmployeeById(env, employeeId);
    if (!employee) return json({ error: "Ο τεχνικός δεν βρέθηκε." }, 400);
    if (!employee.HuskiesUsername && !employee.HuskiesPassword) {
      return json({ error: "Δεν υπάρχουν καταχωρημένα στοιχεία Huskies για αυτόν τον τεχνικό." }, 400);
    }
    if (!employee.Email) {
      return json({ error: "Ο τεχνικός δεν έχει καταχωρημένο email." }, 400);
    }

    const actorName = leader.Name || leader.Email;
    const emailResult = await sendEmail(env, {
      to: [employee.Email],
      subject: "Τα στοιχεία σύνδεσής σου στο Huskies",
      html: emailTemplate({
        badge: "Huskies",
        badgeColor: "blue",
        title: "Στοιχεία σύνδεσης Huskies",
        intro: `Ο/Η ${actorName} σου έστειλε τα στοιχεία σύνδεσης στο Huskies.`,
        rows: [
          ["Username", employee.HuskiesUsername || "—"],
          ["Password", employee.HuskiesPassword || "—"],
        ],
        footer: "Αν δεν το περίμενες, επικοινώνησε με τον Team Leader σου.",
      }),
      replyTo: leader.Email,
      replyToName: actorName,
    });
    await logEmailFailure(env, "huskies_email_failed", leader.Email, emailResult, { employeeId: employee.EmployeeID, to: employee.Email });
    if (!emailResult.success) {
      const reason = emailResult.skipped === "email not configured"
        ? "Το email relay δεν είναι ρυθμισμένο ακόμα (λείπουν secrets)."
        : (emailResult.error || "Άγνωστο σφάλμα αποστολής.");
      return json({ error: `Δεν στάλθηκε το email: ${reason}` }, 400);
    }
    return json({ success: true });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEpassList(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;
  try {
    const [items, drivers, vehicles] = await Promise.all([listEpass(env), listEpassDrivers(env), listEpassVehicles(env)]);
    return json({ items, drivers, vehicles });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEpassAdd(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { label, technicianId, vehiclePlate, status, note } = body || {};
  try {
    const result = await addEpass(env, { label, technicianId, vehiclePlate, status, note, updatedBy: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEpassUpdate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { itemId, label, technicianId, vehiclePlate, status, note } = body || {};
  if (!itemId) return json({ error: "Χρειάζεται itemId." }, 400);
  try {
    const result = await updateEpass(env, itemId, { label, technicianId, vehiclePlate, status, note }, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleEpassDelete(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { itemId } = body || {};
  if (!itemId) return json({ error: "Χρειάζεται itemId." }, 400);
  try {
    const result = await deleteEpass(env, itemId, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Τηλεργασία — μόνο Backoffice, πολλαπλές μη-συνεχόμενες ημέρες σε ένα αίτημα */
async function handleLeavesTelework(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "staff") return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const backoffice = await getBackofficeByEmail(env, identity.email);
  if (!backoffice) return json({ error: "Μόνο το Backoffice μπορεί να δηλώσει τηλεργασία." }, 403);

  const employeeId = await resolveEmployeeId(env, identity);
  if (!employeeId) return json({ error: "Δεν είσαι καταχωρημένος στο φύλλο Υπάλληλοι." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { dates, note } = body || {};

  try {
    const result = await submitTeleworkRequest(env, { employeeId, dates, note, enteredBy: identity.email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// CREWS API — Σύνθεση Συνεργείων (drag & drop), μόνο Backoffice.
// Ξεχωριστό από Χρεώσεις/Άδειες — καθαρά καθημερινός προγραμματισμός.
// ============================================================

async function handleCrewsPool(request, env) {
  const { error } = await requireBackoffice(request, env);
  if (error) return error;
  try {
    // Ανενεργοί αποκλείονται από τη δεξαμενή (item #5, 13/08/2026, ρητή
    // απαίτηση χρήστη) — δεν μπαίνουν σε συνεργείο. Παραμένουν ορατοί στο
    // tab «Προφίλ Τεχνικού» για ιστορικό.
    const technicians = (await getTechniciansPool(env)).filter((t) => t.Status !== "Ανενεργός");
    return json({ technicians });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleCrewsDates(request, env) {
  const { error } = await requireBackoffice(request, env);
  if (error) return error;
  try {
    const dates = await listCrewDates(env);
    return json({ dates });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleCrewsGet(request, env, params) {
  const { error } = await requireBackoffice(request, env);
  if (error) return error;
  const date = params.get("date");
  if (!date) return json({ error: "Χρειάζεται ημερομηνία." }, 400);
  try {
    const snapshot = await getCrewsForDate(env, date);
    return json({
      date,
      crews: snapshot ? snapshot.crews : [],
      technicians: snapshot ? snapshot.technicians : [],
      savedBy: snapshot?.savedBy || "",
      savedAt: snapshot?.savedAt || "",
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/**
 * Στιγμιότυπο κατάστασης — παίρνουμε τη ζωντανή δεξαμενή ΤΗ ΣΤΙΓΜΗ της
 * αποθήκευσης και την αποθηκεύουμε μαζί με τα crews, ώστε το ιστορικό να
 * δείχνει πραγματικά πώς ήταν η διαθεσιμότητα εκείνη την ημέρα — όχι τη
 * σημερινή (ρητή απαίτηση χρήστη).
 */
async function handleCrewsSave(request, env) {
  const { backoffice, error } = await requireBackoffice(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { date, crews } = body || {};
  try {
    const technicians = await getTechniciansPool(env);
    const result = await saveCrewsForDate(env, { date, crews, technicians, savedBy: backoffice.Email || backoffice.Name || "" });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// ANNOUNCEMENTS API — "Ενημερώσεις/Οδηγίες", βλέπουν όλοι οι συνδεδεμένοι
// ρόλοι (τεχνικοί + staff), καταχωρούν/διαγράφουν μόνο TL/Backoffice.
// ============================================================

async function handleAnnouncementsList(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);
  try {
    if (identity.type === "technician") {
      const announcements = await listAnnouncementsForTechnician(env, identity.employeeId);
      return json({ announcements });
    }
    // Staff (TL/Backoffice/Director) δεν έχουν ειδικότητα — βλέπουν πάντα
    // τα πάντα, ίδιο σκεπτικό με το «Ανακοινώσεις» (βλ. src/announcements.js).
    // Μαζί με teamOptions, για τη φόρμα στόχευσης στη δημιουργία.
    const [announcements, teamOptions] = await Promise.all([listAnnouncements(env), listTeamOptions(env)]);
    return json({ announcements, teamOptions });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

/** Ανέβασμα συνημμένου — raw bytes στο body, filename σε query param. Επιστρέφει fileKey για χρήση στο επόμενο POST /api/announcements */
async function handleAnnouncementUpload(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;

  const filename = new URL(request.url).searchParams.get("filename") || "αρχείο";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";

  try {
    const bytes = await request.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) return json({ error: "Κενό αρχείο." }, 400);
    if (bytes.byteLength > 20 * 1024 * 1024) return json({ error: "Το αρχείο είναι πολύ μεγάλο (μέγιστο 20MB)." }, 400);
    const result = await uploadAnnouncementFile(env, { bytes, fileName: filename, contentType });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAnnouncementCreate(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { title, body: text, fileKey, fileName, fileType, targetTeams } = body || {};
  const postedByName = actorNameFromAuth(auth);

  try {
    const result = await createAnnouncement(env, {
      title,
      body: text,
      fileKey,
      fileName,
      fileType,
      targetTeams,
      postedBy: auth.email,
      postedByName,
    });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAnnouncementDelete(request, env) {
  const auth = await requireTeamLeaderOrBackoffice(request, env);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { id } = body || {};
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  try {
    const result = await deleteAnnouncement(env, id, auth.email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAnnouncementFile(request, env, params) {
  const identity = await resolveIdentity(request, env);
  if (!identity) return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  const id = params.get("id");
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  try {
    const file = await getAnnouncementFileById(env, id);
    if (!file) return json({ error: "Το αρχείο δεν βρέθηκε." }, 404);
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      },
    });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

// ============================================================
// AVAILABILITY QUERIES API — "Ανακοινώσεις", ερωτήματα διαθεσιμότητας
// επαρχίας. Δημιουργία/διαγραφή/συγκεντρωτική λίστα μόνο TL/Director
// (requireTeamLeader — Backoffice δεν έχει καν πρόσβαση, το tab δεν είναι
// στο TOOLS.backoffice). Απάντηση μόνο τεχνικός (session-based, ίδιο
// μοτίβο με /api/leaves/submit). Βλ. src/availability.js.
// ============================================================

async function handleAvailabilityQueriesList(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;
  try {
    const [queries, teamOptions] = await Promise.all([listAvailabilityQueries(env), listTeamOptions(env)]);
    return json({ queries, teamOptions });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAvailabilityQueryCreate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { question, deadline, targetTeams, publishAt, responseMode } = body || {};

  try {
    const result = await createAvailabilityQuery(env, {
      question,
      deadline,
      targetTeams,
      publishAt,
      responseMode,
      createdBy: leader.Email,
      createdByName: leader.Name,
    });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAvailabilityQueryUpdate(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { id, question, deadline, targetTeams, publishAt, responseMode } = body || {};
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  try {
    const result = await updateAvailabilityQuery(env, { id, question, deadline, targetTeams, publishAt, responseMode, actorEmail: leader.Email });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAvailabilityQueryDelete(request, env) {
  const { leader, error } = await requireTeamLeader(request, env);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { id } = body || {};
  if (!id) return json({ error: "Χρειάζεται id." }, 400);

  try {
    const result = await deleteAvailabilityQuery(env, id, leader.Email);
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAvailabilityMyQueries(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "technician") return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  try {
    const queries = await listMyAvailabilityQueries(env, identity.employeeId);
    return json({ queries });
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

async function handleAvailabilityAnswer(request, env) {
  const identity = await resolveIdentity(request, env);
  if (!identity || identity.type !== "technician") return json({ error: "Δεν έχεις συνδεθεί." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Μη έγκυρο αίτημα." }, 400);
  }
  const { queryId, answer } = body || {};
  if (!queryId || !answer) return json({ error: "Χρειάζεται queryId και answer." }, 400);

  try {
    const result = await submitAvailabilityAnswer(env, { queryId, employeeId: identity.employeeId, answer });
    return json(result);
  } catch (err) {
    return json({ error: err.message || String(err) }, 400);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function readSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifyPayload(token, env.SESSION_SECRET || env.LINK_SECRET);
  if (!payload) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Υποψήφιοι παραλήπτες μαζικού καλωσορίσματος τεχνικών — κοινό φίλτρο, reuse
 * και από το GET (λίστα για επιλογή στο UI) και από το POST (αποστολή)
 * παρακάτω, ώστε να μην αποκλίνουν ποτέ οι δύο λίστες (20/08/2026).
 */
async function getBulkWelcomeTechnicianTargets(env) {
  const employees = await readSheetAsObjects(env, "Υπάλληλοι").catch(() => []);
  return employees.filter((e) => {
    const team = String(e.Team || "").trim().toLowerCase();
    if (team === "back office" || team === "backoffice" || team === "team leader") return false;
    if (String(e.Status || "").trim() === "Ανενεργός") return false;
    if (!e.EmployeeID || !e.Email) return false;
    return true;
  });
}

/** GET -> λίστα υποψήφιων τεχνικών, για την επιλογή παραληπτών στο UI (20/08/2026) */
async function handleBulkWelcomeTechniciansList(request, env) {
  const auth = await requireBulkWelcomeOwner(request, env);
  if (auth.error) return auth.error;
  const targets = await getBulkWelcomeTechnicianTargets(env);
  return json({
    targets: targets.map((e) => ({ employeeId: e.EmployeeID, name: e.Name || e.EmployeeID, team: e.Team || "" })),
  });
}

/**
 * Μαζική αποστολή καλωσορίσματος σε ΤΕΧΝΙΚΟΥΣ — εφάπαξ ενέργεια (βλ.
 * requireBulkWelcomeOwner παραπάνω). Αφορά μόνο ενεργούς τεχνικούς με
 * καταχωρημένο email (ίδιο φιλτράρισμα Team με το άμυνα-block του
 * /api/auth/technician login, ώστε να ΜΗΝ γίνει PIN reset σε self-rows
 * Backoffice/Team Leader στο Υπάλληλοι). Δεν μπορούμε να στείλουμε το
 * ΥΠΑΡΧΟΝ PIN (είναι hashed, μη ανακτήσιμο) — άρα κάθε τεχνικός παίρνει νέο
 * 4ψήφιο PIN, ο παλιός κωδικός παύει να ισχύει αμέσως (ίδιος μηχανισμός με
 * handleResetPin, απλά σε loop). Best-effort ανά τεχνικό: μια αποτυχία
 * (email relay error) δεν σταματάει τους υπόλοιπους.
 * Προαιρετικό body {employeeIds:[...]} περιορίζει την αποστολή σε
 * συγκεκριμένους τεχνικούς (ρητή απαίτηση χρήστη 20/08/2026) — χωρίς body
 * (ή άκυρο JSON) στέλνει σε ΟΛΟΥΣ, ίδια συμπεριφορά με πριν.
 */
async function handleBulkWelcomeTechnicians(request, env) {
  const auth = await requireBulkWelcomeOwner(request, env);
  if (auth.error) return auth.error;

  let selectedIds = null;
  try {
    const body = await request.json();
    if (body && Array.isArray(body.employeeIds)) selectedIds = new Set(body.employeeIds.map(String));
  } catch {
    // Κανένα/άκυρο body -> στέλνει σε όλους, ίδια συμπεριφορά με πριν.
  }

  let targets = await getBulkWelcomeTechnicianTargets(env);
  if (selectedIds) {
    targets = targets.filter((e) => selectedIds.has(String(e.EmployeeID)));
    if (!targets.length) return json({ error: "Δεν επιλέχθηκε κανένας παραλήπτης." }, 400);
  }

  const results = [];
  for (const emp of targets) {
    try {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const pinHash = await hashPin(emp.EmployeeID, pin, env.LINK_SECRET);
      await env.TECHNICIAN_AUTH.put(`emp:${emp.EmployeeID}`, JSON.stringify({ pinHash, name: emp.Name }));

      const emailResult = await sendEmail(env, {
        to: [emp.Email],
        subject: "Τα στοιχεία σύνδεσής σου στο OptikiTec Portal",
        html: emailTemplate({
          badge: "Καλωσόρισμα",
          badgeColor: "green",
          title: "Καλωσορίσατε στο OptikiTec Portal",
          intro: "Ενεργοποιήθηκε ο λογαριασμός σας στο OptikiTec Portal, την πλατφόρμα διαχείρισης αδειών, στόλου και εξοπλισμού της εταιρείας. Μέσω αυτής μπορείτε να υποβάλλετε αιτήματα άδειας, να ενημερώνεστε για ό,τι έχει ανατεθεί στο όνομά σας, και να παρακολουθείτε τις ανακοινώσεις της εταιρείας. Χρησιμοποιήστε τα παρακάτω διαπιστευτήρια για την πρώτη σας σύνδεση.",
          rows: [
            ["Κωδικός υπαλλήλου", emp.EmployeeID],
            ["PIN", pin],
          ],
          ctaText: "Είσοδος στο Portal",
          ctaUrl: PORTAL_URL,
          footer: "Για λόγους ασφαλείας, διατηρήστε το PIN σας εμπιστευτικό. Σε περίπτωση απώλειας, μπορεί να σας αποδοθεί νέο κατόπιν αιτήματος στον υπεύθυνό σας.",
        }),
        replyTo: auth.email,
        replyToName: auth.name,
      });
      await logEmailFailure(env, "bulk_welcome_technician_email_failed", auth.email, emailResult, { employeeId: emp.EmployeeID, to: emp.Email });
      results.push({ employeeId: emp.EmployeeID, name: emp.Name, sent: !!emailResult.success, error: emailResult.error || emailResult.skipped || null });
    } catch (err) {
      results.push({ employeeId: emp.EmployeeID, name: emp.Name, sent: false, error: err.message || String(err) });
    }
  }

  await appendAuditLog(env, "bulk_welcome_technicians", auth.email, { total: targets.length, sent: results.filter((r) => r.sent).length });

  return json({ total: targets.length, sent: results.filter((r) => r.sent).length, failed: results.filter((r) => !r.sent) });
}

/**
 * Υποψήφιοι παραλήπτες μαζικού καλωσορίσματος staff — κοινό φίλτρο, reuse
 * και από το GET (λίστα για επιλογή στο UI) και από το POST (αποστολή)
 * παρακάτω (20/08/2026). Μαζεύει μοναδικά emails και από τα 3 φύλλα,
 * εξαιρεί το ίδιο το email του ενεργοποιητή (δεν έχει νόημα να στείλει
 * καλωσόρισμα στον εαυτό του).
 */
async function getBulkWelcomeStaffTargets(env, ownerEmail) {
  const [leaders, backoffice, directors] = await Promise.all([
    readSheetAsObjects(env, "TeamLeaders").catch(() => []),
    readSheetAsObjects(env, "Backoffice").catch(() => []),
    readSheetAsObjects(env, "Directors").catch(() => []),
  ]);

  const seen = new Set([String(ownerEmail || "").toLowerCase()]);
  const targets = [];
  for (const row of [...leaders, ...backoffice, ...directors]) {
    const email = String(row.Email || "").trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    targets.push({ email, name: row.Name || email });
  }
  return targets;
}

/** GET -> λίστα υποψήφιου staff, για την επιλογή παραληπτών στο UI (20/08/2026) */
async function handleBulkWelcomeStaffList(request, env) {
  const auth = await requireBulkWelcomeOwner(request, env);
  if (auth.error) return auth.error;
  const targets = await getBulkWelcomeStaffTargets(env, auth.email);
  return json({ targets });
}

/**
 * Μαζική αποστολή καλωσορίσματος σε STAFF (Backoffice/Team Leader/Director)
 * — εφάπαξ ενέργεια (βλ. requireBulkWelcomeOwner παραπάνω). Χωρίς PIN/reset
 * (συνδέονται με Google SSO) — καθαρά ενημερωτικό email.
 * Προαιρετικό body {emails:[...]} περιορίζει την αποστολή σε συγκεκριμένα
 * emails (ρητή απαίτηση χρήστη 20/08/2026) — χωρίς body (ή άκυρο JSON)
 * στέλνει σε ΟΛΟΥΣ, ίδια συμπεριφορά με πριν.
 */
async function handleBulkWelcomeStaff(request, env) {
  const auth = await requireBulkWelcomeOwner(request, env);
  if (auth.error) return auth.error;

  let selectedEmails = null;
  try {
    const body = await request.json();
    if (body && Array.isArray(body.emails)) selectedEmails = new Set(body.emails.map((e) => String(e).toLowerCase()));
  } catch {
    // Κανένα/άκυρο body -> στέλνει σε όλους, ίδια συμπεριφορά με πριν.
  }

  let targets = await getBulkWelcomeStaffTargets(env, auth.email);
  if (selectedEmails) {
    targets = targets.filter((p) => selectedEmails.has(p.email.toLowerCase()));
    if (!targets.length) return json({ error: "Δεν επιλέχθηκε κανένας παραλήπτης." }, 400);
  }

  const results = [];
  for (const person of targets) {
    const emailResult = await sendEmail(env, {
      to: [person.email],
      subject: "Καλωσόρισμα στο OptikiTec Portal",
      html: emailTemplate({
        badge: "Καλωσόρισμα",
        badgeColor: "green",
        title: "Καλωσορίσατε στο OptikiTec Portal",
        intro: "Έχετε πρόσβαση στο OptikiTec Portal, την πλατφόρμα διαχείρισης αδειών, στόλου οχημάτων, εξοπλισμού και προσωπικού της εταιρείας. Η σύνδεση γίνεται με τον εταιρικό σας λογαριασμό Google — δεν απαιτείται ξεχωριστός κωδικός πρόσβασης.",
        ctaText: "Είσοδος στο Portal",
        ctaUrl: PORTAL_URL,
        footer: "Αν αντιμετωπίσετε πρόβλημα στη σύνδεση, επικοινωνήστε μαζί μας.",
      }),
      replyTo: auth.email,
      replyToName: auth.name,
    });
    await logEmailFailure(env, "bulk_welcome_staff_email_failed", auth.email, emailResult, { to: person.email });
    results.push({ email: person.email, name: person.name, sent: !!emailResult.success, error: emailResult.error || emailResult.skipped || null });
  }

  await appendAuditLog(env, "bulk_welcome_staff", auth.email, { total: targets.length, sent: results.filter((r) => r.sent).length });

  return json({ total: targets.length, sent: results.filter((r) => r.sent).length, failed: results.filter((r) => !r.sent) });
}

// signPayload/verifyPayload μετακομίσαν στο src/tokens.js (reuse από
// src/leaves.js για τα one-click decide-links, βλ. handleLeaveDecideLink*
// παρακάτω) — εδώ μένει μόνο το bufToBase64Url που χρειάζεται το hashPin.
async function hashPin(employeeId, pin, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${employeeId}|${pin}`));
  return bufToBase64Url(sig);
}

function bufToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
