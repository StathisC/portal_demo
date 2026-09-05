# OptikiTec — Σύστημα Αδειών: Οδηγός Εγκατάστασης

Αρχιτεκτονική: Cloudflare Worker (login, hub UI, όλη η business logic) μιλάει
απευθείας με ένα Google Sheet μέσω Sheets API v4. Δεν υπάρχει Apps Script —
όλα (login, αιτήσεις, εγκρίσεις, ισοζύγιο ημερών) τρέχουν μέσα στο Worker.

## 1. Δημιουργία Google Sheet

Φτιάξε ένα νέο Google Sheet με **αυτά τα φύλλα** (tabs), με αυτά τα ονόματα και αυτή τη σειρά στηλών στη γραμμή 1:

### Φύλλο: `Άδειες`
| ID | Timestamp | EmployeeID | EmployeeName | TeamLeaderEmail | Type | StartDate | EndDate | Days | Note | Status | DecisionDate | DecisionNote | EnteredBy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Άδειο αρχικά — γεμίζει αυτόματα από το σύστημα. Status: `Εκκρεμεί` / `Εγκρίθηκε` / `Απορρίφθηκε`.

### Φύλλο: `Υπάλληλοι`
| EmployeeID | Name | Email | TeamLeaderEmail | AnnualDays | Team | HasDrivingLicense |
|---|---|---|---|---|---|---|
| ikalafatas | Καλαφάτας Ιωάννης | | nikos@optikitec.gr | 22 | Πάτρα | Ναι |

Μία γραμμή ανά τεχνικό. `EmployeeID` πρέπει να ταιριάζει με αυτό που χρησιμοποιείς στο `/api/admin/set-pin` (βλ. §2.2). `Email` είναι προαιρετικό για τεχνικούς (login γίνεται με PIN, όχι email) — αλλά αν κάποιος TL/backoffice θέλει να βλέπει *τη δική του* άδεια μέσα από το Portal, χρειάζεται μία γραμμή εδώ με το πραγματικό του `@optikitec.gr` email.

**ΣΗΜΑΝΤΙΚΟ — χειροκίνητο βήμα:** πρόσθεσε επικεφαλίδη `HasDrivingLicense` στο τέλος (νέα στήλη) — τιμές `Ναι`/`Όχι`, γράφεται αυτόματα από τη φόρμα "Νέος Τεχνικός". Απλό Ναι/Όχι πεδίο, χωρίς παρακολούθηση λήξης (ρητή απαίτηση χρήστη — δεν χρειάζεται τέτοιο tracking). Χωρίς αυτή τη στήλη, η τιμή απλά δεν αποθηκεύεται πουθενά — καμία διακοπή λειτουργίας.

Νέες γραμμές εδώ **δεν χρειάζεται πια να μπαίνουν χειροκίνητα** — υπάρχει tab
"Νέος Τεχνικός" στο hub (TL + Backoffice) που τις προσθέτει, μαζί με seed PIN
στο KV. Χειροκίνητη προσθήκη παραμένει διαθέσιμη/έγκυρη αν προτιμηθεί, απλά
πρόσεξε να μην ξαναχρησιμοποιήσεις υπάρχον `EmployeeID`.

### Φύλλο: `TeamLeaders`
| Name | Email | Team | BackupEmail | Away |
|---|---|---|---|---|
| Νίκος Κωνσταντίνου | nikos@optikitec.gr | Πάτρα/Αίγιο | | FALSE |

