/**
 * Αποστολή email μέσω ενός μικρού, απομονωμένου Apps Script Web App
 * ("Email Relay") που κάνει μόνο MailApp.sendEmail() — καμία σχέση με
 * Sheets/auth/business logic, αυτά παραμένουν 100% στον Worker. Επιλέχτηκε
 * αντί για SendGrid: καμία εγγραφή σε τρίτο πάροχο, στέλνει από πραγματικό
 * Google account (π.χ. Google Workspace του optikitec.gr αν υπάρχει), όριο
 * 100-1500 emails/ημέρα (αρκετό για το portal). Βλ. apps-script/EmailRelay.gs
 * για τον κώδικα που μπαίνει στο Apps Script + SETUP.md για deployment.
 *
 * Τα Cloudflare Workers δεν στέλνουν email απευθείας, οπότε καλούμε το Web
 * App μέσω HTTP POST.
 *
 * Χρειάζεται 2 Worker secrets:
 *   EMAIL_RELAY_URL     -> το /exec URL του Apps Script deployment
 *   EMAIL_RELAY_SECRET  -> τυχαίο string, ίδιο με το RELAY_SECRET script property
 *                          στο Apps Script (απλή προστασία, το Web App είναι
 *                          δημόσιο URL ώστε να μπορεί να το καλέσει ο Worker)
 *
 * Αν λείπουν τα secrets, οι κλήσεις γίνονται no-op αντί να πετάξουν σφάλμα —
 * η αποστολή email δεν πρέπει ποτέ να μπλοκάρει την κύρια λειτουργία.
 *
 * Reply-To ανά ενέργεια (ρητή απόφαση χρήστη): τα emails "ενεργειών" (νέος
 * τεχνικός, χρέωση, νέα αίτηση/απόφαση άδειας) φαίνονται σαν να τα έστειλε
 * αυτός που έκανε την ενέργεια — η πραγματική αποστολή παραμένει ΠΑΝΤΑ ο
 * relay λογαριασμός (Apps Script MailApp δεν μπορεί να "γίνεται" δεκάδες
 * πραγματικοί αποστολείς), αλλά μπαίνει Reply-To = email του actor +
 * εμφανιζόμενο όνομα = το όνομά του, ώστε αν κάποιος πατήσει "Reply" να πάει
 * σε αυτόν, όχι σε σένα. Οι εβδομαδιαίες/μηνιαίες αναφορές (src/reports.js)
 * ΔΕΝ περνάνε replyTo — μένουν στον προεπιλεγμένο λογαριασμό (ρητή απόφαση).
 *
 * `attachments` (προαιρετικό): array από { filename, mimeType, bytes }, όπου
 * `bytes` είναι ArrayBuffer — π.χ. τα δικαιολογητικά αναρρωτικής άδειας που
 * επισυνάπτονται στη μηνιαία αναφορά λογιστή (βλ. src/reports.js). Κωδικοποιούνται
 * σε base64 εδώ πριν φύγουν ως JSON· το Apps Script relay (EmailRelay.gs) τα
 * αποκωδικοποιεί σε Blob και τα περνάει στο MailApp.sendEmail(). ΑΠΑΙΤΕΙ
 * ενημερωμένο deployment του Apps Script (βλ. σχόλιο στο EmailRelay.gs) — αν
 * το deployment είναι παλιό, το email φεύγει κανονικά απλά χωρίς συνημμένα
 * (ασφαλές fallback, το Apps Script αγνοεί άγνωστα πεδία στο JSON).
 */

import { readSheetAsObjects, appendAuditLog } from "./sheets.js";

