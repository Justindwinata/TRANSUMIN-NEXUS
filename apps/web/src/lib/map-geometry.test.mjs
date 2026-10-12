import assert from 'node:assert/strict';
import test from 'node:test';

const { mapGeometryPoints } = await import('./map-geometry.ts');

test('map geometry rejects malformed legs without joining gaps', () => {
  assert.deepEqual(mapGeometryPoints([[106.8, -6.2]]), []);
  assert.deepEqual(mapGeometryPoints([[106.8, -6.2], [181, -6.1]]), []);
  assert.deepEqual(mapGeometryPoints([[106.8, -6.2], [106.9, -6.1]]), [
    [106.8, -6.2],
    [106.9, -6.1],
  ]);
});
