export function queryLimit(searchParams, defaultLimit = 20, maxLimit = 100) {
  const value = searchParams.get('limit');
  if (!value) return null;
  return Math.max(1, Math.min(maxLimit, Number(value) || defaultLimit));
}

export function queryOffset(searchParams) {
  return Math.max(0, Number(searchParams.get('offset') || 0) || 0);
}
