'use strict';
// The cloud config the app ships with (ai_memory/15_accounts_and_sync.md, 2.9).
//   npm run cloud:config   checks infra/gcp/project.json (Terraform's app_config output) and copies
//                          it to src/cloud/project.json, which electron-builder packs into app.asar
//   --check                checks src/cloud/project.json before a build: exit 1 if it is missing or
//                          invalid; with RECALLER_NO_CLOUD=1 only a warning, and the build has no accounts
//   --from FILE, --to FILE another source or destination (tests)
// The file holds the API key: nothing here prints a value from it except the checked projectId.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'infra', 'gcp', 'project.json');
const TARGET = path.join(ROOT, 'src', 'cloud', 'project.json');
const FIELDS = ['projectId', 'apiKey', 'storageBucket', 'authDomain', 'region'];
const PATTERNS = {
  projectId: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  apiKey: /^AIza[0-9A-Za-z_-]{35}$/,
};
const USAGE = 'usage: node scripts/cloud-config.js [--from FILE] [--to FILE]\n'
  + '       node scripts/cloud-config.js --check [--to FILE]';

// What is wrong with a parsed config, named by field only.
function validate(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['it is not a JSON object'];
  const problems = [];
  for (const key of FIELDS) {
    const value = Object.hasOwn(config, key) ? config[key] : undefined;
    if (value === undefined || value === null) problems.push(`${key} is missing`);
    else if (typeof value !== 'string') problems.push(`${key} is not a string`);
    else if (!value.trim()) problems.push(`${key} is empty`);
    else if (PATTERNS[key] && !PATTERNS[key].test(value)) problems.push(`${key} doesn't match ${PATTERNS[key]}`);
  }
  return problems;
}

// The Terraform output may come from PowerShell with a UTF-8 or UTF-16LE byte-order mark, so the
// source is read leniently. The copy that ships must be plain UTF-8 JSON, as the app parses it.
function load(file, lenient) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    const missing = err.code === 'ENOENT';
    return { missing, error: missing ? 'is missing' : `can't be read (${err.code || err.name})` };
  }
  let text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    if (!lenient) return { error: 'starts with a byte-order mark' };
    text = text.slice(1);
  } else if (lenient && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.toString('utf16le', 2);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return { error: 'is not valid JSON' }; // never the parser's message: it can quote the file
  }
  const problems = validate(config);
  return problems.length ? { error: `is invalid: ${problems.join('; ')}` } : { config };
}

function show(file) {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

function parseArgs(argv) {
  const opts = { check: false, help: false, from: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const option = /^--(from|to)(?:=(.*))?$/.exec(arg);
    if (arg === '--check') opts.check = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (option) {
      const value = option[2] ?? argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${option[1]} needs a file`);
      opts[option[1]] = path.resolve(value);
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  if (opts.check && opts.from) throw new Error('--check reads only the --to file');
  return { ...opts, from: opts.from || SOURCE, to: opts.to || TARGET };
}

function copy(from, to) {
  const { config, error, missing } = load(from, true);
  if (error) {
    console.error(`cloud-config: ${show(from)} ${error}; nothing was written.`);
    if (missing && from === SOURCE) {
      console.error('Write it from Terraform\'s app_config output first (infra/README.md, "The app\'s settings").');
    }
    return 1;
  }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, `${JSON.stringify(config, null, 2)}\n`);
  } catch (err) {
    console.error(`cloud-config: can't write ${show(to)} (${err.code || err.name}).`);
    return 1;
  }
  console.log(`cloud-config: ok ${config.projectId} (copied ${show(from)} to ${show(to)})`);
  return 0;
}

function check(file, env) {
  const noCloud = env.RECALLER_NO_CLOUD === '1';
  const { config, error } = load(file, false);
  if (!error) {
    console.log(`cloud-config: ok ${config.projectId} (${show(file)})`);
    if (noCloud) console.log('cloud-config: note: RECALLER_NO_CLOUD=1 is ignored because the config is valid; this build has accounts.');
    return 0;
  }
  if (noCloud) {
    console.warn(`cloud-config: warning: ${show(file)} ${error}; RECALLER_NO_CLOUD=1, so the build ships without accounts.`);
    return 0;
  }
  console.error(`cloud-config: ${show(file)} ${error}.`);
  console.error('Run "npm run cloud:config" first, or set RECALLER_NO_CLOUD=1 to build without accounts.');
  return 1;
}

function main(argv, env) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`cloud-config: ${err.message}\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  return opts.check ? check(opts.to, env) : copy(opts.from, opts.to);
}

module.exports = { validate, main };

if (require.main === module) process.exitCode = main(process.argv.slice(2), process.env);
