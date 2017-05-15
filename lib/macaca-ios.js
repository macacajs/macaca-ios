'use strict';

const co = require('co');
const Device = require('ios-device');
const iOSUtils = require('ios-utils');
const XCTestWD = require('xctestwd');
const DriverBase = require('driver-base');
const Simulator = require('ios-simulator');
const RemoteDebugger = require('remote-debugger');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');
const logger = require('./logger');
const actionHandler = require('./actions');
const controllers = require('./controllers');

const WINDOW = 'WINDOW';
const WEBVIEW = 'WEBVIEW';
const NATIVE = 'NATIVE_APP';
const WINDOW_PREFIX = `${WINDOW}_`;
const WEBVIEW_PREFIX = `${WEBVIEW}_`;

class IOS extends DriverBase {
  constructor() {
    super();
    this.iOSSDKVersion = null;
    this.xctest = null;
    this.args = null;
    this.device = null;
    this.atoms = [];
    this.bundleId = null;
    this.context = null;
    this.contexts = [];
    this.frame = null;
    this.implicitWaitMs = 5000;
    this.proxy = null;
    this.remote = null;
    this.isSafari = false;
    this.proxyPort = 8900;
  }
}

IOS.prototype.whiteList = function(context) {
  const wdUrl = context.url;
  const whiteList = ['url', 'context', 'contexts', 'screenshot', 'implicit_wait', 'actions', 'keys'];
  return whiteList.some(word => !!~wdUrl.indexOf(word));
};

IOS.prototype.isProxy = function() {
  return !!this.proxy;
};

const autoAcceptAlerts = function() {
  const acceptUrl = `/wd/hub/session/:sessionId/accept_alert`;
  return this.xctest.sendCommand(acceptUrl, 'POST', {});
};

