export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** DB row (snake_case) -> API object (camelCase). Shallow; SQLite rows are flat. */
export function camelRow<T extends Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

export function camelRows<T extends Record<string, unknown>>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => camelRow<T>(r));
}

export function snakeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[toSnake(k)] = v;
  return out;
}

/** SQLite has no booleans: 0/1 <-> false/true. Always use these. */
export const toBool = (v: unknown): boolean => v === 1 || v === true;
export const fromBool = (v: boolean | undefined | null): number => (v ? 1 : 0);
