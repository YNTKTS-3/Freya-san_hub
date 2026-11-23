import { ParsedCommandInput } from './types';

export const DEFAULT_PREFIXES: readonly string[] = [
  '.',
  ',',
  '?',
  '!',
  '*',
  '@',
  '#',
  '$',
  '&',
  '/',
];

/**
 * Single unified parser supporting all active prefixes (10 defaults + owner extras).
 * Supports both `.menu` and `. menu` (with space after prefix).
 * Never treats mid-sentence punctuation as a command prefix.
 * Preserves original argument casing and content.
 */
export function parseCommandInput(
  rawText: string,
  activePrefixes: readonly string[] = DEFAULT_PREFIXES,
  options: {
    mentions?: string[];
    hasReply?: boolean;
    hasMedia?: boolean;
  } = {},
): ParsedCommandInput {
  const baseResult: ParsedCommandInput = {
    isCommand: false,
    prefix: null,
    hadSpaceAfterPrefix: false,
    commandName: '',
    rawArgs: '',
    args: [],
    mentions: options.mentions ?? [],
    hasReply: Boolean(options.hasReply),
    hasMedia: Boolean(options.hasMedia),
  };

  if (!rawText || typeof rawText !== 'string') {
    return baseResult;
  }

  // Only trim leading whitespace to detect command at start of message,
  // never collapsing or mutating inner argument text.
  const leadingTrimmed = rawText.replace(/^\s+/, '');
  if (!leadingTrimmed) {
    return baseResult;
  }

  // Sort prefixes longest-first so multi-char custom prefixes match accurately
  const sortedPrefixes = [...activePrefixes]
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);

  let matchedPrefix: string | null = null;
  for (const prefix of sortedPrefixes) {
    if (leadingTrimmed.startsWith(prefix)) {
      matchedPrefix = prefix;
      break;
    }
  }

  if (!matchedPrefix) {
    return baseResult;
  }

  const afterPrefix = leadingTrimmed.slice(matchedPrefix.length);
  if (!afterPrefix) {
    return baseResult;
  }

  const hadSpaceAfterPrefix = /^\s+/.test(afterPrefix);
  const afterSpace = afterPrefix.replace(/^\s+/, '');
  if (!afterSpace) {
    return baseResult;
  }

  // Extract command token (alphanumeric, underscore, hyphen)
  const tokenMatch = afterSpace.match(/^([A-Za-z0-9_-]+)(?:([\s\S]*))?$/);
  if (!tokenMatch) {
    return baseResult;
  }

  const commandToken = tokenMatch[1].toLowerCase();
  const remainder = tokenMatch[2] ?? '';

  // Ensure token was delimited by end-of-string or whitespace (prevents `.123` or `..foo` false positives unless valid)
  if (remainder.length > 0 && !/^\s/.test(remainder)) {
    return baseResult;
  }

  const rawArgs = remainder.replace(/^[ \t]+/, '').replace(/\s+$/, '');
  const args = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];

  // Extract @628... mentions inside text if not passed explicitly
  const inlineMentions = Array.from(
    new Set([
      ...(options.mentions ?? []),
      ...Array.from(rawText.matchAll(/@(\d{6,16})/g)).map((m) => m[1]),
    ]),
  );

  return {
    isCommand: true,
    prefix: matchedPrefix,
    hadSpaceAfterPrefix,
    commandName: commandToken,
    rawArgs,
    args,
    mentions: inlineMentions,
    hasReply: Boolean(options.hasReply),
    hasMedia: Boolean(options.hasMedia),
  };
}
