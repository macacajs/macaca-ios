'use strict';

const util = require('macaca-utils');

var _ = util.merge({}, util);

_.sleep = function(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

_.retry = function(func, interval, num) {
  return new Promise((resolve, reject) => {
    func().then(resolve, err => {
      if (num > 0 || typeof num === 'undefined') {
        _.sleep(interval).then(() => {
          resolve(_.retry(func, interval, num - 1));
        });
      } else {
        reject(err);
      }
    });
  });
};

_.serialTasks = function () {
  return Array.prototype.slice.call(arguments).reduce(
    (pre, task) => pre.then(() => task()), Promise.resolve());
};

_.waitForCondition = function(func, wait/* ms*/, interval/* ms*/) {
  wait = wait || 5000;
  interval = interval || 500;
  let start = Date.now();
  let end = start + wait;
  const fn = function() {
    return new Promise((resolve, reject) => {
      const continuation = (res, rej) => {
        let now = Date.now();
        if (now < end) {
          res(_.sleep(interval).then(fn));
        } else {
          rej(`Wait For Condition timeout ${wait}`);
        }
      };
      func().then(isOk => {
        if (isOk) {
          resolve();
        } else {
          continuation(resolve, reject);
        }
      }).catch(() => {
        continuation(resolve, reject);
      });
    });
  };
  return fn();
};

_.escapeString = function(str) {
  return str
    .replace(/[\\]/g, '\\\\')
    .replace(/[\/]/g, '\\/')
    .replace(/[\b]/g, '\\b')
    .replace(/[\f]/g, '\\f')
    .replace(/[\n]/g, '\\n')
    .replace(/[\r]/g, '\\r')
    .replace(/[\t]/g, '\\t')
    .replace(/[\"]/g, '\\"')
    .replace(/\\'/g, "\\'");
};

_.validateAndFilterDesiredCaps = function(caps) {
  const legalKeys = [
    'app',
    'bundleId',
    'platformName',
    'platformVersion',
    'browserName',
    'browserVersion',
    'acceptSslCerts'
  ];

  for (let key in caps) {
    if (!caps[key] || !~legalKeys.indexOf(key)) {
      delete caps[key];
    }
  }
  return caps;
};

_.getDeviceInfo = function(udid) {
  return {
    isIOS: !!~[25, 36, 40].indexOf(udid.length),
    // iPhone XR (12.1) [00008020-001D4D38XXXXXXXX]
    isRealIOS: /^\w{40}|(\d{8}-\w{16})$/.test(udid)
  };
};

module.exports = _;
