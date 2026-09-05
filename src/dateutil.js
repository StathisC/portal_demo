/**
 * Κοινό βοηθητικό module για κανονικοποίηση ημερομηνιών διαβασμένων από το
 * Google Sheet (readSheetAsObjects, χωρίς valueRenderOption -> Sheets API v4
 * default FORMATTED_VALUE).
 *
 * Bug εντοπίστηκε 24/08/2026 (αναφορά χρήστη: garbled ημερομηνίες τύπου
 * "01/01/46267" σε πίνακα "Αιτήσεις άδειας" ΚΑΙ σε πραγματικά emails
 * απόφασης τηλεργασίας): η appendRow/updateCell/updateRow (src/sheets.js)
 * γράφουν με valueInputOption=USER_ENTERED — αν το κελί προορισμού είχε ήδη
 * μορφοποίηση "General" (όχι ημερομηνίας) τη στιγμή της πρώτης εγγραφής, το
 * Sheets αποθηκεύει τον σειριακό αριθμό ημέρας (ημέρες από 30/12/1899) ΧΩΡΙΣ
 * να τον μορφοποιήσει σαν ημερομηνία. Η επακόλουθη ανάγνωση με FORMATTED_VALUE
 * επιστρέφει τότε τον ίδιο τον αριθμό ως bare string (π.χ. "46267"). Το
 * `new Date("46267")` το παρερμηνεύει σαν έτος 46267/Ιανουάριος/1ο — σε
 * ελληνική μορφή ("el-GR", 2-digit/2-digit/numeric) αυτό βγαίνει ακριβώς
 * "01/01/46267", το bug που αναφέρθηκε.
 *
 * `normalizeSheetDate()` δέχεται οποιαδήποτε από τις πιθανές μορφές μιας
 * τιμής ημερομηνίας που μπορεί να επιστρέψει το readSheetAsObjects() —
 * ήδη-ISO "YYYY-MM-DD"(...), ελληνική "DD/MM/YYYY", bare Sheets serial
 * αριθμό, ή οτιδήποτε άλλο κατανοητό από το JS Date() — και πάντα επιστρέφει
 * ISO "YYYY-MM-DD" (ή "" αν δεν μπορεί να αναγνωριστεί/είναι κενό). Πρέπει
 * να καλείται ΠΑΝΤΑ πριν από (α) σύγκριση ημερομηνιών-string διαβασμένων από
 * το Sheet, ή (β) εμφάνιση/embedding τους σε email ή UI.
 *
 * Δεύτερο, ξεχωριστό bug εντοπίστηκε ΤΗΝ ΙΔΙΑ ΜΕΡΑ (24/08/2026, μετά το
 * πρώτο fix παραπάνω): μερικές γραμμές τηλεργασίας εμφανίζονταν σαν
 * "2026-16-09" (μήνας/ημέρα αντεστραμμένα ΜΕΣΑ σε ήδη dash-separated μορφή)
 * αντί για "16/09/2026". Ρίζα: το συγκεκριμένο κελί/στήλη είχε custom
 * μορφοποίηση ημερομηνίας "yyyy-dd-mm" αντί για το αναμενόμενο "yyyy-mm-dd"
 * τη στιγμή της εγγραφής — η FORMATTED_VALUE επιστρέφει τότε πιστά αυτή τη
 * (λάθος-σειράς) μορφή. Το πρώτο branch παρακάτω το θεωρούσε τυφλά ήδη
 * σωστό ISO. Τώρα ελέγχει αν το μεσαίο group είναι έγκυρος μήνας (1-12)· αν
 * όχι αλλά το ΤΕΛΕΥΤΑΙΟ group είναι, κάνει swap.
 */
