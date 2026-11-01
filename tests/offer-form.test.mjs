// Compile the real client component and check server-rendered form semantics.
// This does not start Next or claim browser/hydration coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const swc = require('next/dist/build/swc');
const source = await readFile(new URL('../app/admin/(panel)/offers/OfferForm.js', import.meta.url), 'utf8');
const compiled = await swc.transform(source, {
  filename: 'OfferForm.js',
  jsc: { target: 'es2022', parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'commonjs' },
});
function render(state = { fields: {}, errors: {}, attempt: 0 }) {
  const componentModule = { exports: {} };
  const context = {
    module: componentModule, exports: componentModule.exports,
    require(id) {
      if (id === 'react') return { ...React, useActionState: () => [state, '/synthetic-only-action', false] };
      if (['react/jsx-runtime', 'react/jsx-dev-runtime'].includes(id)) return require(id);
      throw new Error(`Unexpected component dependency: ${id}`);
    },
  };
  new vm.Script(compiled.code).runInNewContext(context);
  return renderToStaticMarkup(React.createElement(componentModule.exports.default, { action() {}, csrf: 'synthetic-only-csrf' }));
}

test('the extracted form retains its CSRF field, Cairo labels and explicit phone-use meaning', () => {
  const html = render();
  assert.match(html, /name="_csrf" value="synthetic-only-csrf"/);
  assert.match(html, /Starts \(Cairo time\)/);
  assert.match(html, /one use of this code per phone number/);
  assert.doesNotMatch(html, /first order only/);
});

test('returned validation state keeps escaped inputs and links field errors accessibly', () => {
  const html = render({ attempt: 1, fields: { code: 'SYNTH15', title_ar: '<script>synthetic</script>' }, errors: { code: 'This code already exists.' } });
  assert.match(html, /role="alert"/);
  assert.match(html, /href="#code"/);
  assert.match(html, /id="code-error"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="code-error"/);
  assert.match(html, /value="SYNTH15"/);
  assert.match(html, /&lt;script&gt;synthetic&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('announcement validation state renders the correct type before hydration', () => {
  const html = render({ attempt: 1, fields: { discount_type: 'none', discount_value: '' }, errors: { title_ar: 'Enter an Arabic title.' } });
  assert.match(html, /option value="none" selected=""/);
  const valueInput = (html.match(/<input\b[^>]*>/g) || []).find(tag => /\bname="discount_value"/.test(tag));
  assert.ok(valueInput, 'the discount input must be present');
  assert.match(valueInput, /\bdisabled=""/);
  assert.match(html, /id="code"[^>]*name="code"/);
});

test('changed server pages compile with the installed Next JSX compiler', async () => {
  for (const relative of ['app/admin/(panel)/offers/page.js', 'app/admin/(panel)/page.js']) {
    await swc.transform(await readFile(new URL('../' + relative, import.meta.url), 'utf8'), {
      filename: relative,
      jsc: { target: 'es2022', parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' },
    });
  }
});
