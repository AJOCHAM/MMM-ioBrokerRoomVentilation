const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
  start() {
    console.log("Starting node helper for MMM-ioBrokerWaschmaschine...");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_WASHER_DATA") {
      this.fetchRoomData(payload);
    }
  },

  async fetchRoomData(config) {
    const washerData = [];
    const baseURL = `http://${config.ip}:${config.port}/get`;

    //http://192.168.4.211:8082/get/homeconnect.0.BOSCH-WAV28E43-68A40E9452D3.programs.active.options.BSH_Common_Option_ProgramProgress


    for (const washer of config.washers) {
      try {
        const [progress, remainingTime] = await Promise.all([
          axios.get(`${baseURL}/${washer.progressID}`),
          axios.get(`${baseURL}/${washer.remainingTimeID}`)
        ]);

         washerData.push({
          name: washer.name,
          progress: progress.data.val,
          remainingTime: remainingTime.data.val
        });
      } catch (error) {
        console.error("Error fetching data for washer:", washer.name, error);
      }
    }

    this.sendSocketNotification("WASHER_DATA_RESULT", washerData);
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