/** ArrayBuffer -> base64 string, σε chunks ώστε να μη σκάσει το call stack
 * σε μεγάλα PDF (String.fromCharCode με spread σε ολόκληρο το array). */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function sendEmail(env, { to, subject, html, replyTo, replyToName, attachments }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { skipped: "no recipients" };
  if (!env.EMAIL_RELAY_URL || !env.EMAIL_RELAY_SECRET) return { skipped: "email not configured" };

  try {
    const body = {
      to: recipients,
      subject,
      html,
      secret: env.EMAIL_RELAY_SECRET,
      replyTo: replyTo || undefined,
      replyToName: replyToName || undefined,
    };
    if (attachments && attachments.length) {
      body.attachments = attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        contentBase64: arrayBufferToBase64(a.bytes),
      }));
    }

    const res = await fetch(env.EMAIL_RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return { error: `Email relay ${res.status}: ${data.error || "άγνωστο σφάλμα"}` };
    }
    return { success: true };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/**
 * Ορατότητα αποτυχημένων emails — γενικευμένο πρόταση Claude, αποδεκτή από
 * χρήστη (15/08/2026), μετά τη διερεύνηση του bug τηλεργασίας (item #4):
 * το sendEmail() ΠΟΤΕ δεν πετάει exception (σχεδιαστική επιλογή — μια
 * αποτυχία δεν πρέπει ποτέ να μπλοκάρει την κύρια λειτουργία), άρα μέχρι
 * τώρα ένα σφάλμα relay ή ένας κενός/άκυρος παραλήπτης περνούσε σιωπηλά σε
 * ΟΛΑ τα σημεία του portal που στέλνουν email, όχι μόνο στην τηλεργασία.
 *
 * Καλείται από κάθε caller του sendEmail() αμέσως μετά, με το αποτέλεσμα.
 * ΣΚΟΠΙΜΑ ΔΕΝ καταγράφει το `skipped: "email not configured"` — αυτό είναι
 * γνωστή/συστημική κατάσταση (λείπουν τα EMAIL_RELAY_URL/EMAIL_RELAY_SECRET
 * secrets, βλ. CLAUDE.md) που θα συνέβαινε σε ΚΑΘΕ email σε ΚΑΘΕ ενέργεια
 * του portal μέχρι να μπουν τα secrets — θα πλημμύριζε το AuditLog (κρατάει
 * μόνο τελευταίες 300 εγγραφές) με χιλιάδες πανομοιότυπες γραμμές χωρίς
 * κανένα νέο σήμα, αφού είναι ήδη τεκμηριωμένο αλλού. Καταγράφει όμως
 * `error` (πραγματικό σφάλμα relay/δικτύου) ΚΑΙ `skipped: "no recipients"`
 * (π.χ. ο εγκριτής/τεχνικός δεν έχει καταχωρημένο email) — και τα δύο είναι
 * σήμα ανά-ενέργεια, όχι συστημικός θόρυβος.
 */
export async function logEmailFailure(env, action, actor, result, context) {
  if (!result) return;
  const reason = result.error || (result.skipped && result.skipped !== "email not configured" ? result.skipped : null);
  if (!reason) return;
  // appendAuditLog() έχει ήδη δικό του try/catch (ποτέ δεν πρέπει το logging να μπλοκάρει την κύρια λειτουργία)
  await appendAuditLog(env, action, actor, { ...context, reason });
}

/**
 * Βρίσκει το εμφανιζόμενο όνομα ενός actor (TL, Backoffice, ή τεχνικός με
 * καταχωρημένο email) από το email του — για χρήση ως replyToName στο
 * sendEmail() παραπάνω. Ψάχνει TeamLeaders -> Backoffice -> Υπάλληλοι με τη
 * σειρά (ίδια προτεραιότητα με resolveStaffRole). Αν δεν βρεθεί πουθενά,
 * επιστρέφει το ίδιο το email ως fallback display name.
 */
export async function resolveActorName(env, email) {
  if (!email) return "";
  const [leaders, backoffice, employees] = await Promise.all([
    readSheetAsObjects(env, "TeamLeaders").catch(() => []),
    readSheetAsObjects(env, "Backoffice").catch(() => []),
    readSheetAsObjects(env, "Υπάλληλοι").catch(() => []),
  ]);
  const found =
    leaders.find((l) => l.Email === email) ||
    backoffice.find((b) => b.Email === email) ||
    employees.find((e) => e.Email === email);
  return (found && found.Name) || email;
}

/** URL του live portal — για CTA κουμπιά μέσα στα emails */
export const PORTAL_URL = "https://optikitec-portal.s-xronis.workers.dev";

/** Χρώματα badge ανά κατηγορία ενέργειας (βλ. emailTemplate) */
const BADGE_COLORS = {
  blue: { bg: "#E6F1FB", text: "#0C447C" },
  green: { bg: "#E3F5EC", text: "#0F6E56" },
  red: { bg: "#FBEAEA", text: "#A32D2D" },
};

