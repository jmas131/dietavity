'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'views', 'purchase.ejs'), 'utf8');

test('homepage and service route use the canonical public assistant landing', () => {
  assert.match(server, /app\.get\('\/'[\s\S]*?res\.render\('purchase'\)/);
  assert.match(server, /app\.get\('\/servicio'[\s\S]*?res\.render\('purchase'\)/);
  assert.match(landing, /Dietavity es un asistente de alimentación por WhatsApp/i);
});

test('public proposition describes implemented inputs without unsupported product promises', () => {
  for (const text of ['qué has comido', 'cómo está tu apetito', 'alimentos tienes disponibles', 'No vendemos GLP-1', 'No lo prescribimos', 'No modificamos tu tratamiento']) assert.match(landing, new RegExp(text, 'i'));
  assert.doesNotMatch(landing, /durable preference|aprende tus preferencias|plan de comidas|interacción por voz|\$149|28 días|portal/i);
});
