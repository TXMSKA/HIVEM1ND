import { createOperation, request } from './api.mjs';
async function mutation(api, spec, retained) {
  const operation = retained ?? createOperation(spec);
  try {
    const result = await request(api, operation.method, operation.path, { operation });
    result.operation = operation;
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && error.operation == null) error.operation = operation;
    throw error;
  }
}
export function beginAdditionUpload(api, machine, name, retained = null) {
  return mutation(api, { method: 'POST', path: '/additions/uploads', body: { machine, name } }, retained);
}
export function sendAdditionChunk(api, uploadId, chunk, retained = null) {
  const { path, index, total, base64 } = chunk;
  return mutation(api, { method: 'PUT', path: '/additions/uploads/:uploadId/chunks', params: { uploadId },
    body: { path, index, total, base64 } }, retained);
}
export function cancelAdditionUpload(api, uploadId, retained = null) {
  return mutation(api, { method: 'DELETE', path: '/additions/uploads/:uploadId', params: { uploadId }, body: {} }, retained);
}
export function inspectAdditionSource(api, machine, source, updateOf = null, retained = null) {
  return mutation(api, { method: 'POST', path: '/additions/previews', body: { machine, source, updateOf } }, retained);
}
export function getAdditionPreview(api, previewId) {
  return request(api, 'GET', '/additions/previews/:previewId', { params: { previewId } });
}
export function retryAdditionPreview(api, previewId, retained = null) {
  return mutation(api, { method: 'POST', path: '/additions/previews/:previewId/retry', params: { previewId }, body: {} }, retained);
}
export function cancelAdditionPreview(api, previewId, retained = null) {
  return mutation(api, { method: 'DELETE', path: '/additions/previews/:previewId', params: { previewId }, body: {} }, retained);
}
export function acceptAdditions(api, input, retained = null) {
  const { machine, previewId, selections, expectedContentRevision, expectedProjectRevision } = input;
  return mutation(api, { method: 'POST', path: '/additions', body: { machine, previewId, selections,
    expectedContentRevision, expectedProjectRevision, confirmed: true } }, retained);
}
export function getAdditions(api, machine) {
  return request(api, 'GET', '/additions', { query: { machine } });
}
export function removeAddition(api, machine, additionId, expectedRevision, retained = null) {
  return mutation(api, { method: 'DELETE', path: '/additions/:additionId', params: { additionId },
    body: { machine, confirmed: true, expectedRevision } }, retained);
}
