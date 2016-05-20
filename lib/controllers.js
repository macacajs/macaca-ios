'use strict';

const co = require('co');
const logger = require('./logger');
const errors = require('webdriver-dfn-error-code').errors;
const getErrorByCode = require('webdriver-dfn-error-code').getErrorByCode;

const _ = require('./helper');

const ELEMENT_OFFSET = 1000;
const WINDOW = 'WINDOW';
const WINDOW_PREFIX = `${WINDOW}_`;

const implicitWaitForCondition = function(func) {
  return _.waitForCondition(func, this.implicitWaitMs);
};

const sendCommand = function *(atom, args, inDefaultFrame) {
  let frames = !inDefaultFrame && this.frame ? [this.frame] : [];
  return yield this.remote.sendCommand(atom, args, frames);
};

const convertAtoms2Element = function(atoms) {
  const atomsId = atoms && atoms.ELEMENT;

  if (!atomsId) {
    return null;
  }
  const index = this.atoms.push(atomsId) - 1;
  return {
    ELEMENT: index + ELEMENT_OFFSET
  };
};

const convertElement2Atoms = function(elementId) {
  let atomsId;
  try {
    atomsId = this.atoms[parseInt(elementId, 10) - ELEMENT_OFFSET];
  } catch (e) {
    return null;
  }
   return {
    ELEMENT: atomsId
  };
};

const findElementOrElements = function *(strategy, selector, ctx, many) {
  let result;
  const that = this;
  function *search() {
    result = yield sendCommand.call(that, `find_element${many ? 's' : ''}`, [strategy, selector, null]);
    return _.size(result) > 0;
  }

  try {
    yield implicitWaitForCondition.call(this, co.wrap(search));
  } catch(err) {
    result = [];
  }

  if (many) {
    return result.map(convertAtoms2Element.bind(this));
  } else {
    if (!result || _.size(result) === 0) {
      throw new errors.NoSuchElement();
    }
    return convertAtoms2Element.call(this, result);
  }
};

const controllers = {};

controllers.setFrame = function *(frame) {
  if (!this.isWebContext()) {
    throw new errors.NoSuchFrame();
  }

  if (!frame) {
    this.frame = null;
    logger.debug('Back to default content');
    return null;
  }

  if (frame.ELEMENT) {
    let atomsElement = convertElement2Atoms.call(this, frame.ELEMENT);
    let result = yield sendCommand.call(this, 'get_frame_window', [atomsElement]);
    logger.debug(`Entering into web frame: '${result.WINDOW}'`);
    this.frame = result.WINDOW;
    return null;
  } else {
    let atom = _.isNumber(frame) ? 'frame_by_index' : 'frame_by_id_or_name';
    let result = yield sendCommand.call(this, atom, [frame]);
    if (!result || !result.WINDOW) {
      throw new errors.NoSuchFrame();
    }
    logger.debug(`Entering into web frame: '${result.WINDOW}'`);
    this.frame = result.WINDOW;
    return null;
  }
};

controllers.click = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendCommand.call(this, 'click', [atomsElement]);
};

controllers.findElement = function *(strategy, selector, ctx) {
  return yield findElementOrElements.call(this, strategy, selector, ctx, false);
};

controllers.findElements = function *(strategy, selector, ctx) {
  return yield findElementOrElements.call(this, strategy, selector, ctx, true);
};

controllers.getText = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendCommand.call(this, 'get_text', [atomsElement]);
};

controllers.clearText = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield sendCommand.call(this, 'clear', [atomsElement]);
};

controllers.setValue = function *(elementId, value) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  yield sendCommand.call(this, 'click', [atomsElement]);
  return yield sendCommand.call(this, 'type', [atomsElement, value]);
};

controllers.title = function *() {
  return yield this.execute('return document.title;');
};

controllers.execute = function *(script, args) {
  if (!args) {
    args = [];
  }
  args = args.map(arg => {
    if (arg.ELEMENT) {
      return convertElement2Atoms(this, arg.ELEMENT);
    }
  });
  const result = yield sendCommand.call(this, 'execute_script', [script, args], true);
  const code = result.status;
  const value = result.value;
  if (code === 0) {
    if (Array.isArray(value)) {
      return value.map(convertAtoms2Element.bind(this));
    } else {
      return value;
    }
  } else {
    const errorName = getErrorByCode(code);
    const errorMsg = value && value.message;
    throw new errors[errorName](errorMsg);
  }
};

controllers.url = function *() {
  const pages = yield this.remote.getPages();
  if (pages.length === 0) {
    throw new errors.NoSuchWindow();
  }
  const latestPage = _.last(pages);
  return latestPage.url;
};

controllers.forward = function *() {
  return yield this.execute('history.forward()');
};

controllers.back = function *() {
  return yield this.execute('history.back()');
};

controllers.refresh = function *() {
  return yield this.execute('location.reload()');
};

controllers.getSource = function *() {
  const cmd = 'return document.getElementsByTagName("html")[0].outerHTML';
  return yield this.execute(cmd);
};

controllers.getWindow = function *() {
  return `${WINDOW_PREFIX}${this.context}`;
};

controllers.deleteWindow = function *() {
  return yield this.execute('window.close()');
};

module.exports = controllers;
