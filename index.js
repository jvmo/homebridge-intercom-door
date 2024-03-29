var _ = require('underscore');
var onoff = require('onoff');
var Gpio = onoff.Gpio;
var Service, Characteristic, HomebridgeAPI;

const STATE_UNSECURED = 0;
const STATE_SECURED = 1;
const STATE_JAMMED = 2;
const STATE_UNKNOWN = 3;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HomebridgeAPI = homebridge;

  homebridge.registerAccessory('homebridge-intercom-door', 'ElectromagneticLock', ElectromagneticLockAccessory);
}

function ElectromagneticLockAccessory(log, config) {
  _.defaults(config, { activeLow: true, reedSwitchActiveLow: true, unlockingDuration: 2, lockWithMemory: true, gpioPin: 17 });

  this.log = log;
  this.name = config['name'];
  this.lockPin = config['lockPin'];
  this.doorPin = config['doorPin'];
  this.initialState = config['activeLow'] ? 1 : 0; // Initial state based on activeLow
  this.activeState = config['activeLow'] ? 0 : 1; // Active state based on activeLow
  this.reedSwitchActiveState = config['reedSwitchActiveLow'] ? 0 : 1;
  this.unlockingDuration = config['unlockingDuration'];
  this.lockWithMemory = config['lockWithMemory'];

  // GPIO pin for voltage measurement
  this.voltagePin = config['voltagePin'];

  // Initialize GPIO pins
  this.lockGpio = new Gpio(this.lockPin, 'out');
  this.voltageGpio = new Gpio(this.voltagePin, 'in', 'both');

  this.cacheDirectory = HomebridgeAPI.user.persistPath();
  this.storage = require('node-persist');
  this.storage.initSync({ dir: this.cacheDirectory, forgiveParseErrors: true });

  var cachedCurrentState = this.storage.getItemSync(this.name);
  if ((cachedCurrentState === undefined) || (cachedCurrentState === false)) {
    this.currentState = STATE_UNKNOWN;
  } else {
    this.currentState = cachedCurrentState;
  }

  this.lockState = this.currentState;
  if (this.currentState == STATE_UNKNOWN) {
    this.targetState = STATE_SECURED;
  } else {
    this.targetState = this.currentState;
  }

  this.service = new Service.LockMechanism(this.name);

  this.infoService = new Service.AccessoryInformation();
  this.infoService
    .setCharacteristic(Characteristic.Manufacturer, 'jvmo')
    .setCharacteristic(Characteristic.Model, 'Intercom Door')
    .setCharacteristic(Characteristic.SerialNumber, '1234567890');

  this.unlockTimeout;

  if (this.doorPin && !this.lockWithMemory) {
    this.log("Electromagnetic lock without memory doesn't support doorPin, setting to null. Consider using a separate contact sensor.");
    this.doorPin = undefined;
  }

  if (this.doorPin) {
    this.doorGpio = new Gpio(this.doorPin, 'in', 'both');
    if (this.lockWithMemory) {
      this.doorGpio.watch(this.calculateLockWithMemoryState.bind(this));
    }
  }

  this.service
    .getCharacteristic(Characteristic.LockCurrentState)
    .on('get', this.getCurrentState.bind(this));

  this.service
    .getCharacteristic(Characteristic.LockTargetState)
    .on('get', this.getTargetState.bind(this))
    .on('set', this.setTargetState.bind(this));
}

ElectromagneticLockAccessory.prototype.getCurrentState = function(callback) {
  this.log("Lock current state: %s", this.currentState);
  callback(null, this.currentState);
}

ElectromagneticLockAccessory.prototype.getTargetState = function(callback) {
  this.log("Lock target state: %s", this.targetState);
  callback(null, this.targetState);
}

