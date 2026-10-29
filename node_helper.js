const NodeHelper = require("node_helper");
const { evaluate } = require("./ventilation_rules");
const { AlexaReminder } = require("./alexa_reminder");

// MMM-ioBrokerRoomVentilation – node_helper
// - getBulk (in Paketen) statt vieler Einzel-Requests, natives fetch, Connection: close
// - busy-Guard, Cache der letzten guten Werte, Fallback auf Einzelabfragen
// - Lüftungsregeln in ventilation_rules.js
// - Geräte-Check: findet automatisch alle lowBat-/unreach-Datenpunkte (Standard: alle HmIP-Geräte),
//   ordnet sie den Räumen zu (config devices/batteries, optional ioBroker-Räume enum.rooms)
//   und zeigt nicht zugeordnete Geräte in einer Extra-Kachel.

const TIMEOUT_MS = 8000;
const BULK_CHUNK = 40;
const DISCOVERY_EVERY_MS = 6 * 60 * 60 * 1000;
const TRANSIENT = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"];
const LOG = "[MMM-ioBrokerRoomVentilation]";
const fs = require("fs");
const path = require("path");
const DEBUG_FILE = path.join(__dirname, "debug.log");
function dbg(msg) {
  try {
    if (fs.existsSync(DEBUG_FILE) && fs.statSync(DEBUG_FILE).size > 500000) fs.writeFileSync(DEBUG_FILE, "");
    fs.appendFileSync(DEBUG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch (e) { /* egal */ }
}

const DEFAULT_DEVICE_CHECK = {
  enabled: true,
  lowBatteryPatterns: ["hmip.0.devices.*.channels.0.lowBat"],
  unreachPatterns: ["hmip.0.devices.*.channels.0.unreach"],
  devicePattern: "hmip.0.devices.*",   // für Gerätenamen
  useEnumRooms: true,                   // ioBroker-Räume (enum.rooms) zusätzlich auswerten
  otherTileName: "Batterie schwach",    // Box für Geräte ohne Raum (nur sichtbar, wenn eines betroffen ist)
  otherTileShowOffline: false           // true = dort auch nicht erreichbare Geräte auflisten
};

function errCode(e) {
  return e?.cause?.code || e?.code || e?.name || e?.message || String(e);
}
function isTrue(v) {
  return v === true || v === 1 || v === "true";
}
function nameOf(common, fallback) {
  const n = common && common.name;
  if (!n) return fallback;
  if (typeof n === "string") return n;
  return n.de || n.en || Object.values(n)[0] || fallback;
}
// "hmip.0.devices.3014F7….channels.0.lowBat" -> "hmip.0.devices.3014F7…"
function deviceRoot(id) {
  const m = /^(.*?\.devices\.[^.]+)/.exec(id);
  if (m) return m[1];
  const c = id.indexOf(".channels.");
  if (c > 0) return id.slice(0, c);
  return id.split(".").slice(0, -1).join(".");
}

// Raum-Konfiguration vervollständigen (group-Kurzform, globale Außen-IDs)
function normalizeRoom(room, config) {
  const g = room.group ? `hmip.0.groups.${room.group}` : null;
  const batteryIDs = Array.isArray(room.batteries) && room.batteries.length
    ? room.batteries
    : [room.battery1, room.battery2].filter(Boolean);
  const devices = (room.devices || []).map((d) => (d.includes(".") ? d : `hmip.0.devices.${d}`));
  return {
    ...room,
    temperatureID: room.temperatureID || (g && `${g}.actualTemperature`),
    setTemperatureID: room.setTemperatureID || (g && `${g}.setPointTemperature`),
    humidityID: room.humidityID || (g && `${g}.humidity`),
    windowStatusID: room.windowStatusID || (g && `${g}.windowOpen`),
    outsideTemperatureID: room.outsideTemperatureID || config.outsideTemperatureID,
    outsideHumidityID: room.outsideHumidityID || config.outsideHumidityID,
    batteryIDs,
    deviceRoots: new Set([...devices, ...batteryIDs.map(deviceRoot)])
  };
}

module.exports = NodeHelper.create({
  start() {
    dbg("node_helper gestartet (Version mit Licht-Klick)");
    console.log(`Starting node helper for ${LOG.slice(1, -1)} (getBulk + Geräte-Check)...`);
    this.busy = false;
    this.cache = {}; // id -> { val, ts, lc }
    this.bulkSupported = true;
    this.discovery = null; // { indicators: [{id, kind, root}], names: {root: name}, enums: [{name, roots:Set}] }
    this.discoveryAt = 0;
    this.reminder = new AlexaReminder((id, value) => this.postValue(id, value), (m) => { console.log(`${LOG} ${m}`); dbg(m); });
  },

  // wie MMM-ioBrokerAlexaButtons: setValueFromBody (POST), damit Sonderzeichen/SSML sicher ankommen
  async postValue(id, value) {
    const url = `${this.baseURL}/setValueFromBody/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Connection: "close" },
      body: String(value),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_ROOM_DATA") this.fetchRoomData(payload);
    else if (notification === "SET_LIGHT") this.setLight(payload);
    else if (notification === "LIGHT_CLICK") dbg(`Klick im Browser: ${JSON.stringify(payload)}`);
  },

  // Schaltet nur das in der config hinterlegte lightID des Raums (kein beliebiger Datenpunkt)
  async setLight({ config, room, value }) {
    const r = (config.rooms || []).find((x) => x.name === room);
    const id = r && r.lightID;
    if (!id) {
      dbg(`SET_LIGHT ${room}: keine lightID in config`);
      return this.sendSocketNotification("SET_LIGHT_RESULT", { room, ok: false });
    }
    const url = `http://${config.ip}:${config.port}/set/${encodeURIComponent(id)}?value=${value ? "true" : "false"}`;
    dbg(`SET_LIGHT ${room} -> ${value} | ${url}`);
    try {
      const res = await this.httpGetJson(url, 1);
      dbg(`Antwort ioBroker: ${JSON.stringify(res)}`);
      if (this.cache[id]) this.cache[id].val = !!value;
      console.log(`${LOG} Licht ${room} -> ${value ? "an" : "aus"}`);
      this.sendSocketNotification("SET_LIGHT_RESULT", { room, ok: true });
    } catch (e) {
      console.error(`${LOG} Licht ${room} schalten fehlgeschlagen: ${errCode(e)}`);
      dbg(`FEHLER ${room}: ${errCode(e)} ${e.status || ""}`);
      this.sendSocketNotification("SET_LIGHT_RESULT", { room, ok: false });
    }
  },

  async httpGetJson(url, retries = 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Connection: "close" } });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      if (retries > 0 && (TRANSIENT.includes(errCode(e)) || e.name === "TimeoutError")) {
        await new Promise((r) => setTimeout(r, 300));
        return this.httpGetJson(url, retries - 1);
      }
      throw e;
    }
  },

  async getBulk(baseURL, ids) {
    const map = {};
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const part = ids.slice(i, i + BULK_CHUNK);
      const list = await this.httpGetJson(`${baseURL}/getBulk/${part.map(encodeURIComponent).join(",")}`);
      if (!Array.isArray(list)) throw new Error("getBulk: unerwartete Antwort");
      for (const s of list) if (s && s.id) map[s.id] = { val: s.val, ts: s.ts, lc: s.lc };
    }
    return map;
  },

  async getSingles(baseURL, ids, concurrency = 3) {
    const map = {};
    const errors = [];
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          const s = await this.httpGetJson(`${baseURL}/get/${encodeURIComponent(id)}`);
          if (s) map[id] = { val: s.val, ts: s.ts, lc: s.lc };
        } catch (e) {
          errors.push(`${id}: ${errCode(e)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { map, errors };
  },

  async getObjects(baseURL, pattern, type) {
    const q = `pattern=${encodeURIComponent(pattern)}${type ? `&type=${type}` : ""}`;
    const res = await this.httpGetJson(`${baseURL}/objects?${q}`);
    return res && typeof res === "object" ? res : {};
  },

  // Sucht einmal alle 6 h nach Batterie-/Erreichbarkeits-Datenpunkten
  async discover(baseURL, dc) {
    if (this.discovery && Date.now() - this.discoveryAt < DISCOVERY_EVERY_MS) return;
    this.discoveryAt = Date.now(); // auch bei Fehler nicht jede Runde neu versuchen
    try {
      const indicators = [];
      for (const [kind, patterns] of [["lowBat", dc.lowBatteryPatterns], ["unreach", dc.unreachPatterns]]) {
        for (const p of patterns || []) {
          const objs = await this.getObjects(baseURL, p, "state");
          for (const id of Object.keys(objs)) indicators.push({ id, kind, root: deviceRoot(id) });
        }
      }
      const names = {};
      if (dc.devicePattern) {
        const devs = await this.getObjects(baseURL, dc.devicePattern, "device");
        for (const [id, o] of Object.entries(devs)) names[id] = nameOf(o.common, id.split(".").pop());
      }
      let enums = [];
      if (dc.useEnumRooms) {
        try {
          const en = await this.getObjects(baseURL, "enum.rooms.*", "enum");
          enums = Object.entries(en).map(([id, o]) => ({
            id,
            name: nameOf(o.common, id.split(".").pop()).toLowerCase(),
            roots: new Set((o.common?.members || []).map(deviceRoot))
          }));
        } catch (e) { /* keine Räume angelegt – egal */ }
      }
      this.discovery = { indicators, names, enums };
      const devCount = new Set(indicators.map((i) => i.root)).size;
      console.log(`${LOG} Geräte-Check: ${indicators.length} Datenpunkte von ${devCount} Geräten gefunden, ${enums.length} ioBroker-Räume`);
      dbg(`Geräte-Check: ${indicators.length} Datenpunkte von ${devCount} Geräten, ${Object.keys(names).length} Namen, ${enums.length} ioBroker-Räume`);
    } catch (e) {
      console.warn(`${LOG} Geräte-Suche fehlgeschlagen (${errCode(e)}), nutze nur config-Batterien`);
      dbg(`Geräte-Suche fehlgeschlagen: ${errCode(e)} ${e.status || ""}`);
    }
  },

  async fetchRoomData(config) {
    if (this.busy) return;
    this.busy = true;
    const baseURL = `http://${config.ip}:${config.port}`;
    this.baseURL = baseURL;
    const dc = { ...DEFAULT_DEVICE_CHECK, ...(config.deviceCheck || {}) };

    try {
      if (dc.enabled) await this.discover(baseURL, dc);
      const disc = this.discovery || { indicators: [], names: {}, enums: [] };

      const rooms = config.rooms.map((r) => normalizeRoom(r, config));

      // ioBroker-Räume per Name oder explizit (room.enum) zuordnen
      for (const room of rooms) {
        const en = disc.enums.find((e) => e.id === room.enum || e.name === String(room.name).toLowerCase());
        if (en) en.roots.forEach((r) => room.deviceRoots.add(r));
      }

      // Indikatoren je Raum; config-Batterien immer mitnehmen
      const assigned = new Set();
      for (const room of rooms) {
        const list = disc.indicators.filter((i) => room.deviceRoots.has(i.root));
        // config-Batterien und config-Geräte immer prüfen, auch wenn die Suche nichts liefert
        const fallback = room.batteryIDs.map((id) => ({ id, kind: "lowBat", root: deviceRoot(id) }));
        for (const root of room.deviceRoots) {
          if (!root.startsWith("hmip.0.devices.")) continue;
          fallback.push({ id: `${root}.channels.0.lowBat`, kind: "lowBat", root });
          fallback.push({ id: `${root}.channels.0.unreach`, kind: "unreach", root });
        }
        for (const f of fallback) if (!list.some((i) => i.id === f.id)) list.push(f);
        list.forEach((i) => assigned.add(i.id));
        room.indicators = list;
      }
      const unassigned = disc.indicators.filter((i) => !assigned.has(i.id));

      const allIds = new Set();
      for (const room of rooms) {
        [room.temperatureID, room.setTemperatureID, room.humidityID, room.windowStatusID,
          room.outsideTemperatureID, room.outsideHumidityID, room.lightID]
          .filter(Boolean).forEach((id) => allIds.add(id));
        room.indicators.forEach((i) => allIds.add(i.id));
      }
      unassigned.forEach((i) => allIds.add(i.id));
      const ids = [...allIds];

      let fresh = {};
      const failed = new Set();
      if (this.bulkSupported) {
        try {
          fresh = await this.getBulk(baseURL, ids);
        } catch (e) {
          if (e.status === 404 || e.status === 400) {
            console.warn(`${LOG} getBulk nicht verfügbar, nutze Einzelabfragen`);
            this.bulkSupported = false;
          } else {
            console.error(`${LOG} getBulk fehlgeschlagen: ${errCode(e)}`);
            ids.forEach((id) => failed.add(id));
          }
        }
      }
      if (!this.bulkSupported) {
        const { map, errors } = await this.getSingles(baseURL, ids);
        fresh = map;
        if (errors.length) console.error(`${LOG} ${errors.length} Datenpunkte fehlgeschlagen: ${errors.slice(0, 5).join(" | ")}`);
        ids.filter((id) => !(id in map)).forEach((id) => failed.add(id));
      }

      // getBulk liefert kein lc -> für offene Fenster einzeln nachladen
      for (const room of rooms) {
        const w = room.windowStatusID && fresh[room.windowStatusID];
        if (w && w.val && w.lc === undefined) {
          try {
            const s = await this.httpGetJson(`${baseURL}/get/${encodeURIComponent(room.windowStatusID)}`);
            if (s) w.lc = s.lc;
          } catch (e) {
            const cached = this.cache[room.windowStatusID];
            if (cached && cached.val) w.lc = cached.lc;
          }
        }
      }

      for (const [id, s] of Object.entries(fresh)) this.cache[id] = s;
      const val = (id) => (id && this.cache[id] ? this.cache[id].val : null);

      const issuesOf = (indicators) => {
        const byRoot = {};
        for (const i of indicators) {
          if (!isTrue(val(i.id))) continue;
          const cur = byRoot[i.root];
          // offline wiegt schwerer als Batterie
          if (!cur || i.kind === "unreach") byRoot[i.root] = { name: disc.names[i.root] || i.root.split(".").pop(), kind: i.kind };
        }
        return Object.values(byRoot);
      };

      const roomData = rooms.map((room) => {
        const roomIds = [room.temperatureID, room.setTemperatureID, room.humidityID,
          room.windowStatusID, room.outsideTemperatureID, room.lightID].filter(Boolean);
        const hasError = roomIds.some((id) => failed.has(id));

        const window = room.windowStatusID ? this.cache[room.windowStatusID] : null;
        const lastChanged = window ? (window.lc ?? null) : null;
        const openDuration = window && window.val && lastChanged ? Math.floor((Date.now() - lastChanged) / 60000) : 0;

        const deviceIssues = issuesOf(room.indicators);
        const data = {
          name: room.name,
          temperature: val(room.temperatureID),
          setTemperature: val(room.setTemperatureID),
          humidity: val(room.humidityID),
          windowStatus: window ? window.val : null,
          outsideTemperature: val(room.outsideTemperatureID),
          outsideHumidity: val(room.outsideHumidityID),
          lastChanged,
          openDuration,
          lightStatus: room.lightID ? val(room.lightID) : null,
          deviceIssues,
          deviceCount: new Set(room.indicators.map((i) => i.root)).size,
          lowBattery: deviceIssues.length > 0,
          hasError
        };
        data.advice = evaluate(data, { ...(config.rules || {}), ...(room.rules || {}) });
        return data;
      });

      // Alexa-Erinnerung bei zu lange offenem Fenster
      try {
        const alarms = await this.reminder.check(rooms, roomData, config.alexaReminder);
        roomData.forEach((d) => Object.assign(d, alarms[d.name] || {}));
      } catch (e) {
        console.error(`${LOG} Alexa-Erinnerung fehlgeschlagen: ${errCode(e)}`);
      }

      // Geräte ohne Raum: eigene Box mit vollständiger Liste, nur wenn mindestens eines betroffen ist
      const otherList = [];
      const seen = new Set();
      for (const i of unassigned) {
        if (seen.has(i.root) || !isTrue(val(i.id))) continue;
        if (i.kind !== "lowBat" && !dc.otherTileShowOffline) continue;
        seen.add(i.root);
        otherList.push({ name: disc.names[i.root] || i.root.split(".").pop(), kind: i.kind });
      }
      otherList.sort((a, b) => a.name.localeCompare(b.name, "de"));
      const sig = otherList.map((x) => `${x.name}:${x.kind}`).join("|");
      if (sig !== this.lastOtherSig) {
        dbg(`Geräte ohne Raum mit Problem: ${otherList.length ? sig : "keine"}`);
        this.lastOtherSig = sig;
      }
      if (otherList.length) {
        roomData.push({
          name: dc.otherTileName, isDeviceTile: true, deviceList: otherList,
          temperature: null, humidity: null, lightStatus: null,
          advice: { status: "standard", label: "", detail: "" }
        });
      }

      this.sendSocketNotification("ROOM_DATA_RESULT", roomData);
    } catch (e) {
      console.error(`${LOG} unerwarteter Fehler`, e);
    } finally {
      this.busy = false;
    }
  }
});
