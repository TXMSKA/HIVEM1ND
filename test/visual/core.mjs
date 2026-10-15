import { randomUUID } from 'node:crypto';
import { createNativeAdapter } from '../../engine/service/adapters.mjs';
import { composeCore } from '../../engine/service/service.mjs';
import { createStore } from '../../engine/service/store.mjs';
import { dispose, makeCoreFixture } from '../core-fixture.mjs';
import { createFinalCoreFixture } from '../gui-fixture.mjs';

// The actual core on a free loopback port: production HTTP, authentication, persistence and recovery,
// a temporary M1ND, and the 26 fixture repositories the actual-core T064 tests use.
export async function bootWorld({ language = 'en', look = 'modern', prepare = null } = {}) {
  const fx = await createFinalCoreFixture({ language, look, prepare }, { makeCoreFixture, dispose, composeCore, createStore, createNativeAdapter });
  const world = {
    fx,
    get origin() { return fx.origin; },
    get token() { return fx.headers.Authorization.slice('Bearer '.length); },
    get url() { return `${fx.origin}/#session=${world.token}`; },
    get core() { return fx.core; },
    get mind() { return fx.fixture.paths.mind; },
    get home() { return fx.fixture.home; },
    async call(method, target, body, options = {}, expected = [200, 201, 202]) {
      const result = await fx.request(method, target, { ...options, ...(body === undefined ? {} : { body }) });
      if (!expected.includes(result.status)) throw new Error(`${method} ${target}: ${result.status} ${result.json?.error?.code ?? ''}`);
      return result.json?.data;
    },
    key: () => randomUUID(),
    close: () => fx.close(),
  };
  return world;
}