ElectromagneticLockAccessory.prototype.setTargetState = function(state, callback) {
  this.log('Setting lock to %s', state ? 'secured' : 'unsecured');
  if (state && this.lockWithMemory) {
    this.log("Can't lock electromagnetic lock with memory.");
    this.service.updateCharacteristic(Characteristic.LockCurrentState, state);
    setTimeout(function () {
      this.service.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
      this.service.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    }.bind(this), 500);
    callback();
  } else if (state && !this.lockWithMemory) {
    clearTimeout(this.unlockTimeout);
    this.secureLock();
    callback();
  } else {
    this.lockGpio.writeSync(this.activeState);
    this.service.setCharacteristic(Characteristic.LockCurrentState, state);
    this.lockState = state;
    this.storage.setItemSync(this.name, this.lockState);
    this.unlockTimeout = setTimeout(this.secureLock.bind(this), this.unlockingDuration * 1000);
    callback();
  }
}

ElectromagneticLockAccessory.prototype.calculateLockWithMemoryState = function () {
  setTimeout(() => {
    let doorOpen = this.doorGpio.readSync() ? true : false;
    if (doorOpen && this.lockState == STATE_UNSECURED) {
      this.log('Door has been opened, lock: secured, current state: unsecured.');
      this.lockState = STATE_SECURED;
      this.currentState = STATE_UNSECURED;
      this.targetState = STATE_UNSECURED;
    } else if (doorOpen && this.lockState == STATE_SECURED) {
      this.log('Door has been opened, lock already secured, current state: unsecured.');
      this.currentState = STATE_UNSECURED;
      this.targetState = STATE_UNSECURED;
    } else if (!doorOpen && this.lockState == STATE_SECURED) {
      this.log('Door has been closed, lock already secured, current state: secured.');
      this.currentState = STATE_SECURED;
      this.targetState = STATE_SECURED;
    } else if (!doorOpen && this.lockState == STATE_UNSECURED) {
      this.log('Door has been closed, lock: unsecured, current state: unsecured.');
      this.currentState = STATE_UNSECURED;
      this.targetState = STATE_UNSECURED;
    } else {
      this.log('State unknown, door open: ' + doorOpen + ', lock state: ' + this.lockState);
      this.lockState == STATE_UNKNOWN;
      this.currentState = STATE_UNKNOWN;
    }
    this.service.updateCharacteristic(Characteristic.LockTargetState, this.targetState);
    this.service.updateCharacteristic(Characteristic.LockCurrentState, this.currentState);
    this.storage.setItemSync(this.name, this.currentState);
  }, 20);
}

ElectromagneticLockAccessory.prototype.secureLock = function () {
  this.lockGpio.writeSync(this.initialState);
  if (!this.doorPin && !this.lockWithMemory) {
    this.service.updateCharacteristic(Characteristic.LockTargetState, STATE_SECURED);
    this.service.updateCharacteristic(Characteristic.LockCurrentState, STATE_SECURED);
    this.currentState = STATE_SECURED;
    this.targetState = STATE_SECURED;
    this.storage.setItemSync(this.name, this.currentState);
  } else if (!this.doorPin && this.lockWithMemory) {
    this.service.updateCharacteristic(Characteristic.LockTargetState, STATE_SECURED);
    this.service.updateCharacteristic(Characteristic.LockCurrentState, STATE_SECURED);
    this.service.updateCharacteristic(Characteristic.LockCurrentState, STATE_UNKNOWN);
    this.currentState = STATE_UNKNOWN;
    this.targetState = STATE_SECURED;
    this.storage.setItemSync(this.name, this.currentState);
  }
}

ElectromagneticLockAccessory.prototype.handleVoltageChange = function (err, value) {
  if (err) {
    this.log('Error reading voltage pin:', err);
    return;
  }

  // Perform an action based on the voltage level
  if (value === 1) {
    this.log('Doorbell button pressed (voltage high)');
    // Add your logic here for when the doorbell button is pressed
  } else {
    this.log('Doorbell button released (voltage low)');
    // Add your logic here for when the doorbell button is released
  }
};

ElectromagneticLockAccessory.prototype.getServices = function () {
  return [this.infoService, this.service];
}
