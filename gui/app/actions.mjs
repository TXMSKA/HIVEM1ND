import { createOperation, request } from "./api.mjs";

export async function connectUnits(api, source, targets) {
  const results = [];
  for (const target of targets) {
    if (!target || target.id === source?.id || target.role === "master" || looksLikeCycle(source, target)) {
      results.push({ id: target?.id ?? null, error: { code: "invalid_lead", message: "The lead is not valid." } });
      continue;
    }
    const operation = createOperation({
      method: "PUT",
      path: "/units/:unitId/lead",
      params: { unitId: target.id },
      body: { leadId: source.id, confirmed: true, expectedRevision: target.revision },
    });
    try {
      const result = await request(api, "PUT", operation.path, { operation });
      results.push({ id: target.id, data: result.data, operation });
    } catch (error) {
      results.push({ id: target.id, error, operation });
    }
  }
  return results;
}

export async function createUnit(api, input) {
  const operation = createOperation({
    method: "POST",
    path: "/units",
    body: {
      unit: input.unit,
      role: input.role,
      scope: input.scope,
      machine: input.machine,
      leadId: input.leadId ?? null,
      job: input.job ?? null,
      model: input.model ?? null,
      ...(input.position ? { position: input.position } : {}),
    },
  });
  return request(api, "POST", operation.path, { operation });
}

export async function startSession(api, unit, client, prompt = null) {
  const operation = createOperation({
    method: "POST",
    path: "/units/:unitId/session",
    params: { unitId: unit.id },
    body: { client, prompt, expectedRevision: unit.revision },
  });
  const result = await request(api, "POST", operation.path, { operation });
  return { ...result, operation };
}

export async function trackSessionRequest(api, requestId) {
  return request(api, "GET", `/session-requests/${encodeURIComponent(requestId)}`);
}

export async function stopSession(api, sessionId) {
  const operation = createOperation({
    method: "POST",
    path: "/sessions/:sessionId/stop",
    params: { sessionId },
    body: { confirmed: true },
  });
  const result = await request(api, "POST", operation.path, { operation });
  return { ...result, operation };
}

function looksLikeCycle(source, target) {
  const seen = new Set([target.id]);
  let leadId = source?.leadId ?? null;
  while (leadId) {
    if (seen.has(leadId)) return true;
    if (leadId === target.id) return true;
    seen.add(leadId);
    leadId = null;
  }
  return false;
}