**ΣΗΜΑΝΤΙΚΟ — χειροκίνητο βήμα:** οι στήλες `BackupEmail` και `Away` είναι
για το backup TL feature (δεύτερος TL ανά τεχνικό, ενεργός μόνο όταν λείπει ο
κύριος) — πρόσθεσέ τις χειροκίνητα στο tab `TeamLeaders` πριν το χρησιμοποιήσεις.
Και οι δύο ενημερώνονται πλέον **αυτόματα από το UI**, όχι χειροκίνητα: όταν
ένας TL πατήσει "Λείπω" στο hub, διαλέγει από dropdown ποιος άλλος TL θα τον
αντικαταστήσει εκείνη τη στιγμή — το portal γράφει τότε το `BackupEmail`
(email του επιλεγμένου) και θέτει `Away = TRUE`. Στο "Επέστρεψα" θέτει πάλι
`Away = FALSE`. Δεν χρειάζεται να συμπληρώσεις τίποτα σε αυτές τις στήλες
εσύ — απλά να υπάρχουν ως επικεφαλίδες (default τιμή `Away`: `FALSE` ή κενό).
Χωρίς αυτές τις 2 στήλες το feature είναι σιωπηλά ανενεργό — δεν σπάει τίποτα.

Μόνο όσοι είναι εδώ μπορούν να εγκρίνουν/απορρίψουν αιτήσεις και να καταχωρούν άδεια εκ μέρους τεχνικού — και μόνο για τεχνικούς με `TeamLeaderEmail` ίσο με το δικό τους (team-scoped, δεν βλέπουν αιτήσεις άλλων ομάδων).

### Φύλλο: `AuditLog`
Άδειο αρχικά. Γεμίζει αυτόματα (`Timestamp | User | Action | Details`) σε κάθε υποβολή/απόφαση — για ιστορικό/έλεγχο.

### Φύλλο: `Backoffice`
| Name | Email |
|---|---|
| Στάθης Χρόνης | s.xronis@optikitec.gr |

Όποιος είναι εδώ μπαίνει με τον εταιρικό του Google λογαριασμό και παίρνει
ρόλο **Backoffice**. Ο ρόλος καθορίζεται αυτόματα: αν το email υπάρχει στο
`TeamLeaders` → Team Leader, αλλιώς αν υπάρχει εδώ → Backoffice. Αν δεν
υπάρχει πουθενά, ο χρήστης βλέπει μόνο τα προσωπικά του tools.

### Φύλλο: `Χρεώσεις`
| ID | Type | ItemID | ItemLabel | EmployeeID | EmployeeName | ChargedAt | ReleasedAt | ChargedBy | ReleasedBy | VehicleId | VehiclePlate |
|---|---|---|---|---|---|---|---|---|---|---|---|

Άδειο αρχικά — γεμίζει αυτόματα. Όταν ένας TL αναθέτει όχημα σε τεχνικό,
δημιουργείται γραμμή με `ChargedAt` = σήμερα και κενό `ReleasedAt` (ανοιχτή
χρέωση). Όταν το όχημα ανατεθεί σε άλλον (ή διαγραφεί), συμπληρώνεται το
`ReleasedAt`. Ο τεχνικός βλέπει τα δικά του στο tab «Χρεώσεις».

**ΣΗΜΑΝΤΙΚΟ — χειροκίνητο βήμα:** πρόσθεσε επικεφαλίδες `VehicleId` και
`VehiclePlate` στο τέλος (νέες στήλες) — χρησιμοποιούνται ΜΟΝΟ από τις
χρεώσεις e-pass (`Type: e-pass`), όπου μια χρέωση μπορεί να δείχνει ΚΑΙ σε
τεχνικό ΚΑΙ σε όχημα ταυτόχρονα. Για όλες τις άλλες χρεώσεις (οχήματα,
εξοπλισμός) αυτές οι 2 στήλες μένουν κενές — καμία επίδραση στα υπάρχοντα
δεδομένα. Χωρίς αυτές τις στήλες, οι χρεώσεις e-pass γράφονται κανονικά
αλλά χωρίς την πληροφορία οχήματος (σιωπηλά ημιτελές).

