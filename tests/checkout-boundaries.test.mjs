import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readJson, MAX_BODY } from '../lib/http.js';

registerHooks({
  resolve(specifier, context, next) {
    return next(specifier === 'next/server' ? 'next/server.js' : specifier, context);
  },
});
const { NextRequest } = await import('next/server.js');
const { middleware } = await import('../middleware.js');
const run = (url, method = 'GET') => middleware(new NextRequest(new Request(url, { method })));

test('JSON media type is exact; ordinary charset and case variations work', async () => {
  for (const ct of ['application/json', 'application/json; charset=utf-8', 'Application/JSON; charset=UTF-8']) {
    const req = new Request('https://example.invalid', {
      method: 'POST', headers: { 'content-type': ct }, body: '{"sku":"SYNTHETIC"}',
    });
    assert.deepEqual(await readJson(req), { body: { sku: 'SYNTHETIC' } });
  }
});

test('non-JSON and deceptive parameter media types never read the body', async () => {
  for (const ct of ['', 'text/plain', 'text/plain;application/json', 'text/plain; type="application/json"',
    'application/x-www-form-urlencoded;application/json', 'multipart/form-data; boundary=application/json',
    'application/jsonp', 'application/json+xml', 'application/json, text/plain', 'x-application/json']) {
    const req = { headers: new Headers(ct ? { 'content-type': ct } : {}),
      text() { throw Error('Rejected media type reached the body reader'); } };
    assert.deepEqual(await readJson(req), { body: {} }, ct);
  }
});

test('JSON size and malformed-body guards remain effective', async () => {
  const req = body => new Request('https://example.invalid', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.deepEqual(await readJson(req('{bad')), { body: {} });
  assert.deepEqual(await readJson(req('x'.repeat(MAX_BODY + 1))), { tooLarge: true });
  assert.deepEqual(await readJson({ headers: new Headers({ 'content-type': 'application/json',
    'content-length': String(MAX_BODY + 1) }), text() { throw Error('Oversize body read'); } }), { tooLarge: true });
});

test('www GET/HEAD use HTTPS apex while preserving locale, path and query', () => {
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/en/checkout?source=synthetic&note=a%2Fb', '/order/find', '/admin/login', '/en/unknown']) {
      const res = run('https://www.newstarseven.com' + path, method);
      assert.equal(res.status, 308);
      assert.equal(res.headers.get('location'), 'https://newstarseven.com' + path);
    }
  }
  assert.equal(run('http://www.newstarseven.com:8080/en/shop').headers.get('location'), 'https://newstarseven.com/en/shop');
});

test('stale www writes are denied without a redirect or automatic replay', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const path of ['/api/order', '/api/coupon', '/api/order/find', '/api/order/cancel', '/api/order/refund', '/admin/login']) {
      const res = run('https://www.newstarseven.com' + path, method);
      assert.equal(res.status, 403);
      assert.equal(res.headers.get('location'), null);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  }
});

test('apex, preview and local hosts keep their existing routing', () => {
  for (const host of ['https://newstarseven.com', 'https://synthetic-preview.vercel.app', 'http://localhost:3000', 'https://www.newstarseven.com.example.invalid']) {
    const res = run(host + '/en/checkout');
    assert.equal(res.headers.get('location'), null);
    assert.equal(res.headers.get('x-middleware-next'), '1');
  }
});

test('the HTTP Host selects canonical routing when Next uses an internal URL', () => {
  for (const method of ['GET', 'POST']) {
    const req = new NextRequest(new Request('http://127.0.0.1:3197/en/checkout?source=synthetic', {
      method, headers: { host: 'WWW.NEWSTARSEVEN.COM:443' },
    }));
    const res = middleware(req);
    assert.equal(res.status, method === 'GET' ? 308 : 403);
    assert.equal(res.headers.get('location'), method === 'GET' ? 'https://newstarseven.com/en/checkout?source=synthetic' : null);
  }
  const req = new NextRequest(new Request('https://newstarseven.com/en/checkout', {
    headers: { host: 'newstarseven.com', 'x-forwarded-host': 'www.newstarseven.com' },
  }));
  assert.equal(middleware(req).headers.get('location'), null);
});

test('the existing holding gate still precedes www navigation and submissions', () => {
  const prior = process.env.SITE_PASSWORD;
  process.env.SITE_PASSWORD = 'synthetic-local-only';
  try {
    for (const method of ['GET', 'POST']) {
      const res = run('https://www.newstarseven.com/en/checkout', method);
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('location'), null);
    }
  } finally {
    if (prior === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = prior;
  }
});
