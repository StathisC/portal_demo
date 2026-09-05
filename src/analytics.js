/**
 * Αναλυτικά/KPI — νέο tab «Αναλυτικά» (πρόταση Claude, αποδεκτή από χρήστη,
 * 15/08/2026). Ρητή απόφαση χρήστη: ΕΤΑΙΡΙΚΑ στοιχεία, ορατά ΚΑΙ σε Team
 * Leaders ΚΑΙ σε Director (ΟΧΙ scoped ανά ομάδα TL, ΟΧΙ Backoffice — ίδιο
 * gate requireTeamLeader με το tab Στόλος/Εξοπλισμός).
 *
 * 3 metrics:
 *  1. Χρήση αδειών/μήνα (τελευταίοι 6 μήνες) — σύνολο εργάσιμων ημερών
 *     ΕΓΚΕΚΡΙΜΕΝΗΣ άδειας ΟΛΩΝ των τύπων (ΔΕΝ εξαιρεί Τηλεργασία εδώ, σε
 *     αντίθεση με το ατομικό υπόλοιπο αδειών — είναι εταιρικό KPI trend,
 *     όχι υπολογισμός υπολοίπου, ίδιο scope με τη μηνιαία αναφορά λογιστή
 *     βλ. sendAccountantMonthlyReport). Κάθε μήνας μετριέται clipped στα
 *     δικά του όρια — μια άδεια που εκτείνεται σε 2 μήνες μετράει σε ΚΑΘΕ
 *     μήνα μόνο τις ημέρες που πέφτουν μέσα σε αυτόν.
 *  2. Ποσοστό χρήσης στόλου — % οχημάτων με AssignedTo συμπληρωμένο ΤΩΡΑ.
 *  3. Μέσος όρος τεχνικών/ημέρα σε συνεργεία — τελευταίες (έως) 30
 *     αποθηκευμένες ημέρες συνεργείων (βλ. getCrewsKpiSummary στο crews.js).
 */

import { getApprovedLeavesInRange, calculateWorkDays } from "./leaves.js";
import { listVehicles } from "./fleet.js";
import { getCrewsKpiSummary } from "./crews.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthBounds(year, month) {
  // month: 0-indexed (JS Date convention)
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const iso = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return { start: iso(start), end: iso(end), label: `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}` };
}

/** Χρήση αδειών ανά μήνα, τελευταίοι 6 μήνες (ο τρέχων μήνας συμπεριλαμβάνεται, μέχρι σήμερα) */
async function leaveUsagePerMonth(env) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    months.push(monthBounds(now.getUTCFullYear(), now.getUTCMonth() - i));
  }
  const rangeStart = months[0].start;
  const rangeEnd = months[months.length - 1].end;
  const leaves = await getApprovedLeavesInRange(env, rangeStart, rangeEnd);

  return months.map((m) => {
    let days = 0;
    for (const l of leaves) {
      const clipStart = l.StartDate > m.start ? l.StartDate : m.start;
      const clipEnd = l.EndDate < m.end ? l.EndDate : m.end;
      if (clipStart > clipEnd) continue;
      days += calculateWorkDays(clipStart, clipEnd);
    }
    return { month: m.label, days };
  });
}

/** Ποσοστό χρήσης στόλου — % οχημάτων με AssignedTo συμπληρωμένο ΤΩΡΑ */
async function fleetUtilization(env) {
  const vehicles = await listVehicles(env);
  const total = vehicles.length;
  const assigned = vehicles.filter((v) => (v.AssignedTo || "").trim()).length;
  const percent = total ? Math.round((assigned / total) * 1000) / 10 : 0;
  return { total, assigned, percent };
}

export async function getKpiSummary(env) {
  const [leaveTrend, fleet, crews] = await Promise.all([
    leaveUsagePerMonth(env),
    fleetUtilization(env),
    getCrewsKpiSummary(env, { days: 30 }),
  ]);
  return { leaveTrend, fleet, crews };
}
