export type SortDirection = 'asc' | 'desc';

export function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return Number(Boolean(left)) - Number(Boolean(right));
  }
  const leftDate = typeof left === 'string' ? Date.parse(left) : NaN;
  const rightDate = typeof right === 'string' ? Date.parse(right) : NaN;
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return leftDate - rightDate;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right), 'ru');
}

export function sortRows<T>(
  rows: T[],
  direction: SortDirection,
  value: (row: T) => unknown,
): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => compareValues(value(left), value(right)) * sign);
}
