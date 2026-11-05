import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const port = Number(process.env.PORT || 3210);
const origin = `http://127.0.0.1:${port}`;
const localTargets = new Set((process.env.LOCAL_TARGETS || '').split(',').map(value => value.trim()));
const fakeDnsTargets = new Set((process.env.FAKE_DNS_TARGETS || '').split(',').map(value => value.trim()));
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const reservedHeaders = /^(host|connection|content-length|transfer-encoding|expect|upgrade|keep-alive|te|trailer|proxy-.*|accept-encoding)$/i;
const limit = 2 * 1024 * 1024;
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);

export function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a)
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && ([0, 168].includes(b) || (b === 88 && c === 99)))
    && !(a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113)
    && address !== '168.63.129.16';
}

async function forward(input) {
  if (!input || !methods.has(input.method)) throw new Error('Unsupported HTTP method.');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('Enter a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) URL without embedded credentials.');
  }

  const start = performance.now();
  const signal = AbortSignal.timeout(15000);
  const ipv4 = isIP(url.hostname);
  const addresses = ipv4 ? [{ address: url.hostname, family: ipv4 }]
    : await Promise.race([
      lookup(url.hostname, { family: 4, all: true }).catch(() => { throw new Error('IPv4 DNS lookup failed.'); }),
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('DNS lookup timed out.')), { once: true })),
    ]);
  const local = localTargets.has(url.origin) && url.hostname === '127.0.0.1' && url.origin !== origin;
  const allowFakeDns = !ipv4 && url.protocol === 'https:' && fakeDnsTargets.has(url.origin);
  const allowedAddress = ({ address }) => publicIPv4(address)
    || (allowFakeDns && /^198\.(18|19)\./.test(address));
  if (!addresses.length || (!local && addresses.some(item => !allowedAddress(item)))) {
    throw new Error('Target is blocked. Public IPv4 is required unless an exact loopback origin is configured.');
  }

  const headers = Object.create(null);
  if (!Array.isArray(input.headers)) throw new Error('Invalid headers.');
  for (const [name, value] of input.headers) {
    if (reservedHeaders.test(name)) throw new Error('A transport-controlled header was supplied.');
    try {
      http.validateHeaderName(name);
      http.validateHeaderValue(name, value);
    } catch { throw new Error('Invalid header name or value.'); }
    const key = name.toLowerCase();
    headers[key] = key in headers ? [].concat(headers[key], value) : value;
  }
  headers['accept-encoding'] = 'identity';
  const body = input.body;
  if (body != null && typeof body !== 'string') throw new Error('Invalid request body.');
  if (body != null) headers['content-length'] = Buffer.byteLength(body);

  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: input.method, headers, signal, agent: false, family: 4,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [addresses[0]])
        : callback(null, addresses[0].address, 4),
    }, response => {
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error('Response exceeds the 2 MiB limit.'));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('Response stream interrupted.')));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const decoded = new TextDecoder().decode(buffer);
        const binary = Boolean(response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
          || decoded.includes('\u0000') || decoded.includes('\uFFFD');
        resolve({
          status: response.statusCode, statusText: response.statusMessage,
          ms: Math.round(performance.now() - start), bytes: buffer.length,
          headers: response.rawHeaders.flatMap((name, index, list) => index % 2 ? [] : [[name, list[index + 1]]]),
          body: binary ? buffer.toString('base64') : decoded, binary,
        });
      });
    });
    request.on('error', () => reject(new Error(signal.aborted ? 'Request timed out.' : 'Connection or TLS failed.')));
    request.end(body ?? undefined);
  });
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

export function serve() {
  const server = http.createServer({ requestTimeout: 20000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (request.headers.host !== new URL(origin).host) return json(response, 403, { error: 'Invalid host.' });
    const asset = assets.get(request.url);
    if (asset && request.method === 'GET') {
      try {
        const data = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
        response.end(data);
      } catch { json(response, 500, { error: 'Asset unavailable.' }); }
      return;
    }
    if (request.url !== '/api/send' || request.method !== 'POST') return json(response, 404, { error: 'Not found.' });
    if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
      return json(response, 403, { error: 'Requests must come from the local app.' });
    }
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) {
          response.setHeader('Connection', 'close');
          json(response, 413, { error: 'Request exceeds the 2 MiB limit.' });
          return;
        }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks)); }
      catch { return json(response, 400, { error: 'Invalid request payload.' }); }
      json(response, 200, await forward(input));
    } catch (error) {
      json(response, 400, { error: error instanceof TypeError ? 'Invalid request payload.' : error.message });
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`tiny-postman · ${origin}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
