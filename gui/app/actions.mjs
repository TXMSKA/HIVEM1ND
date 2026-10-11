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

export async function createUnit(api, input, retained = null) {
  const operation = retained ?? createOperation({
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
  return commit(api, operation);
}

export async function startSession(api, unit, client, prompt = null, retained = null) {
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/units/:unitId/session",
    params: { unitId: unit.id },
    body: { client, prompt, expectedRevision: unit.revision },
  });
  const result = await commit(api, operation);
  return { ...result, operation };
}

export async function trackSessionRequest(api, requestId) {
  return request(api, "GET", `/session-requests/${encodeURIComponent(requestId)}`);
}

export async function stopSession(api, sessionId, retained = null) {
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/sessions/:sessionId/stop",
    params: { sessionId },
    body: { confirmed: true },
  });
  const result = await commit(api, operation);
  return { ...result, operation };
}

export function canAccept(task) {
  return task?.status === "review" && task.reviewable === true;
}

export function canSendBack(task) {
  return task?.status === "review";
}

export async function answerApproval(api, approval, decision, retained = null) {
  if (decision === "approve-always" && approval.alwaysAllowed === false) {
    const error = new Error("Approve always is not available.");
    error.code = "always_unavailable";
    throw error;
  }
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/approvals/:approvalId/answer",
    params: { approvalId: approval.id },
    body: { decision, expectedRevision: approval.revision },
  });
  const result = await commit(api, operation);
  return { ...result, operation };
}

export async function trackAnswer(api, approvalId, answerId) {
  return request(api, "GET", `/approvals/${encodeURIComponent(approvalId)}/answers/${encodeURIComponent(answerId)}`);
}

export async function revokeGrant(api, unit, grantId, retained = null) {
  const operation = retained ?? createOperation({
    method: "DELETE",
    path: "/units/:unitId/approval-grants/:grantId",
    params: { unitId: unit.id, grantId },
    body: { expectedRevision: unit.revision },
  });
  const result = await commit(api, operation);
  return { ...result, operation };
}

export async function changeTaskStatus(api, task, status, note = null, retained = null) {
  if (status === "open" && !String(note ?? "").trim()) {
    const error = new Error("A note is required.");
    error.code = "note_required";
    throw error;
  }
  const body = retained?.body ?? { status, expectedRevision: task.revision };
  if (!retained && typeof note === "string") body.note = note;
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/tasks/:taskId/status",
    params: { taskId: task.id },
    body,
  });
  return commit(api, operation);
}

export async function undoTask(api, task, retained = null) {
  const operation = retained ?? createOperation({
    method: "POST",
    path: "/tasks/:taskId/undo",
    params: { taskId: task.id },
    body: { expectedRevision: task.revision },
  });
  return commit(api, operation);
}

async function commit(api, operation) {
  try {
    return await request(api, operation.method, operation.path, { operation });
  } catch (error) {
    if (error && typeof error === "object") error.operation = operation;
    throw error;
  }
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
