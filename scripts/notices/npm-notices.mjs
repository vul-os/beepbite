#!/usr/bin/env node
// Format the JSON output of license-checker-rseidelsohn into an attribution
// section: name, version, licence id and the FULL licence text of every npm
// package bundled into the shipped web app.
//
// Usage:  npx license-checker-rseidelsohn --production --json --excludePrivatePackages --start web \
//           | node scripts/notices/npm-notices.mjs
//
// The package list comes from the real installed dependency tree — it is never
// hand-maintained. Fails loudly if a package declares a licence we don't
// recognise and has no licence file, so a missing attribution can never be
// silently shipped.
//
// Some packages (several @radix-ui/* subpackages, canvas, dlv, ...) declare
// "license": "MIT" in package.json but ship no separate LICENSE file — only a
// README. For those, and only for SPDX identifiers we have a canonical text
// for, we reproduce the standard licence body with the package's own
// repository URL as the attribution line, rather than failing the whole
// build over a packaging omission upstream.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const raw = readFileSync(0, 'utf8');
const pkgs = JSON.parse(raw);

const LICENCE_FILE = /^(licen[cs]e|copying|notice)/i;
const out = [];
const problems = [];

const SPDX_TEMPLATES = {
  MIT: (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
};

function fallbackText(info) {
  const raw = (Array.isArray(info.licenses) ? info.licenses.join(' AND ') : info.licenses || '').trim();
  // Some packages declare a compound expression ("MIT AND ISC") because they
  // bundle a small amount of code under a second permissive licence. Picking
  // the first recognised component's canonical text is a reasonable notice
  // for a compound-of-permissive-licences package; the declared expression is
  // still printed verbatim on the "Licence :" line above this text.
  let template, id;
  for (const part of raw.split(/\s+(?:AND|OR)\s+/i)) {
    const t = part.trim();
    if (SPDX_TEMPLATES[t]) { template = SPDX_TEMPLATES[t]; id = t; break; }
  }
  if (!template) return null;
  const holder = info.repository
    ? `the contributors to ${info.repository}`
    : 'the package author(s)';
  return template(holder) + '\n\n[No LICENSE file was published with this package; the canonical '
    + id + ' licence text above is reproduced from the SPDX standard text for the '
    + 'licence this package declares in its own package.json.]';
}

for (const key of Object.keys(pkgs).sort()) {
  const info = pkgs[key];
  const at = key.lastIndexOf('@');
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  const licence = Array.isArray(info.licenses) ? info.licenses.join(' OR ') : info.licenses;
  const file = info.licenseFile;

  let text;
  if (file && LICENCE_FILE.test(basename(file))) {
    try {
      text = readFileSync(file, 'utf8').trimEnd();
    } catch (err) {
      problems.push(`${key}: cannot read ${file}: ${err.message}`);
      continue;
    }
  } else {
    text = fallbackText(info);
    if (text === null) {
      problems.push(`${key}: no licence file found and no fallback template for "${licence}" (licenseFile=${file || 'none'})`);
      continue;
    }
  }

  out.push(
    '-'.repeat(80),
    `Package : ${name}`,
    `Version : ${version}`,
    `Licence : ${licence}`,
    '-'.repeat(80),
    '',
    text,
    '',
  );
}

if (problems.length) {
  console.error('npm-notices: cannot attribute the following packages:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

process.stdout.write(out.join('\n') + '\n');
