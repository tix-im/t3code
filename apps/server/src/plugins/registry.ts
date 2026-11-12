type Intersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export function mergeContributions<const T extends readonly Readonly<Record<string, unknown>>[]>(
  ...records: T
): Intersection<T[number]> {
  const result: Record<string, unknown> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (Object.hasOwn(result, key)) throw new Error(`Duplicate plugin contribution: ${key}`);
      result[key] = value;
    }
  }
  return result as Intersection<T[number]>;
}

export function mergeMigrations<
  const T extends readonly (readonly (readonly [number, string, unknown])[])[],
>(...groups: T): Array<T[number][number]> {
  const ids = new Set<number>();
  const names = new Set<string>();
  const entries = groups.flat();
  for (const [id, name] of entries) {
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id) || names.has(name)) {
      throw new Error(`Conflicting plugin migration: ${id}_${name}`);
    }
    ids.add(id);
    names.add(name);
  }
  return entries.toSorted((a, b) => a[0] - b[0]) as Array<T[number][number]>;
}
