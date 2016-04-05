/* ================================================================
 * macaca-ios by xdf(xudafeng[at]126.com)
 *
 * first created at : Tue Mar 17 2015 00:16:10 GMT+0800 (CST)
 *
 * ================================================================
 * Copyright xdf
 *
 * Licensed under the MIT License
 * You may not use this file except in compliance with the License.
 *
 * ================================================================ */

'use strict';

const path = require('path');
const iOSUtils = require('ios-utils');
const XCTest = require('xctest-client');
const DriverBase = require('driver-base');
const Simulator = require('ios-simulator');
const RemoteDebugger = require('remote-debugger');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const logger = require('./logger');
const controllers = require('./controllers');

const WEBVIEW = 'WEBVIEW';
const NATIVE = 'NATIVE_APP';
const WEBVIEW_PREFIX = `${WEBVIEW}_`;

class IOS extends DriverBase {
  constructor() {
    super();
    this.iOSSDKVersion = null;
    this.xctest = null;
    this.args = null;
    this.device = null;
    this.sim = null;
    this.atoms = [];
    this.bundleId = null;
    this.context = null;
    this.contexts = [];
    this.implicitWaitMs = 5000;
    this.proxy = null;
    this.remote = null;
  }
}

IOS.prototype.whiteList = function(context) {
  const basename = path.basename(context.url);
  const whiteList = ['context', 'contexts', 'screenshot', 'implicit_wait'];
  return !!~whiteList.indexOf(basename);
};

IOS.prototype.isProxy = function() {
  return !!this.proxy;
};

const autoAcceptAlerts = function() {
  const acceptUrl = `/wd/hub/session/temp/accept_alert`;
  return this.xctest.sendCommand(acceptUrl, 'POST', {});
};

const autoDismissAlerts = function() {
  const dismissUrl = `/wd/hub/session/temp/dismiss_alert`;
  return this.xctest.sendCommand(dismissUrl, 'POST', {});
};

IOS.prototype.autoHandleAlerts = function *() {
  if (this.autoAcceptAlerts) {
    this.autoHandleAlerts = autoAcceptAlerts;
  } else if (this.autoDismissAlerts) {
    this.autoHandleAlerts = autoDismissAlerts;
  } else {
    this.autoHandleAlerts = () => [];
  }
};

IOS.prototype.proxyCommand = function *(url, method, body) {
  yield this.autoHandleAlerts();
  return this.proxy.sendCommand(url, method, body);
};

IOS.prototype.startDevice = function *(caps) {
  this.args = _.clone(caps);
  this.autoAcceptAlerts = Boolean(caps.autoAcceptAlerts);
  this.autoDismissAlerts = Boolean(caps.autoDismissAlerts);
  this.iOSSDKVersion = yield iOSUtils.getIOSSDKVersion();
  
  if (this.args.udid) {
    this.udid = this.args.udid;
    this.bundleId = this.args.bundleId;
    this.device = yield this.initRealDevice();
  
  } else {
    this.bundleId = yield iOSUtils.getBundleId(this.args.app);
    this.sim = yield this.initSimulator();

    yield this.startSimulator();
  }

  this.xctest = new XCTest({
    device: this.sim || this.device
  });
  
  this.proxy = this.xctest;
  
  const desCaps = _.merge({
    bundleId: this.bundleId
  }, this.args);

  logger.debug(JSON.stringify(desCaps, null, '\t'));

  yield this.xctest.start({
    desiredCapabilities: desCaps
  });
};

IOS.prototype.initRealDevice = function *() {
  return {
    deviceId: this.udid
  };
};

IOS.prototype.initSimulator = function *() {
  const devices = yield Simulator.getDevices();
  const availableDevices = devices.filter(device => device.available);
  let matchedDevice = null;

  logger.debug(`Get available devices ${JSON.stringify(availableDevices)}`);

  const deviceString = this.args.deviceName;
  _.each(availableDevices, device => {
    if (!!~device.name.indexOf(deviceString)) {
      matchedDevice = device;
    }
  });
  return new Simulator({
    deviceId: matchedDevice.udid
  });
};