**Επόμενα χειροκίνητα βήματα (σωρευτικά, βλ. CLAUDE.md §Χειροκίνητα βήματα για την πλήρη/ενημερωμένη λίστα):** στο τέλος του `Χρεώσεις` προστέθηκαν με τον καιρό ακόμα `PickupMileage | PickupPhotos | ReturnMileage | PickupDate | ReturnDate` (παραλαβή/επιστροφή οχήματος + ημερολόγιο τεχνικού). Το πλήρες, τρέχον σχήμα των στηλών φαίνεται στο σχόλιο στην κορυφή του `src/assignments.js` (`CHARGES_HEADER_ORDER`) — πιο αξιόπιστη πηγή αλήθειας από τον παραπάνω πίνακα, που δείχνει μόνο το αρχικό σχήμα.

### Φύλλο: `Στόλος`
| ID | Plate | Type | AssignedTo | Status | ServiceNote | UpdatedBy | UpdatedAt | KteoDate | ServiceDate |
|---|---|---|---|---|---|---|---|---|---|

Άδειο αρχικά — γεμίζει από το Portal ("Στόλος" tab, μόνο TL). Κοινός στόλος
για όλους τους Team Leaders (όχι ανά ομάδα). `Status`: `Ενεργό` / `Σε service` / `Εκτός λειτουργίας`.

**ΣΗΜΑΝΤΙΚΟ — χειροκίνητο βήμα:** οι στήλες `KteoDate` και `ServiceDate` (I, J)
προστέθηκαν στο Portal για τις προειδοποιήσεις λήξης ΚΤΕΟ/service, αλλά **δεν
δημιουργούνται μόνες τους** στο υπάρχον Sheet — πρόσθεσε τις επικεφαλίδες
`KteoDate` και `ServiceDate` (ακριβώς έτσι, στα αγγλικά, στα κελιά I1/J1) στο
tab `Στόλος` πριν χρησιμοποιήσεις τη λειτουργία. Χωρίς αυτές, οι ημερομηνίες
δεν θα διαβάζονται πίσω σωστά (θα φαίνονται πάντα κενές στο UI, ακόμα κι αν
αποθηκευτούν).

### Φύλλο: `Εξοπλισμός`
| ID | Name | Category | AssignedTo | Status | Note | UpdatedBy | UpdatedAt |
|---|---|---|---|---|---|---|---|

**ΝΕΟ φύλλο — χειροκίνητο βήμα:** πρέπει να το δημιουργήσεις εσύ (tab με
ακριβώς αυτό το όνομα `Εξοπλισμός` και αυτή τη σειρά επικεφαλίδων στη γραμμή
1), αλλιώς το tab "Εξοπλισμός" στο hub θα αποτυγχάνει. Άδειο αρχικά — γεμίζει
από το Portal, μόνο TL, κοινή λίστα (όχι ανά ομάδα, ίδιο με το Στόλος).
`Status`: `Διαθέσιμο` / `Σε χρήση` / `Εκτός λειτουργίας`. `Category` είναι
ελεύθερο κείμενο (π.χ. "Εργαλείο", "Laptop", "Κινητό") — γίνεται το `Type`
της αντίστοιχης γραμμής στο φύλλο `Χρεώσεις` όταν ανατεθεί σε τεχνικό, ίδιος
μηχανισμός με τα οχήματα (`Type: Όχημα`).

### Φύλλο: `EPass`
| ID | Label | AssignedTechnicianId | AssignedTechnicianName | AssignedVehicleId | AssignedVehiclePlate | Status | Note | UpdatedBy | UpdatedAt |
|---|---|---|---|---|---|---|---|---|---|

