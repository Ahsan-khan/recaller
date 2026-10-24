'use strict';
// node:util's inspect.custom symbol (config.js hides the API key from logs with it).

function inspect(v) {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
inspect.custom = Symbol.for('nodejs.util.inspect.custom');

module.exports = { inspect };