export function normalizeSheetDate(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";

  // Ήδη ISO-shaped (ή με timestamp) — επιβεβαίωση ότι το μεσαίο group είναι
  // όντως έγκυρος μήνας πριν το εμπιστευτούμε ως YYYY-MM-DD (βλ. σχόλιο
  // "yyyy-dd-mm" bug παραπάνω).
  const isoLike = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) {
    const [, y, a, b] = isoLike;
    const an = Number(a);
    const bn = Number(b);
    if (an >= 1 && an <= 12) return `${y}-${a}-${b}`;
    if (bn >= 1 && bn <= 12) return `${y}-${b}-${a}`; // yyyy-dd-mm -> swap
    return `${y}-${a}-${b}`; // ούτε το ένα ούτε το άλλο έγκυρος μήνας — αδύνατο να μαντέψουμε, επιστρέφουμε ως έχει
  }

  // Ελληνική/ευρωπαϊκή μορφή D/M/YYYY ή DD/MM/YYYY (ό,τι επιστρέφει η Sheets
  // API όταν το κελί ΕΧΕΙ σωστή μορφοποίηση ημερομηνίας).
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // Bare Google Sheets σειριακός αριθμός ημέρας (κελί χωρίς μορφοποίηση
  // ημερομηνίας τη στιγμή της εγγραφής, βλ. σχόλιο παραπάνω) — περιορίζουμε
  // το εύρος σε ρεαλιστικές ημερομηνίες (~1968-2160) ώστε να μην
  // παρερμηνευτεί τυχαίος άσχετος αριθμός σαν ημερομηνία.
  if (/^\d{4,6}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 25000 && serial <= 95000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      const d = new Date(ms);
      if (!isNaN(d)) {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      }
    }
  }

  // Fallback: ό,τι άλλο μπορεί να καταλάβει το Date() του JS.
  const dt = new Date(s);
  if (!isNaN(dt)) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return s;
}

/** Μορφοποιεί μια Sheet-ημερομηνία (οποιαδήποτε μορφή, βλ. normalizeSheetDate) σε ελληνικά DD/MM/YYYY — για emails/UI. */
export function formatSheetDateEl(v) {
  const iso = normalizeSheetDate(v);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/**
 * Μετατρέπει σειριακό αριθμό ημέρας Google Sheets (days από 30/12/1899,
 * ό,τι επιστρέφει η Sheets API με valueRenderOption=UNFORMATTED_VALUE για
 * ένα date-typed κελί) σε ISO "YYYY-MM-DD". `""` αν μη έγκυρο.
 */
export function serialToIso(serial) {
  if (typeof serial !== "number" || !isFinite(serial)) return "";
  const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
  const d = new Date(ms);
  if (isNaN(d)) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Ριζική λύση στην ασάφεια "yyyy-dd-mm vs yyyy-mm-dd" όταν και οι δύο θέσεις
 * είναι ≤12 (βλ. normalizeSheetDate σχόλιο #2 — καμία ευρετική πάνω σε
 * FORMATTED_VALUE string δεν μπορεί να τη λύσει με σιγουριά, π.χ. "02"-"09"
 * θα μπορούσε να είναι είτε 2/9 είτε 9/2). Αν έχουμε την ΑΝΕΠΕΞΕΡΓΑΣΤΗ τιμή
 * του κελιού (μέσω sheets.js `getUnformattedColumns()`, UNFORMATTED_VALUE) —
 * πάντα καθαρός αριθμός για date-typed κελιά, καμία εξάρτηση από
 * μορφοποίηση/locale — τη χρησιμοποιούμε ΠΑΝΤΑ κατά προτεραιότητα.
 * Fallback στο (ασαφές, best-effort) `normalizeSheetDate(formattedValue)`
 * μόνο αν η ανεπεξέργαστη τιμή λείπει/δεν είναι αριθμός (π.χ. sheet χωρίς
 * UNFORMATTED_VALUE fetch, ή κενό κελί).
 */
export function resolveSheetDate(rawValue, formattedValue) {
  if (typeof rawValue === "number" && isFinite(rawValue) && rawValue > 0) {
    const iso = serialToIso(rawValue);
    if (iso) return iso;
  }
  return normalizeSheetDate(formattedValue);
}
