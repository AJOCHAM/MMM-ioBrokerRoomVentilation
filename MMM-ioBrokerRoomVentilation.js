Module.register("MMM-ioBrokerRoomVentilation", {
  defaults: {
    ip: "iobroker.local",
    port: "8082",
    updateInterval: 10000,
    // Klick auf eine Kachel mit brennendem Licht:
    // "off" = nur ausschalten, "toggle" = an/aus umschalten, false = Klick deaktiviert
    lightClick: "off",
    // Layout
    width: "330px",        // Breite des Moduls (z. B. "330px", "100%", "26vw")
    tileMinWidth: "96px",  // Mindestbreite einer Kachel – daraus ergibt sich die Spaltenzahl
    sortByState: false,    // true = Räume mit Handlungsbedarf nach vorne
    rooms: []
  },

  start() {
    this.roomData = [];
    this.prevState = {};    // Raumname -> letzter Anzeigezustand (für die Wechsel-Animation)
    this.lastPayload = "";
    this.pendingLight = {}; // Raumname -> { val, until } (Anzeige sofort, bis ioBroker bestätigt)
    this.getRoomData();
    setInterval(() => this.getRoomData(), this.config.updateInterval);

    // Ein Listener für das ganze Modul (überlebt updateDom)
    document.addEventListener("click", (e) => {
      if (!e.target.closest(`#${this.identifier}`)) return;
      const box = e.target.closest("[data-light-room]");
      const tile = e.target.closest(".room-box");
      this.sendSocketNotification("LIGHT_CLICK", {
        tile: tile ? tile.textContent.trim().split(/\s+/)[0] : null,
        clickable: !!box,
        lightClick: this.config.lightClick
      });
      if (box) this.onLightClick(box.dataset.lightRoom);
    });
  },

  onLightClick(roomName) {
    const mode = this.config.lightClick;
    if (!mode) return;
    const room = this.roomData.find((r) => r.name === roomName);
    if (!room || room.lightStatus === null) return;
    let target;
    if (mode === "toggle") target = !room.lightStatus;
    else if (room.lightStatus) target = false;
    else return; // Licht ist schon aus

    room.lightStatus = target;
    room.lightPending = true;
    this.pendingLight[roomName] = { val: target, until: Date.now() + 15000 };
    this.updateDom(0);
    this.sendSocketNotification("SET_LIGHT", { config: this.config, room: roomName, value: target });
  },

  getRoomData() {
    this.sendSocketNotification("GET_ROOM_DATA", this.config);
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "ROOM_DATA_RESULT") {
      const now = Date.now();
      for (const r of payload) {
        const p = this.pendingLight[r.name];
        if (!p) continue;
        if (r.lightStatus === p.val || now > p.until) delete this.pendingLight[r.name];
        else { r.lightStatus = p.val; r.lightPending = true; } // ioBroker hat noch den alten Wert
      }
      // Nur neu zeichnen, wenn sich etwas geändert hat (sonst laufen Animationen ständig neu an)
      const sig = JSON.stringify(payload);
      if (sig === this.lastPayload) return;
      this.lastPayload = sig;
      for (const r of payload) {
        const st = `${r.advice ? r.advice.win : ""}|${r.advice ? r.advice.status : ""}`;
        r.justChanged = this.prevState[r.name] !== undefined && this.prevState[r.name] !== st;
        this.prevState[r.name] = st;
      }
      this.roomData = payload;
      this.updateDom();
    } else if (notification === "SET_LIGHT_RESULT" && !payload.ok) {
      // Schalten fehlgeschlagen -> beim nächsten Abruf echten Zustand zeigen
      delete this.pendingLight[payload.room];
      const r = this.roomData.find((x) => x.name === payload.room);
      if (r) { r.lightPending = false; r.lightError = true; this.updateDom(0); }
      this.getRoomData();
    }
  },

  getTemplate() {
    return "MMM-ioBrokerRoomVentilation_small3.njk";
  },

  getTemplateData() {
    const alarmRooms = this.roomData
      .filter((r) => r.advice && r.advice.reason === "tooLong")
      .map((r) => r.name);
    const rank = { shouldClose: 0, shouldOpen: 1, open: 2, closed: 3, unknown: 3 };
    let rooms = this.roomData;
    if (this.config.sortByState) {
      rooms = [...rooms].sort((x, y) =>
        (x.isDeviceTile ? 9 : rank[(x.advice || {}).win] ?? 3) - (y.isDeviceTile ? 9 : rank[(y.advice || {}).win] ?? 3));
    }
    const style = `--vent-width:${this.config.width};--vent-tile:${this.config.tileMinWidth}`;
    return { rooms, lightClick: this.config.lightClick, alarmRooms, style };
  },

  getStyles() {
    return ["MMM-ioBrokerRoomVentilation.css"];
  }
});
