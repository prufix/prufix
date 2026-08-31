#!/usr/bin/env node
// Minimal in-memory fake of the three GitHub REST endpoints the action's
// PR-comment code touches. Logs "METHOD /path" lines to the file given as
// argv[2] so tests can assert which calls were made. GET /__comments is a
// test-only introspection endpoint.
'use strict';

const http = require('http');
const fs = require('fs');

const logFile = process.argv[2];
const comments = [];
let nextId = 1;

function log(line) {
  if (logFile) fs.appendFileSync(logFile, line + '\n');
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    log(`${req.method} ${req.url.split('?')[0]}`);
    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    let m;
    if (req.method === 'GET' && req.url === '/__comments') return json(200, comments);
    if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments/.test(req.url)) {
      return json(200, comments);
    }
    if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(req.url)) {
      const c = { id: nextId++, body: JSON.parse(body).body };
      comments.push(c);
      return json(201, c);
    }
    if (req.method === 'PATCH' && (m = req.url.match(/^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/))) {
      const c = comments.find((x) => x.id === Number(m[1]));
      if (!c) return json(404, { message: 'not found' });
      c.body = JSON.parse(body).body;
      return json(200, c);
    }
    json(404, { message: 'not found' });
  });
});

server.listen(0, '127.0.0.1', () => {
  console.log(`PORT=${server.address().port}`);
});
