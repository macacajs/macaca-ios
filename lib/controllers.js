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

const co = require('co');
const errors = require('webdriver-dfn-error-code').errors;

const _ = require('./helper');

const ELEMENT_OFFSET = 1000;

var implicitWaitForCondition = function(func) {
  return _.waitForCondition(func, this.implicitWaitMs);
};

var convertAtoms2Element = function(atoms) {
  const atomsId = atoms && atoms.ELEMENT;

  if (!atomsId) {
    return null;
  }
  const index = this.atoms.push(atomsId) - 1;
  return {
    ELEMENT: index + ELEMENT_OFFSET
  };
};

var convertElement2Atoms = function(elementId) {
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

var findElementOrElements = function *(strategy, selector, ctx, many) {
  let result;
  const that = this;
  // TODO const atoms = this.convertElement2Atoms(ctx);
  function *search() {
    result = yield that.sendCommand(`find_element${many ? 's' : ''}`, [strategy, selector, null]);
    return _.size(result) > 0;
  }

  try {
    yield implicitWaitForCondition.call(this, co.wrap(search));
  } catch(err) {
    result = [];
  }

  if (many) {
    return result.map(convertAtoms2Element.call(this));
  } else {
    if (!result || _.size(result) === 0) {
      throw new errors.NoSuchElement();
    }
    return convertAtoms2Element.call(this, result);
  }
};

var controllers = {};

controllers.getScreenshot = function *(context) {
  const data = yield this.xctest.sendCommand(context.url, context.method, context.body);
  const result = JSON.parse(data);
  return result.value;
};

controllers.click = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield this.sendCommand('click', [atomsElement]);
};

controllers.findElement = function *(strategy, selector, ctx) {
  return yield findElementOrElements.call(this, strategy, selector, ctx, false);
};

controllers.findElements = function *(strategy, selector, ctx) {
  return yield findElementOrElements.call(this, strategy, selector, ctx, true);
};

controllers.getText = function *(elementId) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  return yield this.sendCommand('get_text', [atomsElement]); 
};

controllers.setValue = function *(elementId, value) {
  const atomsElement = convertElement2Atoms.call(this, elementId);
  yield this.sendCommand('click', [atomsElement]);
  return yield this.sendCommand('type', [atomsElement, value]); 
};

controllers.title = function *() {
  return yield this.sendCommand('title', [], true);
};

controllers.execute = function *(script, args) {
  args = args.map(arg => {
    if (arg.ELEMENT) {
      return convertElement2Atoms(this, arg.ELEMENT);
    }
  });
  return yield this.sendCommand('execute_script', [script, args]);
};

controllers.sendCommand = function *(atom, args) {
  let frames = [];
  return yield this.remote.sendCommand(atom, args, frames);
};

module.exports = controllers;
