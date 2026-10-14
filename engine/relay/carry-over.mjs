import { createRelay } from './store.mjs';

export function hostSessionOf(env = process.env) {
  const id = env.CLAUDE_CODE_HOST_SESSION_ID;
  return typeof id === 'string' && /^[^\u0000-\u001f\u007f]{1,180}$/.test(id) ? id : null;
}

// The owner verifies the current native connection before consulting a host conversation.
// A transcript path, a working directory and another chat's last activity are never identity.
export async function carryHostConversation({ mindPath, hostname, binding, hostSessionId, controller, proveBinding, commitFile }) {
  if (!hostSessionId || !/^[^\u0000-\u001f\u007f]{1,180}$/.test(hostSessionId)
    || binding?.machine !== hostname || binding.client !== 'claude' || !binding.unitId
    || typeof proveBinding !== 'function' || await proveBinding(binding) !== true) return null;
  const relay = await createRelay({ mindPath, hostname, client: binding.client });
  const exact = Object.fromEntries(['unit', 'unitId', 'nativeSessionId', 'client', 'machine'].map(key => [key, binding[key]]));
  const previous = await relay.hostRegistration({ hostSessionId, client: binding.client });
  if (previous && previous.unitId !== binding.unitId) return null;
  const current = await relay.wakePersistence.resolveBinding(exact);
  if (!current) return null;
  if (current.hostSessionId && current.hostSessionId !== hostSessionId) return null;
  const scoped = await createRelay({ mindPath, hostname, scopeLock: true, pinnedRegistration: current, proveBinding, commitFile });
  const registration = current.hostSessionId === hostSessionId ? current : await scoped.register({ unit: current.unit,
    nativeSessionId: current.nativeSessionId, client: current.client, hostSessionId });
  await scoped.hold();
  await controller.takeOver(exact);
  await controller.resume(exact);
  const status = await controller.status(exact);
  if (status.enabled) controller.start(status.binding);
  return { unitId: registration.unitId, sessionId: registration.sessionId,
    previous: previous?.sessionId ?? null, binding: status.enabled ? status.binding : null };
}