**ΝΕΟ φύλλο — χειροκίνητο βήμα:** δημιούργησέ το ΑΠΟ ΤΗΝ ΑΡΧΗ (tab με
ακριβώς αυτό το όνομα `EPass` και αυτή τη σειρά επικεφαλίδων στη γραμμή 1),
αλλιώς το tab "e-pass" στο hub θα αποτυγχάνει. Άδειο αρχικά — γεμίζει από
το Portal, μόνο TL, κοινή λίστα. `Status`: `Ενεργό` / `Ανενεργό`. Σε
αντίθεση με το Εξοπλισμό, ένα e-pass μπορεί να έχει ΚΑΙ `AssignedTechnicianId`
ΚΑΙ `AssignedVehicleId` γεμάτα ταυτόχρονα — η χρέωση που ανοίγει στο φύλλο
`Χρεώσεις` (βλ. παραπάνω) αντανακλά και τα δύο.

### Φύλλο: `Συνεργεία`
| Date | CrewsJSON | SavedBy | SavedAt |
|---|---|---|---|

**ΝΕΟ φύλλο — χειροκίνητο βήμα:** δημιούργησέ το ΑΠΟ ΤΗΝ ΑΡΧΗ (tab με
ακριβώς αυτό το όνομα `Συνεργεία` και αυτή τη σειρά επικεφαλίδων στη
γραμμή 1), αλλιώς το tab "Συνεργεία" στο hub θα αποτυγχάνει. Άδειο αρχικά.
Μία γραμμή ανά ημερομηνία (`Date` = YYYY-MM-DD) — `CrewsJSON` περιέχει
ολόκληρη τη σύνθεση συνεργείων της ημέρας ως JSON string
(`[{id, name, memberIds:[...]}]`). Ο Backoffice φτιάχνει/αποθηκεύει μόνο
για τη σημερινή ημέρα (drag & drop στο hub) — παλαιότερες ημερομηνίες
προβάλλονται read-only. Νέα αποθήκευση της ίδιας ημερομηνίας αντικαθιστά
ολόκληρη τη γραμμή (τελευταία αποθήκευση ισχύει, χωρίς merge).

### Φύλλο: `Ενημερώσεις`
| ID | Title | Body | FileKey | FileName | FileType | PostedBy | PostedByName | PostedAt |
|---|---|---|---|---|---|---|---|---|

**ΝΕΟ φύλλο — χειροκίνητο βήμα:** δημιούργησέ το ΑΠΟ ΤΗΝ ΑΡΧΗ (tab με
ακριβώς αυτό το όνομα `Ενημερώσεις` και αυτή τη σειρά επικεφαλίδων στη
γραμμή 1), αλλιώς το tab "Ενημερώσεις/Οδηγίες" στο hub θα αποτυγχάνει. Άδειο
αρχικά — γεμίζει από το Portal. Καταχωρούν μόνο TL/Backoffice, βλέπουν όλοι
οι ρόλοι (τεχνικοί + TL + Backoffice). Καμία παρακολούθηση "το είδα" — απλή
χρονολογική λίστα (ρητή απόφαση χρήστη). Το `FileKey` δείχνει σε αντικείμενο
στο Cloudflare KV `ANNOUNCEMENTS_FILES` (όχι στο ίδιο το Sheet — τα Sheets
δεν αποθηκεύουν binary). Το KV namespace είναι ήδη δηλωμένο στο
`wrangler.toml` με σταθερό `id`, οπότε ενεργοποιείται αυτόματα στο επόμενο
`wrangler deploy` — δεν χρειάζεται κανένα επιπλέον secret. Επιτρέπονται μόνο
συνημμένα PDF/Word (μέγιστο 20MB ανά αρχείο). Θα προτιμούσαμε Cloudflare R2
για αρχεία, αλλά δεν είναι ενεργοποιημένο στο Cloudflare account (χρειάζεται
χειροκίνητη ενεργοποίηση από το Dashboard) — αν θες R2 αντί για KV στο
μέλλον, ενεργοποίησέ το από το Dashboard και πες το, θα γίνει η μεταφορά.

### Φύλλο: `ΕρωτηματαΔιαθεσιμότητας`
| ID | Question | Deadline | TargetTeams | CreatedBy | CreatedByName | CreatedAt |
|---|---|---|---|---|---|---|

