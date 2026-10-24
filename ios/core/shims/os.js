'use strict';
const N = require('./native');

module.exports = { hostname: () => String(N.hostname()), platform: () => 'ios', tmpdir: () => '/tmp', EOL: '\n' };
