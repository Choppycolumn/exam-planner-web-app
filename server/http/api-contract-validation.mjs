import { findApiContract } from '../../shared/api-contracts.js';

function validationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_REQUEST';
  error.statusCode = 400;
  return error;
}

function validateField(name, descriptor, value) {
  const optional = descriptor.endsWith('?');
  const type = optional ? descriptor.slice(0, -1) : descriptor;
  if (value === undefined || value === null || value === '') {
    if (!optional) throw validationError(`缺少字段：${name}`);
    return;
  }
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw validationError(`字段 ${name} 必须是有效数字`);
  }
  if (type === 'string' && typeof value !== 'string') {
    throw validationError(`字段 ${name} 必须是字符串`);
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    throw validationError(`字段 ${name} 必须是布尔值`);
  }
  if (type === 'array' && !Array.isArray(value)) {
    throw validationError(`字段 ${name} 必须是数组`);
  }
  if (type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
    throw validationError(`字段 ${name} 必须是对象`);
  }
}

export function validateContractRequest(method, pathname, body) {
  const match = findApiContract(method, pathname);
  if (!match) return null;
  const [name, contract] = match;
  if (contract.body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('请求正文必须是 JSON 对象');
    for (const [field, descriptor] of Object.entries(contract.body)) validateField(field, descriptor, body[field]);
  }
  return { name, contract };
}

export function apiErrorPayload(error, requestId = '') {
  const status = Number(error?.statusCode || 500);
  const code = String(error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'));
  const message = status >= 500 ? '服务器暂时无法处理请求' : String(error?.message || '请求失败');
  return { error: { code, message, requestId }, message, requestId };
}