**ΝΕΟ φύλλο — χειροκίνητο βήμα:** δημιούργησέ το ΑΠΟ ΤΗΝ ΑΡΧΗ (tab με
ακριβώς αυτό το όνομα `ΕρωτηματαΔιαθεσιμότητας` και αυτή τη σειρά
επικεφαλίδων στη γραμμή 1), αλλιώς το tab "Ανακοινώσεις" στο hub θα
αποτυγχάνει εντελώς. Άδειο αρχικά — γεμίζει από το Portal, μόνο TL/Director
δημιουργεί. `TargetTeams` είναι JSON array από ονόματα ειδικοτήτων (το ίδιο
πεδίο `Team` του φύλλου `Υπάλληλοι`, π.χ. `["Τεχνικός Αυτοψίας"]`) ή το
sentinel `["ALL"]` για «όλες οι ειδικότητες». `Deadline` = YYYY-MM-DD — μετά
την ημερομηνία αυτή το ερώτημα κλειδώνει (καμία νέα/αλλαγμένη απάντηση).

### Φύλλο: `ΑπαντησειςΔιαθεσιμότητας`
| ID | QueryID | EmployeeID | EmployeeName | Answer | AnsweredAt |
|---|---|---|---|---|---|

**ΝΕΟ φύλλο — χειροκίνητο βήμα:** δημιούργησέ το ΑΠΟ ΤΗΝ ΑΡΧΗ (tab με
ακριβώς αυτό το όνομα `ΑπαντησειςΔιαθεσιμότητας` και αυτή τη σειρά
επικεφαλίδων στη γραμμή 1). Χωρίς αυτό, η δημιουργία/λίστα ερωτημάτων στο
tab "Ανακοινώσεις" θα δουλεύει κανονικά, αλλά η καταχώρηση απάντησης
Ναι/Όχι από τεχνικό θα αποτυγχάνει με σφάλμα. Άδειο αρχικά — γεμίζει από
το Portal. Μία γραμμή ανά (`QueryID`, `EmployeeID`) ζεύγος — αν ο τεχνικός
αλλάξει γνώμη πριν την προθεσμία, η ΙΔΙΑ γραμμή ενημερώνεται (`Answer`/
`AnsweredAt`), δεν προστίθεται νέα.

---

## 2. Cloudflare Worker — Setup

### 2.1 Secrets (wrangler CLI)

```bash
npx wrangler secret put SESSION_SECRET
# οποιοδήποτε τυχαίο μακρύ string — για το cookie session των τεχνικών

npx wrangler secret put ADMIN_SECRET
# τυχαίο string — προστατεύει το /api/admin/set-pin endpoint

npx wrangler secret put LINK_SECRET
# τυχαίο string — για το legacy /api/integration-token (μπορεί να μείνει, δεν χρησιμοποιείται πια ενεργά)
```

**Email ειδοποιήσεων χρέωσης** (προαιρετικό — αν λείπουν, οι χρεώσεις
καταγράφονται κανονικά αλλά δεν στέλνεται email). Χρησιμοποιούμε ένα μικρό,
απομονωμένο **Apps Script Web App** που κάνει μόνο `MailApp.sendEmail()` —
καμία σχέση με το Sheet/auth (βλ. σημείωση στο CLAUDE.md για το γιατί αυτό
δεν έρχεται σε αντίθεση με την απόφαση "όχι Apps Script" του backend).
Στέλνει email σαν το πραγματικό σου Google account — καμία εγγραφή σε τρίτο
πάροχο, καμία αλλαγή DNS:

1. Άνοιξε https://script.google.com → New project.
2. Επικόλλησε ΟΛΟ το περιεχόμενο του `apps-script/EmailRelay.gs` (μέσα στο
   repo) στο `Code.gs` του νέου project.
