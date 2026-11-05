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
const localeSource=await readFile(new URL('../app/admin/_lib/locale.js',import.meta.url),'utf8');
const localeCompiled=await swc.transform(localeSource,{filename:'locale.js',jsc:{target:'es2022',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const localeModule={exports:{}};
new vm.Script(localeCompiled.code).runInNewContext({module:localeModule,exports:localeModule.exports,require(id){if(id==='react'||id.startsWith('react/'))return require(id);if(id==='next/navigation')return {usePathname:()=>'/admin/offers'};if(id.endsWith('admin-copy.mjs'))return require('../lib/admin-copy.mjs');throw new Error('Unexpected locale dependency: '+id);}});
function render(state = { fields: {}, errors: {}, attempt: 0 },lang='en') {
  const componentModule = { exports: {} };
  const context = {
    module: componentModule, exports: componentModule.exports,
    require(id) {
      if (id === 'react') return { ...React, useActionState: () => [state, '/synthetic-only-action', false] };
      if (['react/jsx-runtime', 'react/jsx-dev-runtime'].includes(id)) return require(id);
      if(id.endsWith('_lib/locale.js'))return localeModule.exports;
      throw new Error(`Unexpected component dependency: ${id}`);
    },
  };
  new vm.Script(compiled.code).runInNewContext(context);
  return renderToStaticMarkup(React.createElement(localeModule.exports.AdminLocaleProvider,{lang},React.createElement(componentModule.exports.default, { action() {}, csrf: 'synthetic-only-csrf' })));
}

test('the extracted form retains its CSRF field, Cairo labels and explicit phone-use meaning', () => {
  const html = render();
  assert.match(html, /name="_csrf" value="synthetic-only-csrf"/);
  assert.match(html, /Starts \(Cairo time\)/);
  assert.match(html, /one use of this code per phone number/);
  assert.match(html,/name="first_order_only"/);
  assert.match(html,/First order only/);
});

test('Arabic renders the actual offer form, validation and placeholders while preserving submitted code',()=>{
  const html=render({attempt:1,fields:{code:'SYNTH15',first_order_only:'1'},errors:{code:'This code already exists. Choose another code.'}},'ar');
  assert.match(html,/العنوان بالعربية/);assert.match(html,/أول طلب فقط/);assert.match(html,/هذا الكود موجود بالفعل/);
  assert.match(html,/value="SYNTH15"/);assert.match(html,/name="first_order_only"[^>]*checked/);
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

test('real success and error flash components render in Arabic instead of throwing',async()=>{
  const compiledUi=await swc.transform(await readFile(new URL('../app/admin/_lib/ui.js',import.meta.url),'utf8'),{filename:'ui.js',jsc:{target:'es2022',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
  const module={exports:{}};
  new vm.Script(compiledUi.code).runInNewContext({module,exports:module.exports,require(id){if(id.startsWith('react/'))return require(id);if(id==='./locale.js')return localeModule.exports;if(id.endsWith('/config.js'))return {site:{currency:'EGP'}};throw Error('Unexpected UI dependency '+id);}});
  for(const code of ['offer_created','csrf','ops_saved','ops_stale','ops_unavailable']){
    const html=renderToStaticMarkup(React.createElement(localeModule.exports.AdminLocaleProvider,{lang:'ar'},React.createElement(module.exports.Flash,{code})));
    assert.match(html,/[\u0600-\u06ff]/);assert.doesNotMatch(html,/undefined/);
  }
});
