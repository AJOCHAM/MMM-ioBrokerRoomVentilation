// Lüftungsregeln für MMM-ioBrokerRoomVentilation
// Entscheidet pro Raum, ob gelüftet / geschlossen werden soll.
// Kernidee: Lüften trocknet nur, wenn die Außenluft absolut weniger Wasser enthält (g/m³)
// als die Raumluft. Relative Feuchte allein sagt das nicht.

const DEFAULT_RULES = {
  openAbove: 60,          // rel. Feuchte innen (%) ab der "Fenster öffnen" angezeigt wird
  dryBelow: 52,           // rel. Feuchte innen (%) ab der "trocken genug, schließen" kommt (Hysterese)
  minAbsDiff: 1.0,        // g/m³: so viel trockener muss die Außenluft sein, damit Lüften lohnt
  wetterOutsideMargin: 0.5, // g/m³: draußen um so viel feuchter -> sofort schließen
  heatingDelta: 3,        // Heizperiode, wenn innen mindestens so viel wärmer als außen
  // Maximale Stoßlüft-Dauer (min) nach Außentemperatur. Erste passende Stufe gewinnt.
  maxOpenByOutsideTemp: [
    { below: 0, minutes: 5 },
    { below: 5, minutes: 8 },
    { below: 10, minutes: 10 },
    { below: 15, minutes: 15 },
    { below: 20, minutes: 20 }
    // darüber: kein Zeitlimit
  ],
  maxOpenMinutes: null    // feste Lüftdauer in min (überschreibt die Tabelle), z. B. pro Raum
};

// Absolute Feuchte in g/m³ (Magnus-Formel)
function absHumidity(t, rh) {
  if (!isNum(t) || !isNum(rh)) return null;
  const ps = 6.112 * Math.exp((17.67 * t) / (t + 243.5)); // hPa
  return (ps * rh * 2.1674) / (273.15 + t);
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function maxOpenMinutes(tOut, rules) {
  if (!isNum(tOut)) return 10; // ohne Außentemperatur: konservativ
  const step = rules.maxOpenByOutsideTemp.find((s) => tOut < s.below);
  return step ? step.minutes : null;
}

// Liefert { status, label, detail, absIn, absOut, maxOpen }
// status: "standard" | "aware" | "alert" | "urgent"
function evaluateCore(r, rulesIn) {
  const rules = { ...DEFAULT_RULES, ...(rulesIn || {}) };
  const tIn = toNum(r.temperature);
  const rhIn = toNum(r.humidity);
  const tOut = toNum(r.outsideTemperature);
  const rhOut = toNum(r.outsideHumidity);
  const open = r.windowStatus === true || r.windowStatus === 1 || r.windowStatus === "true";
  const mins = r.openDuration || 0;

  const absIn = absHumidity(tIn, rhIn);
  const absOut = absHumidity(tOut, rhOut);
  const heating = isNum(tIn) && isNum(tOut) && tIn >= tOut + rules.heatingDelta;
  const maxOpen = heating ? (rules.maxOpenMinutes || maxOpenMinutes(tOut, rules)) : null;

  // Bringt Lüften Trockenheit? Mit Außenfeuchte exakt, sonst Näherung über Temperatur
  let drying = null; // true / false / null (unbekannt)
  if (absIn !== null && absOut !== null) drying = absIn - absOut >= rules.minAbsDiff;
  else if (isNum(tIn) && isNum(tOut)) drying = tIn >= tOut + rules.heatingDelta;
  const outsideWetter = absIn !== null && absOut !== null && absOut > absIn + rules.wetterOutsideMargin;

  const res = (status, label, detail = "", reason = null) => ({
    status, label, detail, reason,
    absIn: round1(absIn), absOut: round1(absOut), maxOpen
  });

  if (open) {
    // 1. Zeitlimit hat Vorrang - egal wie feucht es noch ist
    if (maxOpen && mins >= maxOpen)
      return res("urgent", "Fenster schließen!", `${mins} / ${maxOpen} min offen`, "tooLong");
    // 2. Außenluft feuchter: Lüften macht es schlimmer (z. B. Keller im Sommer)
    if (outsideWetter)
      return res("alert", "Schließen – draußen feuchter", `${mins} min offen`);
    // 3. Ziel erreicht
    if (heating && isNum(rhIn) && rhIn < rules.dryBelow)
      return res("alert", "Trocken – schließen", `${mins} min offen`);
    // 4. Lüftet noch
    if (maxOpen) return res("aware", "Lüftet", `noch ${maxOpen - mins} min`);
    return res("aware", "Lüftet", `${mins} min`);
  }

  // Fenster zu
  if (isNum(rhIn) && rhIn > rules.openAbove) {
    if (drying === false) return res("standard", "", "feucht – draußen auch");
    return res("aware", "Fenster öffnen", maxOpen ? `${maxOpen} min lüften` : "");
  }
  return res("standard", "", "");
}

// Fensterzustand für die Anzeige:
// "closed" | "shouldOpen" | "open" | "shouldClose" | "unknown" (kein Fenstersensor)
function evaluate(r, rulesIn) {
  const a = evaluateCore(r, rulesIn);
  const ws = r.windowStatus;
  const open = ws === true || ws === 1 || ws === "true";
  const wantsOpen = a.label === "Fenster öffnen";
  if (ws === null || ws === undefined) a.win = wantsOpen ? "shouldOpen" : "unknown";
  else if (open) a.win = (a.status === "urgent" || a.status === "alert") ? "shouldClose" : "open";
  else a.win = wantsOpen ? "shouldOpen" : "closed";
  const mins = r.openDuration || 0;
  a.progress = open && a.maxOpen ? Math.min(100, Math.round((mins / a.maxOpen) * 100)) : null;
  return a;
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round1(v) {
  return v === null ? null : Math.round(v * 10) / 10;
}

module.exports = { evaluate, absHumidity, DEFAULT_RULES };