3. Project Settings (γρανάζι, αριστερά) → Script Properties → Add property:
   `RELAY_SECRET` = ένα τυχαίο μεγάλο string (π.χ. `openssl rand -hex 24`).
   Κράτησέ το, θα το ξαναχρειαστείς στο βήμα 6.
4. Deploy → New deployment → τύπος **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy το Web app URL (καταλήγει σε `/exec`).
6. Βάλε τα secrets στον Worker:

```bash
npx wrangler secret put EMAIL_RELAY_URL
# το /exec URL από το βήμα 5

npx wrangler secret put EMAIL_RELAY_SECRET
# το ΙΔΙΟ string με το RELAY_SECRET script property από το βήμα 3
```

Σημείωση: κάθε φορά που αλλάζει ο κώδικας στο Apps Script, χρειάζεται νέο
deployment (Manage deployments → edit → New version) για να ενημερωθεί το
`/exec` URL — αν αλλάξει το URL, ξαναβάλε το με `wrangler secret put
EMAIL_RELAY_URL`. Όριο αποστολών: 100/ημέρα σε απλό Gmail, 1500/ημέρα σε
Google Workspace — άνετο για τον όγκο του portal.

Τα email χρέωσης πάνε στη διεύθυνση της στήλης `Email` του τεχνικού στο φύλλο
`Υπάλληλοι` **και** στον Team Leader του (`TeamLeaderEmail`). Αν ο τεχνικός δεν
έχει email καταχωρημένο, στέλνεται μόνο στον TL.

Βλ. §3 για τα επιπλέον 4 secrets που χρειάζεται η σύνδεση με το Google Sheet (WIF).

### 2.2 Seed PIN για κάθε τεχνικό (KV: TECHNICIAN_AUTH)

```bash
curl -X POST https://optikitec-portal.s-xronis.workers.dev/api/admin/set-pin \
  -H "X-Admin-Secret: <ADMIN_SECRET από 2.1>" \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"ikalafatas","pin":"1234","name":"Καλαφάτας Ιωάννης"}'
```

Το `employeeId` πρέπει να ταιριάζει με το `EmployeeID` στο φύλλο `Υπάλληλοι`.

### 2.3 Cloudflare Access (Zero Trust) — Google SSO για TL/Backoffice

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → η εφαρμογή `optikitec-portal`
2. **Destinations** (μέγιστο 5 ανά εφαρμογή):
   - `optikitec-portal.s-xronis.workers.dev/api/leaves/team`
   - `optikitec-portal.s-xronis.workers.dev/api/leaves/decide`
   - `optikitec-portal.s-xronis.workers.dev/api/leaves/submit-for-team`
   - `optikitec-portal.s-xronis.workers.dev/api/fleet/*` (καλύπτει list/add/update/delete)
   - `optikitec-portal.s-xronis.workers.dev/api/auth/staff-login` — **κρίσιμο**: αυτό είναι το path που φορτώνει το κουμπί "Σύνδεση με Google" στο `index.html`, για να αναγκάζει το Access να ζητήσει Google login πριν κάνει redirect στο `/hub` (το `/hub` δεν είναι πλέον προστατευμένο, ώστε να το βλέπουν και οι τεχνικοί)

   Το `api/integration-token` (legacy) δεν χωράει πια στο όριο των 5 — αφαίρεσέ το αν υπάρχει, δεν χρησιμοποιείται.
3. **Identity providers**: Google (χρειάζεται Google OAuth client — Zero Trust → Settings → Authentication)
4. **Policy**: Include → Emails ending in → `@optikitec.gr`
5. Save.

