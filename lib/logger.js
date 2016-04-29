'use strict';

const path = require('path');
const logger = require('xlogger');
const options = {
  logFileDir: path.join(__dirname, '..', '..', 'logs')
};

module.exports = logger.Logger(options);
