'use strict';

const errors = require('webdriver-dfn-error-code').errors;
const getErrorByCode = require('webdriver-dfn-error-code').getErrorByCode;

const actions = {};
const prefix = '/wd/hub/session/temp/';

const post = function (url, data) {
  return this.xctest.sendCommand(prefix + url, 'POST', data);
};

actions.tap = function(action) {
  const element = action.element;
  if (!element) {
    return post.call(this, 'tap/null', {
      x: action.x || 0,
      y: action.y || 0
    });
  }
  return post.call(this, 'tap/' + element, {
    x: action.x || 0,
    y: action.y || 0
  });
};

actions.doubleTap = function(action) {
  const element = action.element;
  if (!element) {
    return post.call(this, 'doubleTap', {
      x: action.x || 0,
      y: action.y || 0
    });
  }
  return post.call(this, 'uiaElement/' + element + '/doubleTap', {
    x: action.x || 0,
    y: action.y || 0
  });
};

actions.press = function(action) {
  const element = action.element;
  if (!element) {
    return post.call(this, 'touchAndHold', {
      x: action.x || 0,
      y: action.y || 0,
      duration: action.duration || 1
    });
  }
  return post.call(this, 'uiaElement/' + element + '/touchAndHold', {
    duration: action.duration || 1
  });
};

actions.pinch = function(action) {
  const element = action.element;
  if (!element) {
    return Promise.reject(new errors.UnknownError(`Missing 'element' in action!`));
  }
  return post.call(this, 'element/' + element + '/pinch', {
    scale: action.scale,
    velocity: action.velocity
  });
};

actions.rotate = function(action) {
  const element = action.element;
  if (!element) {
    return Promise.reject(new errors.UnknownError(`Missing 'element' in action!`));
  }
  return post.call(this, 'element/' + element + '/rotate', {
    rotation: action.rotation,
    velocity: action.velocity
  });
};

actions.drag = function(action) {
  const element = action.element;
  if (!element) {
    return post.call(this, 'dragfromtoforduration', {
      fromX: action.fromX,
      fromY: action.fromX,
      toX: action.toX,
      toY: action.toY,
      duration: action.duration || 1
    });
  }
  return post.call(this, 'uiaTarget/' + element + '/dragfromtoforduration', {
    toX: action.toX,
    toY: action.toY,
    duration: action.duration || 1
  });
};

// Return must be a Promise.
module.exports = function (action) {
  const type = action && action.type;
  if (!type) {
    return Promise.reject(new errors.UnknownError(`Missing 'type' in action!`));
  }

  const actionDelegate = actions[type];
  if (!actionDelegate) {
    return Promise.reject(new errors.NotImplementedError(`Touch action '${type}' it not implemented yet.`));
  }

  delete action.type;
  return actionDelegate
    .call(this, action)
    .then(result => {
      const code = result.status;
      const value = result.value;
      if (code === 0) {
        return null;
      } else {
        let errorName = getErrorByCode(code);
        if (!errorName) {
          errorName = 'UnknownError';
        }
        const errorMsg = value && value.message;
        throw new errors[errorName](errorMsg);
      }
    });
};
