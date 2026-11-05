import { createSyncCoordinator } from 'onem1nd/sync';
import { createConsumer, createOrigin, fixtureClock, fixtureCodec } from './sync-consumer.mjs';

const [root, machine] = process.argv.slice(2);
const consumer = await createConsumer(root, machine);
const origin = createOrigin(root);
process.send({ type: 'waiting' });
process.once('message', async () => {
  try {
    const coordinator = await createSyncCoordinator({ store: consumer.store, domain: consumer.domain,
      codec: fixtureCodec, origin: origin.adapter(), clock: fixtureClock() });
    await coordinator.resume();
    process.send({ type: 'acquired', status: await coordinator.status() });
    // The parent deliberately terminates this process without close() to exercise stale ownership recovery.
    process.on('message', () => {});
  } catch (error) {
    process.send({ type: 'rejected', code: error.code, retryable: error.retryable, operation: error.operation });
    process.disconnect();
  }
});
