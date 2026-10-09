// Live: how the page hears that a file of its boards changed on disk.
//
// The server tells it on one route, /api/live. Where the browser has
// EventSource the route is a stream of server-sent events, and the browser
// reconnects by itself when the connection drops. Where it has none, or the
// stream is refused for good, the page asks the same route on a timer and is
// told what happened since its last cursor. Either way each change reaches
// `onChange` as { project, kind, board }, and `onResync` runs when events may
// have been missed, so the page reads what it shows again.

const ROUTE = "/api/live";
const POLL_MS = 2500;
// EventSource.CLOSED: the browser gave up on the stream and will not retry.
const CLOSED = 2;

export function watchLive({ onChange, onResync, source = globalThis.EventSource, fetcher = globalThis.fetch?.bind(globalThis), route = ROUTE, pollMs = POLL_MS }) {
  let mode = "stream";
  let stream = null;
  let timer = 0;
  let cursor = null;
  let stopped = false;

  async function poll() {
    try {
      const response = await fetcher(cursor === null ? route : `${route}?after=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json();
      cursor = data.cursor;
      if (data.resync) onResync();
      for (const change of data.events) onChange(change);
    } catch {
      /* The server did not answer: it is asked again at the next turn. */
    }
    if (!stopped) timer = setTimeout(poll, pollMs);
  }

  function ask() {
    mode = "poll";
    stream?.close();
    stream = null;
    // What happened while no stream was open is unknown.
    onResync();
    poll();
  }

  if (typeof source !== "function") ask();
  else {
    let first = true;
    stream = new source(route);
    stream.addEventListener("ready", () => {
      // Reconnected: the server may have changed files since the stream dropped.
      if (!first) onResync();
      first = false;
    });
    stream.addEventListener("change", (event) => onChange(JSON.parse(event.data)));
    stream.addEventListener("error", () => {
      if (stream?.readyState === CLOSED) ask();
    });
  }

  return {
    mode: () => mode,
    stop() {
      stopped = true;
      clearTimeout(timer);
      stream?.close();
    },
  };
}