IOS.prototype.startSimulator = function *() {

  try {
    yield Simulator.killAll();
  } catch(e) {
    logger.debug(`Kill simulator failed ${e}`);
  }

  try {
    yield this.sim.shutdown();
  } catch(e) {
    logger.debug(`Shutdown simulator ${this.sim.deviceId} failed ${e}`);
  }

  yield this.sim.erase();
  yield this.sim.open();

  yield _.retry(() => {
    return new Promise((resolve, reject) => {
      this.sim
        .isBooted()
        .then(isBooted => {
          if (isBooted) {
            resolve();
          } else {
            reject(new Error(`Simulator ${this.sim.deviceId} is not booted.`));
          }
        });
    });
  }, 3000, 10);

  yield this.sim.install(this.args.app);
};

IOS.prototype.getDeviceString = function() {
  return this.args.deviceName + ' (' + this.args.platformVersion + ')';
};

IOS.prototype.stopDevice = function *() {
  logger.debug('Stoping iOS driver...');
 
  if (this.xctest) {
    this.xctest.stop();
  }

  if (this.remote) {
    this.remote.stop();
  }

  if (this.sim) {
    try {
      yield this.sim.shutdown();
    } catch(e) {
      logger.debug(`Shutdown simulator ${this.sim.deviceId} failed ${e}`);
    }

    try {
      yield Simulator.killAll();
    } catch(e) {
      logger.debug(`Kill simulator failed ${e}`);
    }
  } else if (this.device) {

  }

  logger.debug('iOS driver cleaned up.');
};

IOS.prototype.isWebContext = function() {
  return this.context !== null && this.context !== 'NATIVE';
};

IOS.prototype.getContext = function *() {
  if (this.context && this.context !== NATIVE) {
    return `${WEBVIEW_PREFIX}${this.context}`;
  } else {
    return NATIVE;
  }
};

IOS.prototype.getContexts = function *() {
  const webviews = yield this.getWebviews();
  const ctx = webviews.map(page => page.id.toString());
  ctx.unshift(NATIVE);
  this.contexts = ctx;
  const names = webviews.map(page => `${WEBVIEW_PREFIX}${page.id}`);
  names.unshift(NATIVE);
  return names;
};

IOS.prototype.getWebviews = function *() {

  if (!this.remote) {
    this.remote = new RemoteDebugger();
    yield this.remote.start();
  }
  const pages = yield this.remote.getPages();

  if (pages.length === 0) {
    logger.debug('Cannot find any Webview');
  }
  return pages;
};

IOS.prototype.setContext = function *(name) {
  if ((name === this.context) ||
    (!name && NATIVE === this.context) ||
    (name === NATIVE && this.context === null)) {
    return;
  } else if (name === NATIVE || !name) {
    this.proxy = this.xctest;
    this.context = null;
    this.remote && this.remote.disconnect();
  } else {
    this.proxy = null;
    const index = name.replace(WEBVIEW_PREFIX, '');

    if (!this.contexts) {
      yield this.getContexts();
    }

    if (!_.includes(this.contexts, index)) {
      logger.debug(`We dont have this context ${this.index}`);
      throw new errors.NoContextError();
    }

    const pageId = parseInt(index, 10);

    if (this.context === pageId) {
      return;
    }

    if (this.remote) {
      this.remote.disconnect();
    }

    yield this.remote.connect(pageId);
    this.context = pageId;
  }
};

for (let name in controllers) {
  IOS.prototype[name] = function *() {
    const webviews = yield this.getWebviews();
    const latest = _.last(webviews);
    if (latest && this.remote) {
      const id = parseInt(latest.id, 10);

      if (id !== this.context) {
        yield this.remote.connect(id);
        this.context = id;
      }
    }
    yield this.autoHandleAlerts();
    return yield controllers[name].apply(this, arguments);
  };
}

module.exports = IOS;
