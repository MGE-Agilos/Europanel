'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toDb, fromDb } = require('../docs/db.js');

test('toDb convertit la chaîne vide en null pour tous les types', () => {
  assert.strictEqual(toDb('', 'text'), null);
  assert.strictEqual(toDb('', 'num'), null);
  assert.strictEqual(toDb('', 'int'), null);
});

test('toDb convertit les nombres', () => {
  assert.strictEqual(toDb('180.50', 'num'), 180.5);
  assert.strictEqual(toDb('2019', 'int'), 2019);
});

test('toDb rejette le texte non numérique en null', () => {
  assert.strictEqual(toDb('n/a', 'num'), null);
  assert.strictEqual(toDb('inconnu', 'int'), null);
});

test('toDb traite la case à cocher : "on" vaut true, absent vaut false', () => {
  assert.strictEqual(toDb('on', 'bool'), true);
  assert.strictEqual(toDb(undefined, 'bool'), false);
  assert.strictEqual(toDb('', 'bool'), false);
});

test('fromDb rend la chaîne vide pour null', () => {
  assert.strictEqual(fromDb(null, 'text'), '');
  assert.strictEqual(fromDb(null, 'num'), '');
});

test('fromDb rend "on" pour true et undefined pour false', () => {
  assert.strictEqual(fromDb(true, 'bool'), 'on');
  assert.strictEqual(fromDb(false, 'bool'), undefined);
});

test('fromDb rend les nombres sous forme de chaîne', () => {
  assert.strictEqual(fromDb(180.5, 'num'), '180.5');
  assert.strictEqual(fromDb(2019, 'int'), '2019');
});