/**
 * HTML template email — ίδιο brand με το portal (wordmark "OptikiTec",
 * accent μπλε #2E9BFF· άλλαξε από "Οπτική Τεχνική" στις 19/08/2026, ρητή
 * απαίτηση χρήστη — ταιριάζει με το branding σε sidebar/login/favicon). Table-based/inline styles παντού (όχι flexbox/grid/
 * custom fonts ως μόνη επιλογή) για συμβατότητα με Outlook/Gmail/Apple Mail.
 *
 * `badge`/`badgeColor` (προαιρετικά): μικρό χρωματιστό pill πάνω δεξιά που
 * δείχνει την κατηγορία ενέργειας με την πρώτη ματιά — 'blue' (ενημέρωση,
 * προεπιλογή), 'green' (έγκριση/καλωσόρισμα), 'red' (απόρριψη).
 * `ctaText`/`ctaUrl` (προαιρετικά): κουμπί προς το portal.
 * `listHtml` (προαιρετικό, raw HTML): block κάτω από το `rows` κουτί, για
 * λίστες πολλαπλών εγγραφών (π.χ. λίστα αδειών) που δεν χωράνε ευανάγνωστα
 * στο μονόγραμμο label/value σχήμα του `rows` — βλ. leaveListHtml στο
 * src/reports.js για παράδειγμα χρήσης. Το email.js μένει γενικό, δεν ξέρει
 * τίποτα για άδειες.
 * `actionsHtml` (προαιρετικό, raw HTML): πρόσθετο block κάτω από το CTA —
 * χρησιμοποιείται από τα one-click links έγκρισης/απόρριψης άδειας (βλ.
 * decideLinksHtml στο src/leaves.js), ώστε το email.js να μένει γενικό και
 * να μην ξέρει τίποτα για άδειες/tokens.
 */
export function emailTemplate({ badge, badgeColor = "blue", title, intro, rows, listHtml, ctaText, ctaUrl, actionsHtml, footer }) {
  const rowsHtml = (rows || [])
    .map(([label, value], i, arr) => {
      const border = i === arr.length - 1 ? "" : "border-bottom:1px solid #E7EAF0;";
      return `<tr><td style="padding:9px 0;${border}color:#8A93A3;font-size:12.5px;">${label}</td><td style="padding:9px 0;${border}text-align:right;font-weight:600;font-size:12.5px;color:#1B2333;">${value}</td></tr>`;
    })
    .join("");

  const colors = BADGE_COLORS[badgeColor] || BADGE_COLORS.blue;
  const badgeHtml = badge
    ? `<td style="text-align:right;vertical-align:middle;"><span style="display:inline-block;background:${colors.bg};color:${colors.text};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:5px 10px;border-radius:100px;">${badge}</span></td>`
    : "";

  const ctaHtml = ctaText && ctaUrl
    ? `<table role="presentation" style="border-collapse:collapse;margin-bottom:20px;"><tr><td style="background:#0F1A2E;border-radius:8px;"><a href="${ctaUrl}" style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;">${ctaText}</a></td></tr></table>`
    : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#F4F6F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #E7EAF0;border-radius:12px;overflow:hidden;">
    <div style="padding:22px 26px 18px;border-bottom:3px solid #2E9BFF;">
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;"><span style="font-family:Arial,sans-serif;font-weight:800;font-size:16px;color:#0F1A2E;letter-spacing:0.01em;">OptikiTec</span></td>
          ${badgeHtml}
        </tr>
      </table>
    </div>
    <div style="padding:22px 26px 8px;">
      <h1 style="font-size:19px;color:#1B2333;margin:0 0 10px;font-weight:700;">${title}</h1>
      <p style="font-size:13.5px;color:#5F6674;line-height:1.6;margin:0 0 18px;">${intro}</p>
      ${rows && rows.length ? `<div style="background:#F8F9FB;border-radius:10px;padding:4px 16px;margin-bottom:20px;"><table role="presentation" style="width:100%;border-collapse:collapse;">${rowsHtml}</table></div>` : ""}
      ${listHtml || ""}
      ${ctaHtml}
      ${actionsHtml || ""}
    </div>
    ${footer ? `<div style="padding:14px 26px 20px;border-top:1px solid #E7EAF0;"><p style="font-size:11.5px;color:#A6ADBB;margin:0;line-height:1.5;">${footer}</p></div>` : ""}
  </div>
</body></html>`;
}
