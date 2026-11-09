// Run: node tests/run.mjs — checks the analysis against simulated riders with known geometry.
import assert from 'node:assert/strict';
import { analyzeSession } from '../analysis.js';
import { DICTS, setLang, t } from '../i18n.js';
import { sim, calibFrom } from './simulate.mjs';

const get = (r, k) => r.metrics.find((m) => m.key === k).value;
const cases = {
  'wheel calibration + manual BB + 3° camera roll'() {
    const s = sim({ rollDeg: 3, noise: 2 });
    const r = analyzeSession(s.out, { calib: calibFrom(s, true, 3) });
    assert.equal(r.scale.source, 'wheel');
    assert.equal(r.bbSource, 'manual');
    assert.equal(r.kopsMethod, 'crank');
    assert.ok(Math.abs(get(r, 'torso') - 45) < 1, 'roll corrected');
    assert.ok(r.notes.some((n) => n.id === 'noteCrankOk'), 'crank radius matches setting');
    assert.ok(r.curve && r.curve.length === 24);
  },
  'no calibration → auto BB + crank-based scale'() {
    const r = analyzeSession(sim({ noise: 2 }).out, {});
    assert.equal(r.scale.source, 'crank');
    assert.equal(r.bbSource, 'auto');
    assert.ok(Math.abs(r.cadence - 90) < 3);
  },
  'saddle 2 cm low → raise ≈ 20–32 mm'() {
    const s = sim({ saddleDrop: -2, noise: 2 });
    const r = analyzeSession(s.out, { calib: calibFrom(s, false, 0) });
    assert.equal(r.suggestions[0].id, 'saddleUp');
    assert.ok(r.heightDeltaMm >= 20 && r.heightDeltaMm <= 32, `got ${r.heightDeltaMm}`);
    assert.ok(r.bike.saddleHeight > 600 && r.bike.saddleHeight < 700);
  },
  'saddle 3 cm high → lower'() {
    const s = sim({ saddleDrop: 3 });
    const r = analyzeSession(s.out, { calib: calibFrom(s, false, 0) });
    assert.equal(r.suggestions[0].id, 'saddleDown');
    assert.ok(r.heightDeltaMm < -20);
  },
  'too few frames → not ok'() {
    assert.equal(analyzeSession(sim({ frames: 10 }).out, {}).ok, false);
  },
  'every string resolves (no missing keys, no leftover {placeholders})'() {
    const runs = [
      analyzeSession(sim({ rollDeg: 3, noise: 2 }).out, {}),
      analyzeSession(sim({ saddleDrop: 3 }).out, { heightCm: 175 }),
      analyzeSession(sim({ saddleDrop: -4, saddleBack: 4, torsoDeg: 25 }).out, {}),
      analyzeSession(sim({ frames: 10 }).out, {}),
    ];
    const text = JSON.stringify(runs);
    assert.ok(!/\{[a-z]+\}/i.test(text.replace(/"[a-z]+":/gi, '')), 'unfilled placeholder');
    assert.ok(!/"(s|m|a|area|verb|step|unit)\.[a-zA-Z]+"/.test(text), 'raw key leaked');
  },
};
const en = Object.keys(DICTS.en).sort(), zh = Object.keys(DICTS['zh-TW']).sort();
const parity = [...en.filter((k) => !zh.includes(k)).map((k) => `zh-TW missing ${k}`), ...zh.filter((k) => !en.includes(k)).map((k) => `en missing ${k}`)];
let failed = 0;
if (parity.length) { failed++; console.log(`✗ dictionary parity\n  ${parity.join('\n  ')}`); } else console.log('✓ dictionary parity');
for (const lang of ['en', 'zh-TW']) {
  setLang(lang, { persist: false });
  console.log(`— ${lang} (${t('lang.name')})`);
  for (const [name, fn] of Object.entries(cases)) {
    try { fn(); console.log(`✓ ${name}`); } catch (e) { failed++; console.log(`✗ ${name}\n  ${e.message}`); }
  }
}
process.exit(failed ? 1 : 0);