const autoDismissAlerts = function() {
  const dismissUrl = `/wd/hub/session/:sessionId/dismiss_alert`;
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

IOS.prototype.proxyCommand = function *(url, method, body) {
  yield this.autoHandleAlerts();
  return this.proxy.sendCommand(url, method, body);
};

IOS.prototype.startDevice = function *(caps) {
  this.args = _.clone(caps);
  let reuse = parseInt(this.args.reuse);

  if (!reuse && reuse !== 0) {
    reuse = 1;
  }
  this.args.reuse = reuse;

  this.autoAcceptAlerts = Boolean(caps.autoAcceptAlerts);
  this.autoDismissAlerts = Boolean(caps.autoDismissAlerts);
  this.iOSSDKVersion = yield iOSUtils.getIOSSDKVersion();

  if (!this.args.udid && this.args.deviceName) {
    this.args.udid = yield this.getSimulatorUdid();
  }

  const deviceInfo = _.getDeviceInfo(this.args.udid);

  this.udid = this.args.udid;
  if (this.args.proxyPort) {
    this.proxyPort = this.args.proxyPort;
  }
  const app = this.args.app;
  const bundleId = this.args.bundleId;

  if (!bundleId && !app && !this.args.browserName) {
    throw new errors.UnknownError(`Neither 'app' nor 'bundleId' is provided!`);
  }

  if (bundleId) {
    this.bundleId = bundleId;
  } else if (app) {
    this.bundleId = yield iOSUtils.getBundleId(app);
  } else if (this.args.browserName === 'Safari') {
    this.isSafari = true;
    this.bundleId = 'com.apple.mobilesafari';
  }

  if (deviceInfo.isRealIOS) {
    this.device = new Device({
      deviceId: this.udid
    });

    yield this.startRealDevice();
  } else {
    this.device = new Simulator({
      deviceId: this.udid
    });

    yield this.startSimulator();
  }

  const desCaps = _.validateAndFilterDesiredCaps(_.merge({
    bundleId: this.bundleId
  }, this.args));

  if (deviceInfo.isRealIOS) {
    delete desCaps.app;
  }

  this.initXCTest();

  if (!this.isSafari) {
    this.proxy = this.xctest;
  }

  logger.debug(JSON.stringify(desCaps, null, '\t'));

  const self = this;
  yield _.retry(co.wrap(function *() {
    logger.debug('Trying to start xctestwd server...');
    self.xctest.stop();
    yield self.device.uninstall(XCTestWD.XCTestWD.BUNDLE_ID);
    return yield self.xctest.start({
      desiredCapabilities: desCaps
    });
  }), 10 * 1000, 3);

  if (this.isSafari) {
    yield this.startSafari(desCaps);
  }
};

IOS.prototype.initXCTest = function() {
  this.xctest = new XCTestWD({
    device: this.device,
    proxyPort: this.proxyPort
  });
};

IOS.prototype.startSafari = function *(caps) {
  this.remote = new RemoteDebugger({
    deviceId: this.udid
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

IOS.prototype.getSimulatorUdid = function *() {
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

  return matchedDevice.udid;
};

IOS.prototype.startRealDevice = function *() {
  const bundleId = this.bundleId;
  const isInstalled = yield this.device.exists(bundleId);
  const app = this.args.app;
  const reuse = this.args.reuse;

  if (!app && !isInstalled) {
    throw new errors.UnknownError(`App '${bundleId}' is neither installed, nor provided!`);
  }

  if (isInstalled) {
    logger.debug(`App "${bundleId}" is already installed.`);
    switch (reuse) {
      case 0:
      case 1:
        if (app) {
          yield this.device.uninstall(bundleId);
          logger.debug(`Uninstall app "${bundleId}".`);
        }
        break;
      case 2:
        if (app) {
          try {
            yield this.device.install(app);
            logger.debug(`Install app '${bundleId}' successfully.`);
          } catch (err) {
            logger.debug(err.message);
            throw new errors.UnknownError(`Failed to install app '${bundleId}', please install the app manually.`);
          }
        }
        break;
      case 3:
        // Keep app state. Do nothing.
        break;
    }
  } else {
    logger.debug(`App '${bundleId}' is not installed.`);
    try {
      yield this.device.install(app);
      logger.debug(`Install app '${bundleId}' successfully.`);
    } catch (err) {
      logger.debug(err.message);
      throw new errors.UnknownError(`Failed to install app '${bundleId}', please install the app manually.`);
    }
  }
};

IOS.prototype.startSimulator = function *() {
  const isBooted = yield this.device.isBooted();
  const app = this.args.app;
  const bundleId = this.bundleId;
  const reuse = this.args.reuse;

  if (reuse && isBooted) {
    const isInstalled = yield this.device.exists(bundleId);
    if (!isInstalled && !app) {
      throw new errors.UnknownError(`App '${bundleId}' is neither installed, nor provided!`);
    }

    if (reuse === 1 && app) {
      yield this.device.uninstall(this.bundleId);
    }

    if (reuse === 3) {
      if (isInstalled) {
        this.args.app = '';
      }
    }
    return;
  }

  try {
    yield Simulator.killAll();
  } catch(e) {
    logger.debug(`Kill simulator failed ${e}`);
  }

  try {
    yield this.device.shutdown();
  } catch(e) {
    logger.debug(`Shutdown simulator ${this.device.deviceId} failed ${e}`);
  }

  if (!reuse) {
    yield this.device.erase();
  }

  yield this.device.open();

  yield _.retry(() => {
    return new Promise((resolve, reject) => {
      this.device
        .isBooted()
        .then(isBooted => {
          if (isBooted) {
            resolve();
          } else {
            reject(new errors.UnknownError(`Simulator ${this.device.deviceId} is not booted.`));
          }
        });
    });
  }, 3000, 10);

  const isInstalled = yield this.device.exists(bundleId);

  if (!isInstalled && !app) {
    throw new errors.UnknownError(`App '${bundleId}' is neither installed, nor provided!`);
  }

  if (reuse === 1 && app) {
    yield this.device.uninstall(bundleId);
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

  if (this.device && !this.args.reuse) {
    try {
      yield this.device.shutdown();
    } catch(e) {
      logger.debug(`Shutdown simulator ${this.device.deviceId} failed ${e}`);
    }

    try {
      yield Simulator.killAll();
    } catch(e) {
      logger.debug(`Kill simulator failed ${e}`);
    }
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
      deviceId: this.udid
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
    yield this.device.openURL(url);
    yield _.sleep(2000);
    if (!this.remote) {
      this.remote = new RemoteDebugger({
        deviceId: this.udid
      });
      yield this.remote.start();
    }
    const availablePages = yield this.remote.getPages();
    const latestPage = _.last(availablePages);
    if (latestPage) {
      const pageId = latestPage.id;
      yield this.remote.connect(pageId);
      this.context = pageId;
    }
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
  try {
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return result.value;
  } catch (e) {
    logger.debug(e);
    throw new errors.JavaScriptError(e.message);
  }
};

IOS.prototype.keys = function *(value) {
  // https://github.com/macacajs/webdriver-keycode/blob/master/lib/webdriver-keycode.js
  const keyMap = {
    '\uE105': 'homescreen'
  };

  value = value.join('');
  var arrText = [];

  for (var i = 0; i < value.length; i++) {
    var key = value.charAt(i);

    const keyEvent = keyMap[key];
    if (keyEvent) {
      if (arrText.length) {
        yield this.xctest.sendCommand('/keys', 'POST', {
          value: arrText
        });
        arrText = [];
      }
      if (keyEvent === 'homescreen') {
        yield this.xctest.sendCommand('/homescreen', 'POST', {});
      }
    } else {
      arrText.push(key);
    }
  }
  if (arrText.length) {
    yield this.xctest.sendCommand('/keys', 'POST', {
      value: arrText
    });
  }
  return null;
};

IOS.prototype.handleActions = function *(actions) {
  if (!actions) {
    throw new errors.UnknownError(`Missing 'actions' in parameters.`);
  }
  const futureActions = actions.map(action => actionHandler.bind(this, action));
  return yield _.serialTasks.apply(null, futureActions);
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
