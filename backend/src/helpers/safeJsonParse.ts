import { logger } from '../logger.js';

/**
 * Safely extract and parse JSON from LLM response text.
 *
 * Tries, in order:
 *  1. Direct JSON.parse of the whole string
 *  2. Extract from markdown code blocks (```json ... ``` or ``` ... ```)
 *  3. Find the outermost JSON object ({ ... }) or array ([ ... ])
 *  4. Retry after stripping trailing commas before } or ]
 *
 * Returns `fallback` (and logs a warning) if every strategy fails.
 */
export function extractJson<T>(text: string, fallback: T): T {
  if (!text || typeof text !== 'string') {
    logger.warn('extractJson called with empty or non-string input');
    return fallback;
  }

  const trimmed = text.trim();

  // 1. Direct parse
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue
  }

  // 2. Markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // continue – will still try the extracted block with trailing-comma fix below
    }
  }

  // 3. Find outermost JSON object or array
  const candidates: string[] = [];

  // Try object
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  // Try array
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    // Try as-is
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue
    }

    // 4. Strip trailing commas before } or ] and retry
    const cleaned = candidate.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // continue
    }
  }

  // Also try the code-block content with trailing-comma fix if we had one
  if (codeBlockMatch) {
    const cleaned = codeBlockMatch[1].trim().replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // continue
    }
  }

  logger.warn('extractJson: all parsing strategies failed, returning fallback', {
    inputLength: text.length,
    inputPreview: text.slice(0, 200),
  });
  return fallback;
}
