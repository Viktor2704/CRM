import { appConfig } from '../config.js';
import { logger, serializeError } from '../logger.js';

const GROQ_EMBEDDING_URL = 'https://api.groq.com/openai/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small'; // OpenAI compatible model
const EMBEDDING_DIMENSION = 1536;

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  tokens: number;
};

export type EmbeddingError = {
  error: string;
  details?: string;
};

/**
 * Generate embeddings using Groq API (OpenAI compatible endpoint)
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult | EmbeddingError> {
  const apiKey = String(appConfig.groqApiKey || '').trim();

  if (!apiKey) {
    logger.warn('Groq API key not configured for embeddings');
    return { error: 'GROQ_API_KEY_NOT_CONFIGURED' };
  }

  if (!text || text.trim().length === 0) {
    return { error: 'EMPTY_TEXT' };
  }

  // Truncate text if too long (max ~8000 tokens for most embedding models)
  const truncatedText = text.slice(0, 32000);

  try {
    const startTime = Date.now();

    const response = await fetch(GROQ_EMBEDDING_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncatedText,
      }),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Groq embedding API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        durationMs,
      });

      return {
        error: 'GROQ_API_ERROR',
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      logger.error('Invalid embedding response format', { data });
      return { error: 'INVALID_RESPONSE_FORMAT' };
    }

    const embedding = data.data[0].embedding;

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
      logger.error('Invalid embedding dimension', {
        expected: EMBEDDING_DIMENSION,
        actual: embedding?.length,
      });
      return { error: 'INVALID_EMBEDDING_DIMENSION' };
    }

    logger.info('Embedding generated successfully', {
      model: data.model || EMBEDDING_MODEL,
      tokens: data.usage?.total_tokens || 0,
      durationMs,
    });

    return {
      embedding,
      model: data.model || EMBEDDING_MODEL,
      tokens: data.usage?.total_tokens || 0,
    };
  } catch (error) {
    logger.error('Failed to generate embedding', {
      error: serializeError(error),
    });

    return {
      error: 'EMBEDDING_GENERATION_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddingBatch(texts: string[]): Promise<(EmbeddingResult | EmbeddingError)[]> {
  const results: (EmbeddingResult | EmbeddingError)[] = [];

  // Process sequentially to avoid rate limits
  for (const text of texts) {
    const result = await generateEmbedding(text);
    results.push(result);

    // Small delay between requests to avoid rate limiting
    if (texts.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

/**
 * Check if embedding result is an error
 */
export function isEmbeddingError(result: EmbeddingResult | EmbeddingError): result is EmbeddingError {
  return 'error' in result;
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
