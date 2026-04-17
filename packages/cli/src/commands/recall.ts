import type {
  CueFeature,
  Intent,
  StateVector,
  FeatureFamily,
} from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';
import { formatRecallResult } from '../formatters/recall.js';

interface RecallOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

const VALID_INTENTS: readonly Intent[] = ['reuse', 'explain', 'decide', 'browse', 'verify'];

/**
 * Reconstructive Recall surface (v4 §6). Runs the Layer A kernel
 * — pattern completion + full anti-interference + deterministic
 * synthesis — and emits evidence + artifact.
 *
 * Flags map onto the StateVector so callers can anchor recall to
 * "this project / this repo / this task mode" without having to
 * pre-compute cue bundles.
 */
export async function run(options: RecallOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();
  const query = requireOption(args, '--query', 'query');

  const intentRaw = (optionalOption(args, '--intent') ?? 'browse') as Intent;
  if (!VALID_INTENTS.includes(intentRaw)) {
    outputError(
      `Invalid intent: ${intentRaw}. Must be one of ${VALID_INTENTS.join(', ')}.`,
      format,
    );
    process.exitCode = 1;
    return;
  }
  const intent = intentRaw;

  const maxRaw = optionalOption(args, '--max');
  const maxEvidence = maxRaw ? parseInt(maxRaw, 10) : 5;
  if (maxRaw && (isNaN(maxEvidence) || maxEvidence < 1)) {
    outputError('Invalid --max value', format);
    process.exitCode = 1;
    return;
  }

  // Context anchors from CLI flags.
  const stateVector: StateVector = {};
  const project = optionalOption(args, '--project');
  const repo = optionalOption(args, '--repo');
  const language = optionalOption(args, '--language');
  const framework = optionalOption(args, '--framework');
  const taskMode = optionalOption(args, '--task-mode');
  const actor = optionalOption(args, '--actor');
  const conversationTopic = optionalOption(args, '--topic');

  if (project) (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).project = project;
  if (repo) (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).repo = repo;
  if (language) (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).language = language;
  if (framework) (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).framework = framework;
  if (taskMode)
    (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).taskMode = taskMode as StateVector['taskMode'];
  if (actor) (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).actor = actor;
  if (conversationTopic)
    (stateVector as { -readonly [K in keyof StateVector]: StateVector[K] }).conversationTopic = conversationTopic;

  // Optional explicit cues via `--cues foo,bar` (treated as `topic`).
  const cuesRaw = optionalOption(args, '--cues');
  const cues: CueFeature[] | undefined = cuesRaw
    ? cuesRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((value) => ({ featureType: 'topic' as FeatureFamily, featureValue: value }))
    : undefined;

  const engine = await getEngine({ db, noEmbeddings });
  const result = await engine.reconstructRecall({
    userId,
    query,
    context: Object.keys(stateVector).length > 0 ? stateVector : undefined,
    cues,
    intent,
    maxEvidence,
  });

  if (format === 'text') {
    // Custom human-readable renderer (Codex Step 11 review); JSON path
    // keeps the full machine-readable structure untouched.
    process.stdout.write(formatRecallResult(result) + '\n');
  } else {
    output(result, format);
  }
}
