// Small string helpers for "did you mean" matching. No dependencies.

/** Lowercase, strip accents (Ässät -> assat, Päivärinta -> paivarinta), collapse spaces. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0 = identical, 1 = nothing in common. */
export function distance(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  return levenshtein(x, y) / Math.max(x.length, y.length, 1);
}

/** Candidates sorted by distance, keeping only those under `max`. */
export function closest<T>(input: string, items: T[], keys: (item: T) => string[], max = 0.45): { item: T; d: number }[] {
  return items
    .map((item) => ({ item, d: Math.min(...keys(item).map((k) => distance(input, k))) }))
    .filter((x) => x.d <= max)
    .sort((a, b) => a.d - b.d);
}
