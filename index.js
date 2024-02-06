"use strict";

const axios = require("axios"); // for making HTTP requests
const uuid = require("uuid"); // for generating unique identifiers

module.exports = function (homebridge) {
  // register the accessory with the plugin name, the accessory name, and the accessory constructor
  homebridge.registerAccessory("homebridge-intercom-door", "Intercom Door", IntercomDoor);
};

// the accessory constructor
function IntercomDoor(log, config, api) {
  // get the accessory information from the config file
  this.log = log; // the logger object
  this.api = api; // the Homebridge API object
  this.name = config.name || "Intercom Door"; // the name of the accessory
  this.relayPin = config.relayPin || 7; // the GPIO pin for the relay
  this.voltagePin = config.voltagePin || 17; // the GPIO pin for the voltage measurement
  this.apiURL = config.apiURL || "http://localhost:8080"; // the URL of the REST API server

  // initialize the GPIO pins using the onoff library
  const Gpio = require("onoff").Gpio;
  this.relay = new Gpio(this.relayPin, "out"); // set the relay pin as an output
  this.voltage = new Gpio(this.voltagePin, "in", "both"); // set the voltage pin as an input with both edge detection

  // create a new accessory with the information service
  this.accessory = new this.api.hap.Accessory(this.name, uuid.v4()); // use api.hap.Accessory
  this.informationService = this.accessory.getService(this.api.hap.Service.AccessoryInformation);
  this.informationService
    .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "jvmo")
    .setCharacteristic(this.api.hap.Characteristic.Model, "Intercom Door")
    .setCharacteristic(this.api.hap.Characteristic.SerialNumber, "1234567890");

  // create a new lock service for the relay
  this.lockService = this.accessory.addService(this.api.hap.Service.LockMechanism, this.name);
  this.lockService
    .getCharacteristic(this.api.hap.Characteristic.LockCurrentState)
    .on("get", this.getLockState.bind(this)); // bind the getter function
  this.lockService
    .getCharacteristic(this.api.hap.Characteristic.LockTargetState)
    .on("get", this.getLockState.bind(this)) // bind the getter function
    .on("set", this.setLockState.bind(this)); // bind the setter function

  // create a new contact sensor service for the voltage
  this.contactService = this.accessory.addService(this.api.hap.Service.ContactSensor, this.name);
  this.contactService
    .getCharacteristic(this.api.hap.Characteristic.ContactSensorState) // get the contact sensor state characteristic
    .on("get", this.getContactState.bind(this)); // bind the getter function

  // listen for changes in the voltage pin
  this.voltage.watch((err, value) => {
    if (err) {
      this.log.error(err); // log the error
    } else {
      this.log.info("Voltage changed to " + value); // log the value
      this.contactService.updateCharacteristic(this.api.hap.Characteristic.ContactSensorState, value); // update the contact sensor state
      if (value === 1) {
        this.sendNotification("Bell was pressed"); // send a notification if the voltage is high
      }
    }
  });
}

// the getter function for the lock state
IntercomDoor.prototype.getLockState = function (callback) {
  // read the value of the relay pin
  this.relay.read((err, value) => {
    if (err) {
      this.log.error(err); // log the error
      callback(err); // return the error
    } else {
      const lockState = value === 1 ? this.api.hap.Characteristic.LockCurrentState.UNSECURED : this.api.hap.Characteristic.LockCurrentState.SECURED;
      this.log.info("Lock state is " + lockState); // log the value
      callback(null, lockState); // return the value
    }
  });
};

// the setter function for the lock state
IntercomDoor.prototype.setLockState = function (value, callback) {
  // write the value to the relay pin
  this.relay.write(value === this.api.hap.Characteristic.LockTargetState.UNSECURED ? 1 : 0, (err) => {
    if (err) {
      this.log.error(err); // log the error
      callback(err); // return the error
    } else {
      const lockState = value === this.api.hap.Characteristic.LockTargetState.UNSECURED
        ? this.api.hap.Characteristic.LockCurrentState.UNSECURED
        : this.api.hap.Characteristic.LockCurrentState.SECURED;
      this.log.info("Lock state set to " + lockState); // log the value
      callback(); // return success
      if (value === this.api.hap.Characteristic.LockTargetState.UNSECURED) {
        this.sendNotification("Door is open"); // send a notification if the relay is on
      } else {
        this.sendNotification("Door is closed"); // send a notification if the relay is off
      }
    }
  });
};

// the getter function for the contact sensor state
IntercomDoor.prototype.getContactState = function (callback) {
  // read the value of the voltage pin
  this.voltage.read((err, value) => {
    if (err) {
      this.log.error(err); // log the error
      callback(err); // return the error
    } else {
      this.log.info("Contact sensor state is " + value); // log the value
      callback(null, value); // return the value
    }
  });
};

// the function to send a notification to the Home app
IntercomDoor.prototype.sendNotification = function (message) {
  // make a POST request to the REST API server with the message
  axios
    .post(this.apiURL + "/notify", { message: message })
    .then((response) => {
      this.log.info("Notification sent: " + message); // log the message
    })
    .catch((error) => {
      this.log.error(error); // log the error
    });
};

// the getServices method for the accessory
IntercomDoor.prototype.getServices = function () {
  // return an array of the services
  return [this.informationService, this.lockService, this.contactService];
};