**Σημαντικό**: το `/hub`, το `/`, και τα κοινά endpoints (`/api/whoami`, `/api/leaves/my`, `/api/leaves/submit`, `/api/auth/logout`) ΔΕΝ πρέπει να είναι Access-protected destinations — τα χρειάζονται και οι τεχνικοί (χωρίς Google Workspace λογαριασμό), και η δική τους ασφάλεια γίνεται ήδη μέσα στον Worker κώδικα (session cookie ή `Cf-Access-Authenticated-User-Email` header, ό,τι υπάρχει — βλ. `resolveIdentity` στο `src/index.js`). Αν προστατέψεις αυτά τα paths, οι τεχνικοί θα βλέπουν το Google login gate και δεν θα μπορούν να μπουν καθόλου.

### 2.4 Deploy

```bash
npx wrangler deploy
```

Το αυτόματο GitHub → Cloudflare Workers deploy hook καλύπτει τον static/worker
κώδικα σε κάθε push· τα secrets/KV/Access policy setup γίνονται μία φορά, χειροκίνητα.

---

## 3. Google Sheets API — σύνδεση

Δύο τρόποι· διάλεξε **έναν**. Το `src/sheets.js` ανιχνεύει αυτόματα ποιος
χρησιμοποιείται: αν υπάρχει το secret `GOOGLE_SERVICE_ACCOUNT_KEY`, τρέχει
το (Β)· αλλιώς κάνει fallback στο (Α).

### 3.0 (Β) Απλό service account JSON key — ΣΥΝΙΣΤΑΤΑΙ για demo/πειραματισμό

Πολύ λιγότερα βήματα από το WIF παρακάτω — κατάλληλο ΜΟΝΟ αν το Google Cloud
project σου ΔΕΝ έχει org policy που μπλοκάρει service account keys (το
production OptikiTec project έχει τέτοιο policy, γι' αυτό εκεί χρησιμοποιείται
το WIF (Α) — ένα καινούριο/προσωπικό project συνήθως δεν έχει αυτόν τον
περιορισμό).

1. GCP Console → φτιάξε (ή διάλεξε υπάρχον) project.
2. **APIs & Services → Library** → ενεργοποίησε **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create Service Account** (π.χ.
   `portal-demo-sheets`) → Create and Continue → Done.
4. Άνοιξε το service account → tab **Keys** → **Add Key → Create new key**
   → τύπος **JSON** → κατέβασμα.
5. Άνοιξε το νέο Google Sheet (βλ. §1) → **Share** → πρόσθεσε το email του
   service account (π.χ. `portal-demo-sheets@<project-id>.iam.gserviceaccount.com`)
   → **Editor**.
6. Βάλε ΟΛΟΚΛΗΡΟ το περιεχόμενο του κατεβασμένου .json ως ένα Worker secret:
   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY
   # επικόλλησε όλο το JSON (μία γραμμή ή πολλές, δεν πειράζει)

   npx wrangler secret put GOOGLE_SHEET_ID
   # το ID από το URL: https://docs.google.com/spreadsheets/d/<ΑΥΤΟ>/edit
   ```
7. Τέλος — παράλειψε το §3.1-3.6 παρακάτω (αυτά είναι μόνο για το (Α) WIF).

### 3.1-3.6 (Α) Workload Identity Federation (χωρίς service account key, εναλλακτικό)

Ο Worker μιλάει απευθείας με το Sheet μέσω Sheets API v4. Αντί για ένα κλασικό
downloadable service account JSON key (μπλοκάρεται από org policy
`iam.disableServiceAccountKeyCreation` — δεν το πειράξαμε, μένει ενεργό όπως
το είχε η εταιρεία), χρησιμοποιούμε **Workload Identity Federation (WIF)**: ο
ίδιος ο Worker είναι δικός του OIDC identity provider, υπογράφει JWTs με ένα
keypair που δημιουργήσαμε (μόνο ως Cloudflare Worker secret, ποτέ ως Google
service account key), και η Google Cloud STS το ανταλλάσσει για πρόσβαση.

### 3.1 Service Account (χωρίς key)

1. GCP Console → **IAM & Admin → Service Accounts → Create Service Account**
2. Όνομα π.χ. `optikitec-portal-sheets` → Create and Continue → Done
   (**ΜΗΝ** φτιάξεις JSON key)
3. Άνοιξε το Sheet → **Share** → πρόσθεσε το email του service account
   (π.χ. `optikitec-portal-sheets@<project-id>.iam.gserviceaccount.com`) → **Editor**

### 3.2 Enable APIs

GCP Console → **APIs & Services → Library** → ενεργοποίησε:
- **Google Sheets API**
- **IAM Service Account Credentials API**
- **Security Token Service API**

### 3.3 Workload Identity Pool + Provider

1. **IAM & Admin → Workload Identity Federation → Create Pool** (π.χ. `optikitec-portal-pool`)
2. **Add provider**: Type **OpenID Connect (OIDC)**, name `optikitec-portal-provider`,
   Issuer `https://optikitec-portal.s-xronis.workers.dev`, Audiences: Default
