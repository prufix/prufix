#!/usr/bin/env node
// Test helper: read one key from a GITHUB_OUTPUT-format file. Understands
// both the `key=value` form and the heredoc form. Last write wins, like the
// real runner. Prints the raw value to stdout.
'use strict';

const fs = require('fs');

const [, , file, key] = process.argv;
if (!file || !key) {
  console.error('usage: read-output.js <github-output-file> <key>');
  process.exit(2);
}

const lines = fs.readFileSync(file, 'utf8').split('\n');
let value = null;
let i = 0;
while (i < lines.length) {
  const heredoc = lines[i].match(/^([^=<]+)<<(.+)$/);
  if (heredoc) {
    const [, k, delim] = heredoc;
    const buf = [];
    i++;
    while (i < lines.length && lines[i] !== delim) {
      buf.push(lines[i]);
      i++;
    }
    if (k === key) value = buf.join('\n');
    i++;
    continue;
  }
  const kv = lines[i].match(/^([^=]+)=(.*)$/);
  if (kv && kv[1] === key) value = kv[2];
  i++;
}

if (value === null) {
  console.error(`read-output: key not found: ${key}`);
  process.exit(1);
}
process.stdout.write(value);
