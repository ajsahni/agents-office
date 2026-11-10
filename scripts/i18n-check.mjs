// node scripts/i18n-check.mjs — pure lookup/regex checks for src/i18n.js (no DOM, no build).
import assert from 'node:assert/strict';
import { translate as t } from '../src/i18n.js';

assert.equal(t('RUN NOW'), 'EJECUTAR YA');
assert.equal(t('  ADD \n'), 'AGREGAR'); // whitespace collapsed + trimmed
assert.equal(t('WAITING ON APPROVAL'), 'ESPERANDO APROBACIÓN');
assert.equal(t('Sales'), 'Ventas');
assert.equal(t('SALES'), 'VENTAS');
assert.equal(t('NEWSLETTER'), null); // agent names are owner data: untouched
assert.equal(t('Sonnet'), null); // model names stay
assert.equal(t('Draft the September newsletter'), null); // task text stays
assert.equal(t('VENTAS'), null); // output never matches a key: no feedback loop
assert.equal(t(''), null);
assert.equal(t('MARKETING'), null); // same in both languages: absent from the dictionary (the DOM layer also skips same-value writes)
assert.equal(t('   '), null);
// regex rules
assert.equal(t('Acme · 1,204 NOTES · 87 LINKS'), 'Acme · 1,204 NOTAS · 87 ENLACES');
assert.equal(t('+3 more'), '+3 más');
assert.equal(t('5 agents'), '5 agentes');
assert.equal(t('New today · 4'), 'Nuevas hoy · 4');
assert.equal(t('Type a task for marketing…'), 'Escribe una tarea para marketing…');
assert.equal(t('Mon 3 Nov'), 'Lun 3 Nov');
assert.equal(t('MON 3 NOVEMBER'), 'LUN 3 NOVIEMBRE');
assert.equal(t('3–9 November'), '3–9 Noviembre');
assert.equal(t('schedule something on 3 Nov'), 'programar algo el 3 Nov');
assert.equal(t('November'), 'Noviembre');
assert.equal(t('Tue'), 'Mar');
assert.equal(t('Gmail — failed to connect'), 'Gmail — falló la conexión');
console.log('i18n-check: ok');