3. **Attribute mapping**: `google.subject = assertion.sub`
4. Save, σημείωσε το πλήρες resource name:
   ```
   projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/optikitec-portal-pool/providers/optikitec-portal-provider
   ```

### 3.4 Δικαίωμα impersonation

Service account (`optikitec-portal-sheets`) → **Permissions with access** →
**Grant Access** → New principal:
```
principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/optikitec-portal-pool/subject/optikitec-portal-worker
```
Ρόλος: **Workload Identity User**

### 3.5 Worker secrets

```bash
npx wrangler secret put WIF_PRIVATE_KEY
# PEM private key (δικό μας keypair, ΟΧΙ Google key)

npx wrangler secret put WIF_PROVIDER_RESOURCE
# projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/optikitec-portal-pool/providers/optikitec-portal-provider

npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
# optikitec-portal-sheets@<project-id>.iam.gserviceaccount.com

npx wrangler secret put GOOGLE_SHEET_ID
# το ID από το URL: https://docs.google.com/spreadsheets/d/<ΑΥΤΟ>/edit
```

### 3.6 Έλεγχος

```bash
curl https://optikitec-portal.s-xronis.workers.dev/.well-known/openid-configuration
curl https://optikitec-portal.s-xronis.workers.dev/.well-known/jwks.json
```

Πρέπει να επιστρέφουν JSON — αυτά τα διαβάζει η Google για να επαληθεύσει τα
JWTs μας. Μετά δοκίμασε `/api/leaves/my` συνδεδεμένος.

---

## 4. Δοκιμή end-to-end

1. **Τεχνικός**: login με employeeID+PIN → "Οι Άδειές μου" → δες ισοζύγιο, υπόβαλε αίτηση
2. **Team Leader**: Google login → "Άδειες Ομάδας" → έγκριση/απόρριψη, καταχώρηση εκ μέρους τεχνικού
3. Επιβεβαίωσε ότι το Sheet ενημερώνεται σωστά (Status, νέες γραμμές) και ότι καταγράφεται στο AuditLog

---

## Γνωστά κενά / επόμενα βήματα

- **Email notifications** (ειδοποίηση σε TL για νέα αίτηση, ειδοποίηση σε τεχνικό για απόφαση) δεν έχουν υλοποιηθεί ακόμα — μπορούν να χρησιμοποιήσουν το ίδιο `sendEmail()`/Apps Script relay που υπάρχει ήδη (βλ. §2.1, src/email.js), απλά λείπει ακόμα το triggering σε αυτά τα σημεία.
- **Weekly/monthly reports** (προαιρετικό, υπήρχαν στο παλιό Apps Script) δεν έχουν ξαναφτιαχτεί.
- **Πολλαπλοί team leaders ανά τεχνικό** (π.χ. backup approver) δεν υποστηρίζεται ακόμα.
- Αν κάποιος τεχνικός φύγει/αλλάξει ρόλο, αφαίρεσε τη γραμμή του από `Υπάλληλοι`.
