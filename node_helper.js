const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
  start() {
    console.log("Starting node helper for MMM-RoomData...");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_ROOM_DATA") {
      this.fetchRoomData(payload);
    }
  },

  async fetchRoomData(config) {
    const roomData = [];
    const baseURL = `http://${config.ip}:${config.port}/get`;

    //http://192.168.4.211:8082/get/hmip.0.groups.4846376a-291c-445c-ac70-51d3f6860b5b.windowOpen/ts


    for (const room of config.rooms) {
      try {
        const [temperature, humidity, windowStatus, windowStatusMeta, outsideTemperature] = await Promise.all([
          axios.get(`${baseURL}/${room.temperatureID}`),
          axios.get(`${baseURL}/${room.humidityID}`),
          axios.get(`${baseURL}/${room.windowStatusID}`),
          axios.get(`${baseURL}/${room.windowStatusID}/lc`),  // Metadata for last change timestamp
          axios.get(`${baseURL}/${room.outsideTemperatureID}`)
        ]);

        // Calculate open duration if the window is open
        let openDuration = 0;
        if (windowStatus.data.val) { // Window is open
          const lastChanged = windowStatusMeta.data.lc;
          openDuration = Math.floor((Date.now() - lastChanged) / 60000); // Duration in seconds
        }

        roomData.push({
          name: room.name,
          temperature: temperature.data.val,
          humidity: humidity.data.val,
          windowStatus: windowStatus.data.val,
          outsideTemperature: outsideTemperature.data.val,
          lastChanged: windowStatusMeta.data.ts,
          openDuration: openDuration
        });
      } catch (error) {
        console.error("Error fetching data for room:", room.name, error);
      }
    }

    this.sendSocketNotification("ROOM_DATA_RESULT", roomData);
  }
});




/*const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
  start() {
    console.log("Starting node helper for MMM-RoomData...");
    this.windowOpenTimes = {}; // Track open times for each room
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_ROOM_DATA") {
      this.fetchRoomData(payload);
    }
  },

  async fetchRoomData(config) {
    const roomData = [];
    const baseURL = `http://${config.ip}:${config.port}/get`;

    for (const room of config.rooms) {
      try {
        const [temperature, humidity, windowStatus, outsideTemperature] = await Promise.all([
          axios.get(`${baseURL}/${room.temperatureID}`),
          axios.get(`${baseURL}/${room.humidityID}`),
          axios.get(`${baseURL}/${room.windowStatusID}`),
          axios.get(`${baseURL}/${room.outsideTemperatureID}`)
        ]);

        // Determine open duration if the window is open
        const isWindowOpen = true; //windowStatus.data.val;
        let openDuration = 0;

        if (isWindowOpen) {
          if (!this.windowOpenTimes[room.name]) {
            this.windowOpenTimes[room.name] = Date.now(); // Start timer
          } else {
            openDuration = Math.floor((Date.now() - this.windowOpenTimes[room.name]) / 60000); // Duration in minutes
          }
        } else {
          this.windowOpenTimes[room.name] = null; // Reset timer if window is closed
        }

        roomData.push({
          name: room.name,
          temperature: temperature.data.val,
          humidity: humidity.data.val,
          windowStatus: isWindowOpen,
          outsideTemperature: outsideTemperature.data.val,
          openDuration: openDuration
        });
      } catch (error) {
        console.error("Error fetching data for room:", room.name, error);
      }
    }

    this.sendSocketNotification("ROOM_DATA_RESULT", roomData);
  }
});



/*const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
  start() {
    console.log("Starting node helper for MMM-RoomData...");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_ROOM_DATA") {
      this.fetchRoomData(payload);
    }
  },

  async fetchRoomData(config) {
    const roomData = [];
    const baseURL = `http://${config.ip}:${config.port}/get`;

    for (const room of config.rooms) {
      try {
        const [temperature, humidity, windowStatus, outsideTemperature] = await Promise.all([
          axios.get(`${baseURL}/${room.temperatureID}`),
          axios.get(`${baseURL}/${room.humidityID}`),
          axios.get(`${baseURL}/${room.windowStatusID}`),
          axios.get(`${baseURL}/${room.outsideTemperatureID}`)
        ]);

        roomData.push({
          name: room.name,
          temperature: temperature.data.val,
          humidity: humidity.data.val,
          windowStatus: windowStatus.data.val,
          outsideTemperature: outsideTemperature.data.val
        });
      } catch (error) {
        console.error("Error fetching data for room:", room.name, error);
      }
    }

    this.sendSocketNotification("ROOM_DATA_RESULT", roomData);
  }
});
*/