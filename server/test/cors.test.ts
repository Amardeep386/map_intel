// CORS_ORIGINS parsing tolerates what people paste into a dashboard.   npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOrigins } from '../src/lib/cors.js';

test('strips trailing slashes, quotes and spaces', () => {
  assert.deepEqual(parseOrigins(' "https://a.vercel.app/" , https://b.example.com//,,'), [
    'https://a.vercel.app',
    'https://b.example.com',
  ]);
});

test('keeps ports and plain origins unchanged', () => {
  assert.deepEqual(parseOrigins('http://localhost:5173'), ['http://localhost:5173']);
});
