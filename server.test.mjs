import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

test('local proxy forwards explicit loopback targets and enforces its boundary', async t => {
  const echo = http.createServer(async (request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'http://169.254.169.254/' });
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('X-Echo', 'test');
    response.end(JSON.stringify({
      method: request.method, url: request.url, body: Buffer.concat(chunks).toString(),
      authorization: request.headers.authorization,
    }));
  }).listen(0, '127.0.0.1');
  t.after(() => echo.close());
  await once(echo, 'listening');
  const target = `http://127.0.0.1:${echo.address().port}`;
  const reserve = http.createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  process.env.PORT = String(reserve.address().port);
  await new Promise(resolve => reserve.close(resolve));
  process.env.LOCAL_TARGETS = target;
  const { serve, publicIPv4 } = await import('./server.mjs');
  const server = serve();
  t.after(() => server.close());
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (payload, source = origin) => fetch(origin + '/api/send', {
    method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'GET', url: target, headers: [], ...payload }),
  });
  for (const path of ['/', '/app.js', '/style.css']) {
    assert.equal((await fetch(origin + path)).status, 200);
  }
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? '{"example":true}' : null;
    const response = await send({ url: target + '/echo?x=1&x=2', method, body, headers: [['Authorization', 'Bearer test']] });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, 200);
    assert.ok(data.ms >= 0);
    assert.ok(data.headers.some(([key, val]) => key.toLowerCase() === 'x-echo' && val === 'test'));
    if (method === 'HEAD') assert.equal(data.body, '');
    else assert.deepEqual(JSON.parse(data.body), {
      method, url: '/echo?x=1&x=2', body: body ?? '', authorization: 'Bearer test',
    });
  }
  assert.equal((await send({}, 'https://example.com')).status, 403);
  assert.equal((await send({ headers: [['Host', 'other']] })).status, 400);
  for (const url of ['http://127.1/', 'http://169.254.169.254/', 'http://[::1]/', 'file:///tmp/a', 'http://user:pass@example.com/']) {
    assert.equal((await send({ url })).status, 400);
  }
  const redirect = await (await send({ url: target + '/redirect' })).json();
  assert.equal(redirect.status, 302);
  for (const address of ['100.64.0.1', '172.16.0.1', '192.168.1.1', '168.63.129.16', '198.18.0.1', '224.0.0.1']) {
    assert.equal(publicIPv4(address), false, address);
  }
  assert.equal(publicIPv4('8.8.8.8'), true);
});
