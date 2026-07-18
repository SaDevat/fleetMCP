export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
}

function scoreSubsequence(query: string, candidate: string): number {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase();

  if (q.length === 0) return 1;
  if (c === q) return 1;

  let qIndex = 0;
  let lastMatch = -1;
  let score = 0;

  for (let i = 0; i < c.length && qIndex < q.length; i++) {
    if (c[i] !== q[qIndex]) continue;

    // Prefer contiguous runs and early matches.
    const gap = lastMatch === -1 ? i : i - lastMatch - 1;
    const gapPenalty = gap === 0 ? 1 : 1 / (1 + gap * 1.5);
    const positionBonus = 1 / (1 + i * 0.05);
    score += gapPenalty * positionBonus;

    lastMatch = i;
    qIndex += 1;
  }

  if (qIndex < q.length) return 0;

  // Normalize to [0, 1], then slightly favor shorter candidates.
  const normalized = score / q.length;
  const lengthPenalty = q.length / Math.max(c.length, q.length);
  return Math.max(0, Math.min(1, normalized * lengthPenalty));
}

export function fuzzyRank<T>(
  items: T[],
  query: string,
  getCandidate: (item: T) => string,
): FuzzyMatchResult<T>[] {
  return items
    .map((item) => ({
      item,
      score: scoreSubsequence(query, getCandidate(item)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}
