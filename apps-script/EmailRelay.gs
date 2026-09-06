/**
 * Demo Portal — Email Relay
 *
 * Μικρό, απομονωμένο Apps Script Web App. Η ΜΟΝΗ δουλειά του είναι να
 * στέλνει email μέσω MailApp όταν τον καλέσει ο Cloudflare Worker
 * (src/email.js). ΔΕΝ διαβάζει/γράφει στο Sheet, δεν κάνει auth, δεν έχει
 * καμία επιχειρησιακή λογική — γι' αυτό δεν έρχεται σε αντίθεση με την
 * απόφαση "Δεν υπάρχει Apps Script" που αφορούσε το backend (βλ. CLAUDE.md).
 *
 * ΕΓΚΑΤΑΣΤΑΣΗ (μία φορά):
 *  1. script.google.com -> New project -> επικόλλησε ΟΛΟ αυτό το αρχείο.
 *  2. Project Settings (γρανάζι, αριστερά) -> Script Properties -> Add
 *     property: RELAY_SECRET = ένα τυχαίο μεγάλο string (π.χ. από
 *     https://www.random.org/strings ή `openssl rand -hex 24`).
 *     Το ΙΔΙΟ string θα μπει και στο wrangler secret EMAIL_RELAY_SECRET.
 *  3. Deploy -> New deployment -> τύπος: Web app
 *       Execute as: Me (έτσι τα email φεύγουν από το δικό σου Google account)
 *       Who has access: Anyone
 *  4. Copy το Web app URL (καταλήγει σε /exec) -> wrangler secret EMAIL_RELAY_URL
 *
 * Κάθε φορά που αλλάζεις τον κώδικα εδώ, χρειάζεται "New deployment" (ή
 * "Manage deployments" -> edit -> New version) για να ενημερωθεί το /exec URL.
 */

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty("RELAY_SECRET");

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: "invalid json" });
  }

  if (!expectedSecret || body.secret !== expectedSecret) {
    return jsonResponse({ error: "unauthorized" });
  }

  var to = Array.isArray(body.to) ? body.to.filter(Boolean).join(",") : body.to;
  if (!to || !body.subject || !body.html) {
    return jsonResponse({ error: "missing to/subject/html" });
  }

  // replyTo/replyToName (προαιρετικά): emails "ενεργειών" (νέος τεχνικός,
  // χρέωση, αίτηση/απόφαση άδειας) φαίνονται σαν να τα έστειλε αυτός που
  // έκανε την ενέργεια — η πραγματική αποστολή παραμένει πάντα αυτός ο
  // λογαριασμός (Execute as: Me), αλλά replyTo/name αλλάζουν το Reply-To
  // header + το εμφανιζόμενο όνομα αποστολέα. Βλ. src/email.js.
  var message = {
    to: to,
    subject: body.subject,
    htmlBody: body.html,
  };
  if (body.replyTo) message.replyTo = body.replyTo;
  if (body.replyToName) message.name = body.replyToName;

  // Συνημμένα (προαιρετικά, π.χ. δικαιολογητικά αναρρωτικής στη μηνιαία
  // αναφορά λογιστή) — βλ. src/email.js. Κάθε στοιχείο: { filename,
  // mimeType, contentBase64 }, μετατρέπεται σε Blob για το MailApp.
  if (Array.isArray(body.attachments) && body.attachments.length) {
    message.attachments = body.attachments.map(function (att) {
      return Utilities.newBlob(
        Utilities.base64Decode(att.contentBase64),
        att.mimeType || "application/octet-stream",
        att.filename || "attachment"
      );
    });
  }

  try {
    MailApp.sendEmail(message);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
