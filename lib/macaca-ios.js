'use strict';

const iOSUtils = require('ios-utils');
const XCTest = require('xctest-client');
const DriverBase = require('driver-base');
const Simulator = require('ios-simulator');
const RemoteDebugger = require('remote-debugger');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const logger = require('./logger');
const controllers = require('./controllers');

const WINDOW = 'WINDOW';
const WEBVIEW = 'WEBVIEW';
const NATIVE = 'NATIVE_APP';
const WINDOW_PREFIX = `${WINDOW}_`;
const WEBVIEW_PREFIX = `${WEBVIEW}_`;

const UNINSTALL_APP = 1; // uninstall app flag

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
    this.frame = null;
    this.implicitWaitMs = 5000;
    this.proxy = null;
    this.remote = null;
    this.isSafari = false;
  }
}

IOS.prototype.whiteList = function(context) {
  const wdUrl = context.url;
  const whiteList = ['url', 'context', 'contexts', 'screenshot', 'implicit_wait', 'flick', 'touch/click'];
  return whiteList.some(word => !!~wdUrl.indexOf(word));
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
  if (this.xctest) {
    if (this.autoAcceptAlerts) {
      this.autoHandleAlerts = autoAcceptAlerts;
    } else if (this.autoDismissAlerts) {
      this.autoHandleAlerts = autoDismissAlerts;
    } else {
      this.autoHandleAlerts = () => [];
    }
  } else {
    this.autoHandleAlerts = () => [];
  }
};

IOS.prototype.tap = function *(elementId) {
  if (this.isWebContext()) {
    return yield this.click(elementId);
  } else {
    const tapUrl = `/wd/hub/session/temp/tap/${elementId}`;
    return this.xctest.sendCommand(tapUrl, 'POST', {});
  }
};

IOS.prototype.flick = function *(elementId, xoffset, yoffset, speed) {
  const flickUrl = `/wd/hub/session/temp/tap/${elementId}`;
  return this.xctest.sendCommand(flickUrl, 'POST', {
    x: xoffset,
    y: yoffset,
  });
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
    if (this.args.browserName === 'Safari') {
      this.isSafari = true;
      this.bundleId = 'com.apple.mobilesafari';
    } else {
      this.bundleId = yield iOSUtils.getBundleId(this.args.app);
    }
    this.sim = yield this.initSimulator();
    yield this.startSimulator();
  }

  const desCaps = _.validateAndFilterDesiredCaps(_.merge({
    bundleId: this.bundleId
  }, this.args));

  this.xctest = new XCTest({
    device: this.sim || this.device
  });

  if (!this.isSafari) {
    this.proxy = this.xctest;
  }

  logger.debug(JSON.stringify(desCaps, null, '\t'));

  yield this.xctest.start({
    desiredCapabilities: desCaps
  });

  if (this.isSafari) {
    yield this.startSafari(desCaps);
  }
};

IOS.prototype.startSafari = function *(caps) {
  this.remote = new RemoteDebugger({
    deviceId: this.udid || RemoteDebugger.SIMULATOR
  });

  yield this.remote.start();

  let availablePages = [];

  const pageAvailable = () => {
    return this.remote
      .getPages()
      .then(pages => {
        availablePages = pages;
        return pages.length ? true : false;
      });
  };

  yield _.waitForCondition(pageAvailable);

  let latestPage = _.last(availablePages);
  let pageId = latestPage.id;
  yield this.remote.connect(pageId);
  this.context = pageId;
  yield this.deleteWindow();
  return caps;
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
    if (device.name === deviceString) {
      matchedDevice = device;
    }
  });

  if (!matchedDevice) {
    throw new Error(`Device ${deviceString} is not available!`);
  }

  return new Simulator({
    deviceId: matchedDevice.udid
  });
};

IOS.prototype.startSimulator = function *() {

  const isBooted = yield this.sim.isBooted();
  
  if (this.args.reuse && isBooted) {
    if (UNINSTALL_APP & this.args.reuse) {
      this.sim.uninstall(this.bundleId);
    }
    return;
  }

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

  if (!this.args.reuse) {
    yield this.sim.erase();
  }

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

  if (UNINSTALL_APP & this.args.reuse) {
    this.sim.uninstall(this.bundleId);
  }
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

  if (this.sim && !this.args.reuse) {
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

  yield this.getContexts();

  if (!_.includes(this.contexts, String(this.context))) {
    logger.debug(`We dont have this context ${this.context}`);
    throw new errors.NoSuchWindow();
  }

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
    this.remote = new RemoteDebugger({
      deviceId: this.udid || RemoteDebugger.SIMULATOR
    });
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
    return null;
  } else if (name === NATIVE || !name) {
    this.proxy = this.xctest;
    this.context = null;
    this.frame = null;
    this.remote && this.remote.disconnect();
  } else {
    this.proxy = null;
    const index = name.replace(WEBVIEW_PREFIX, '');

    yield this.getContexts();

    if (!_.includes(this.contexts, index)) {
      logger.debug(`We dont have this context ${index}`);
      throw new errors.NoSuchWindow();
    }

    const pageId = parseInt(index, 10);

    if (this.context === pageId) {
      return null;
    }

    if (this.remote) {
      this.remote.disconnect();
    }

    yield this.remote.connect(pageId);
    this.context = pageId;
    this.frame = null;
    return null;
  }
};


IOS.prototype.get = function *(url) {
  if (this.isSafari || this.proxy) {
    yield this.sim.openURL(url);
    yield _.sleep(2000);
    if (!this.remote) {
      this.remote = new RemoteDebugger({
        deviceId: this.udid || RemoteDebugger.SIMULATOR
      });
      yield this.remote.start();
    }
    const availablePages = yield this.remote.getPages();
    const latestPage = _.last(availablePages);
    const pageId = latestPage.id;
    yield this.remote.connect(pageId);
    this.context = pageId;
    this.frame = null;
    return null;
  } else {
    this.frame = null;
    return yield this.remote.navigateTo(url);
  }
};

IOS.prototype.getWindows = function *() {
  if (!this.isSafari) {
    throw new errors.NoSuchWindow();
  }
  const webviews = yield this.getWebviews();
  const ctx = webviews.map(page => page.id.toString());
  this.contexts = ctx;
  const names = webviews.map(page => `${WINDOW_PREFIX}${page.id}`);
  return names;
};

IOS.prototype.setWindow = function *(name) {
  if (name === this.context) {
    return null;
  } else {
    const index = name.replace(WINDOW_PREFIX, '');

    if (!_.includes(this.contexts, index)) {
      logger.debug(`We dont have this window ${index}`);
      throw new errors.NoSuchWindow();
    }

    const pageId = parseInt(index, 10);

    if (this.context === pageId) {
      return null;
    }

    if (this.remote) {
      this.remote.disconnect();
    }

    yield this.remote.connect(pageId);
    this.context = pageId;
    this.frame = null;
    return null;
  }
};

IOS.prototype.getScreenshot = function *(context) {
  const data = yield this.xctest.sendCommand(context.url, context.method, context.body);
  const result = JSON.parse(data);
  return result.value;
};

for (let name in controllers) {
  IOS.prototype[name] = function *() {
    if (this.isSafari) {
      yield this.getWindows();
    } else {
      yield this.getContexts();
    }
    if (!_.includes(this.contexts, String(this.context))) {
      logger.debug(`We dont have this context ${this.context}`);
      throw new errors.NoSuchWindow();
    }
    yield this.autoHandleAlerts();
    return yield controllers[name].apply(this, arguments);
  };
}

module.exports = IOS;
