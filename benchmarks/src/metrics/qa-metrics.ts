import type { QAMetrics, CategoryMetrics } from './metric-types.js';

export interface QAResult {
  readonly predicted: string;
  readonly expected: string;
  readonly category: string;
}

/**
 * Case-insensitive, trimmed exact match comparison.
 */
export function exactMatch(predicted: string, expected: string): boolean {
  return predicted.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * Token-level F1 score. Tokens are produced by splitting on whitespace.
 * Comparison is case-insensitive. Uses bag-of-words counting for
 * proper handling of duplicate tokens.
 * Returns 0.0 if either string is empty (no tokens).
 */
export function f1Score(predicted: string, expected: string): number {
  const predTokens = tokenize(predicted);
  const expTokens = tokenize(expected);

  if (predTokens.length === 0 || expTokens.length === 0) {
    return 0.0;
  }

  const predBag = toBag(predTokens);
  const expBag = toBag(expTokens);

  let common = 0;
  for (const [token, count] of predBag.entries()) {
    const expCount = expBag.get(token) ?? 0;
    common += Math.min(count, expCount);
  }

  if (common === 0) {
    return 0.0;
  }

  const precision = common / predTokens.length;
  const recall = common / expTokens.length;

  return (2 * precision * recall) / (precision + recall);
}

/**
 * Compute QA metrics from a list of question-answer results.
 * Correctness is determined by case-insensitive, trimmed exact match.
 */
export function computeQAMetrics(results: readonly QAResult[]): QAMetrics {
  if (results.length === 0) {
    return {
      totalQuestions: 0,
      correctAnswers: 0,
      accuracy: 0,
      byCategory: {},
    };
  }

  const categoryStats = new Map<string, { total: number; correct: number }>();

  let correctAnswers = 0;

  for (const result of results) {
    const isCorrect = exactMatch(result.predicted, result.expected);
    if (isCorrect) {
      correctAnswers++;
    }

    const existing = categoryStats.get(result.category);
    if (existing) {
      categoryStats.set(result.category, {
        total: existing.total + 1,
        correct: existing.correct + (isCorrect ? 1 : 0),
      });
    } else {
      categoryStats.set(result.category, {
        total: 1,
        correct: isCorrect ? 1 : 0,
      });
    }
  }

  const byCategory: Record<string, CategoryMetrics> = {};
  for (const [category, stats] of categoryStats.entries()) {
    byCategory[category] = {
      total: stats.total,
      correct: stats.correct,
      accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
    };
  }

  return {
    totalQuestions: results.length,
    correctAnswers,
    accuracy: correctAnswers / results.length,
    byCategory,
  };
}

function tokenize(text: string): readonly string[] {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [];
  }
  return trimmed.split(/\s+/);
}

function toBag(tokens: readonly string[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const token of tokens) {
    bag.set(token, (bag.get(token) ?? 0) + 1);
  }
  return bag;
}
