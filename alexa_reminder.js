// Alexa-Erinnerung für MMM-ioBrokerRoomVentilation
// Steht ein Fenster länger offen als erlaubt (advice.reason === "tooLong"), wird auf der Alexa
// des Raums N-mal im Abstand von X Sekunden ein Alarmton + Durchsage abgespielt.
// Fenster zu -> Zähler zurückgesetzt. Alles über die config einstellbar (alexaReminder).

const DEFAULT_REMINDER = {
  enabled: true,
  repeat: 3,                // Anzahl Alarme
  intervalSec: 60,          // Abstand zwischen den Alarmen
  volume: 60,               // Lautstärke 0-100 (null = nicht ändern)
  mode: "speak",            // "speak" = Alarmton + Text (wie Alexa-Buttons), "ssml", "announcement" = Durchsage mit Gong
  sound: "soundbank://soundlibrary/buzzers_pistols/buzzers_pistols_12",
  text: "Achtung! Das Fenster im Raum {room} ist seit {minutes} Minuten offen. Bitte schließen.",
  quietHours: null,         // z. B. { from: "21:30", to: "06:30" } -> in dieser Zeit keine Durchsage
  fallbackAlexa: null       // Alexa für Räume ohne eigene (z. B. Küche), null = dann nur Bildschirm
};

function toMin(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}
function inQuietHours(q, now = new Date()) {
  if (!q || !q.from || !q.to) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const f = toMin(q.from), to = toMin(q.to);
  return f <= to ? t >= f && t < to : t >= f || t < to; // auch über Mitternacht
}
function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}

class AlexaReminder {
  constructor(setState, log) {
    this.setState = setState; // async (id, value) => {}
    this.log = log || (() => {});
    this.state = {};          // Raumname -> { openedAt, count, last }
  }

  // Gibt pro Raum { alarmCount, alarmMax } zurück (für die Anzeige)
  async check(rooms, roomData, globalCfg, now = Date.now()) {
    const out = {};
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const data = roomData[i];
      const cfg = { ...DEFAULT_REMINDER, ...(globalCfg || {}), ...(room.alexaReminder || {}) };
      const key = room.name;
      const tooLong = data && data.advice && data.advice.reason === "tooLong";

      if (!cfg.enabled || !tooLong) {
        if (this.state[key] && !data?.windowStatus) delete this.state[key];
        out[key] = { alarmCount: this.state[key]?.count || 0, alarmMax: cfg.repeat };
        continue;
      }

      let st = this.state[key];
      if (!st || st.openedAt !== data.lastChanged) st = this.state[key] = { openedAt: data.lastChanged, count: 0, last: 0 };

      const due = st.count < cfg.repeat && now - st.last >= cfg.intervalSec * 1000 - 2000; // 2 s Toleranz (Abfrage-Takt)
      const targets = [].concat(room.alexa || cfg.fallbackAlexa || []).filter(Boolean);
      if (due && !inQuietHours(cfg.quietHours, new Date(now))) {
        st.count++;
        st.last = now;
        const text = cfg.text.replace("{room}", room.name).replace("{minutes}", data.openDuration);
        for (const dev of targets) await this.say(dev, text, cfg, `${key} ${st.count}/${cfg.repeat}`);
        if (!targets.length) this.log(`Erinnerung ${key} ${st.count}/${cfg.repeat}: keine Alexa konfiguriert, nur Anzeige`);
      }
      out[key] = { alarmCount: st.count, alarmMax: cfg.repeat };
    }
    return out;
  }

  async say(dev, text, cfg, tag) {
    const id = typeof dev === "object" ? dev.id : dev;
    const volume = typeof dev === "object" && dev.volume !== undefined ? dev.volume : cfg.volume;
    const base = id.replace(/\.Commands.*$/, "");
    const hasVol = volume !== null && volume !== undefined;
    const audio = cfg.sound ? `<audio src='${cfg.sound}'/>` : "";
    try {
      if (cfg.mode === "ssml") {
        if (hasVol) await this.setState(`${base}.Commands.speakvolume`, volume);
        await this.setState(`${base}.Commands.ssml`, `<speak>${audio}${xmlEscape(text)}</speak>`);
      } else if (cfg.mode === "announcement") {
        await this.setState(`${base}.Commands.announcement`, `${hasVol ? volume + ";" : ""}${text}`);
      } else {
        await this.setState(`${base}.Commands.speak`, `${hasVol ? volume + ";" : ""}${audio}${text}`);
      }
      this.log(`Alexa ${tag} -> ${base} (${cfg.mode}, Vol ${hasVol ? volume : "-"})`);
    } catch (e) {
      this.log(`Alexa ${tag} -> ${base} FEHLER: ${e?.cause?.code || e?.message || e}`);
    }
  }
}

module.exports = { AlexaReminder, inQuietHours, DEFAULT_REMINDER };
