// server/domain/common/rowmap.ts — thin wrapper around T1's frozen server/lib/rowmap.ts.
//
// camelRow<T>/camelRows<T> are declared `T extends Record<string, unknown>`. Every entity
// interface in the frozen shared/types.ts is declared with `interface`, which (unlike a `type`
// alias) TypeScript does not treat as structurally satisfying `Record<string, unknown>` — every
// call site that supplies e.g. `camelRow<Property>(row)` fails to typecheck with "Index
// signature for type 'string' is missing in type 'Property'". This is a pre-existing property of
// the two frozen files (shared/types.ts's `interface` declarations + server/lib/rowmap.ts's
// generic constraint) and neither may be edited here. mapRow/mapRows sidestep it by calling the
// frozen function without an explicit type argument (so it resolves to its constraint,
// `Record<string, unknown>`, instead of failing) and then asserting the already-known shape.
import { camelRow, camelRows } from "../../lib/rowmap.js";

export function mapRow<T>(row: Record<string, unknown>): T {
  return camelRow(row) as unknown as T;
}

export function mapRows<T>(rows: Record<string, unknown>[]): T[] {
  return camelRows(rows) as unknown as T[];
}
