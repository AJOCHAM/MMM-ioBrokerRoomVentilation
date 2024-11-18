Module.register("MMM-ioBrokerRoomVentilation", {
    defaults: {
      ip: "192.168.4.211",
      port: "8082",
      rooms: []
    },
  
    start() {
      this.roomData = [];
      this.getRoomData();
      setInterval(() => this.getRoomData(), 10000); // Fetch data every 60 seconds
    },
  
    getRoomData() {
      this.sendSocketNotification("GET_ROOM_DATA", this.config);
    },
  
    socketNotificationReceived(notification, payload) {
      if (notification === "ROOM_DATA_RESULT") {
        this.roomData = payload;
        this.updateDom();
      }
    },
  
    getTemplate() {
      return "MMM-ioBrokerRoomVentilation.njk";
    },
  
    getTemplateData() {
      return {
        rooms: this.roomData
      };
    },
  
    getStyles() {
      return ["MMM-ioBrokerRoomVentilation.css"];
    }
  });
  