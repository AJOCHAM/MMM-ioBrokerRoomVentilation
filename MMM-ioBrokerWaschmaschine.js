  Module.register("MMM-ioBrokerWaschmaschine", {
    defaults: {
      ip: "192.168.4.211",
      port: "8082",
      washers: []
    },
  
    start() {
      this.washerData = [];
      this.getWasherData();
      setInterval(() => this.getWasherData(), 10000); // Fetch data every 60 seconds
    },
  
    getWasherData() {
      this.sendSocketNotification("GET_WASHER_DATA", this.config);
    },
  
    socketNotificationReceived(notification, payload) {
      if (notification === "WASHER_DATA_RESULT") {
        this.washerData = payload;
        this.updateDom();
      }
    },
  
    getTemplate() {
      return "MMM-ioBrokerWaschmaschine.njk";
    },
  
    getTemplateData() {
      return {
        washers: this.washerData
      };
    },
  
    getStyles() {
      return ["MMM-ioBrokerWaschmaschine.css"];
    }
  });
  
  