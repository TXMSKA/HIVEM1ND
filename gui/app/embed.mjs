export function startEmbedChannel(viewer, actions, transport) {
  const channel = {
    viewer,
    actions,
    transport,
    disposed: false,
    onMessage: (event) => {
      handleParentMessage(channel, event).catch(() => undefined);
    },
  };
  transport?.addEventListener?.("message", channel.onMessage);
  return channel;
}

export function publishReady(channel) {
  publish(channel, "ready", {
    viewerId: channel.viewer.viewerId,
    capabilities: channel.viewer.capabilities ?? [],
  });
}

export function publishDirty(channel, dirty) {
  publish(channel, "dirty", Boolean(dirty));
}

export async function handleParentMessage(channel, event) {
  if (channel.disposed) return;
  const viewer = channel.viewer;
  const parent = channel.transport?.parent ?? null;
  const message = event?.data;
  if (!viewer?.embedded || !viewer.hostOrigin || !parent) return;
  if (event.source !== parent || event.origin !== viewer.hostOrigin) return;
  if (message?.contract !== "hivem1nd-embed-v1" || message.viewerId !== viewer.viewerId) return;
  if (message.type === "set-look" && ["modern", "high-contrast"].includes(message.value)) {
    await channel.actions.patchViewer({ look: message.value });
  } else if (message.type === "set-language" && ["en", "es"].includes(message.value)) {
    await channel.actions.patchViewer({ language: message.value });
  } else if (message.type === "close" && message.value === null) {
    await channel.actions.logout();
  }
}

export function dispose(channel) {
  if (!channel || channel.disposed) return;
  channel.disposed = true;
  channel.transport?.removeEventListener?.("message", channel.onMessage);
}

function publish(channel, type, value) {
  const viewer = channel?.viewer;
  const parent = channel?.transport?.parent;
  if (!channel || channel.disposed || !viewer?.embedded || !viewer.hostOrigin || !parent?.postMessage) return;
  parent.postMessage({
    contract: "hivem1nd-embed-v1",
    viewerId: viewer.viewerId,
    type,
    value,
  }, viewer.hostOrigin);
}
