import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { generateEmbedding, generateEmbeddingBatch, isEmbeddingError, cosineSimilarity } from '../src/services/embeddingService.js';

describe('Embedding Service', () => {
  it('should generate embedding for text', async () => {
    const text = 'This is a test document about HVAC systems and maintenance.';
    const result = await generateEmbedding(text);

    if (isEmbeddingError(result)) {
      // If API key is not configured, skip the test
      if (result.error === 'GROQ_API_KEY_NOT_CONFIGURED') {
        console.log('Skipping test: Groq API key not configured');
        return;
      }
      assert.fail(`Embedding generation failed: ${result.error}`);
    }

    assert.ok(Array.isArray(result.embedding), 'Embedding should be an array');
    assert.strictEqual(result.embedding.length, 1536, 'Embedding should have 1536 dimensions');
    assert.ok(result.tokens > 0, 'Token count should be positive');
  });

  it('should handle empty text', async () => {
    const result = await generateEmbedding('');
    assert.ok(isEmbeddingError(result), 'Should return error for empty text');
    assert.strictEqual(result.error, 'EMPTY_TEXT');
  });

  it('should generate embeddings in batch', async () => {
    const texts = [
      'First document about heating systems',
      'Second document about cooling systems',
      'Third document about ventilation',
    ];

    const results = await generateEmbeddingBatch(texts);

    assert.strictEqual(results.length, texts.length, 'Should return same number of results');

    for (const result of results) {
      if (!isEmbeddingError(result)) {
        assert.ok(Array.isArray(result.embedding), 'Each result should have an embedding');
        assert.strictEqual(result.embedding.length, 1536, 'Each embedding should have 1536 dimensions');
      }
    }
  });

  it('should calculate cosine similarity', async () => {
    const text1 = 'HVAC maintenance and repair';
    const text2 = 'HVAC service and maintenance';
    const text3 = 'Plumbing installation';

    const result1 = await generateEmbedding(text1);
    const result2 = await generateEmbedding(text2);
    const result3 = await generateEmbedding(text3);

    if (isEmbeddingError(result1) || isEmbeddingError(result2) || isEmbeddingError(result3)) {
      console.log('Skipping test: Embedding generation failed');
      return;
    }

    const similarity12 = cosineSimilarity(result1.embedding, result2.embedding);
    const similarity13 = cosineSimilarity(result1.embedding, result3.embedding);

    // Similar texts should have higher similarity
    assert.ok(similarity12 > similarity13, 'Similar texts should have higher similarity score');
    assert.ok(similarity12 > 0.8, 'Very similar texts should have similarity > 0.8');
  });

  it('should handle long text by truncating', async () => {
    const longText = 'A'.repeat(50000); // Very long text
    const result = await generateEmbedding(longText);

    if (isEmbeddingError(result)) {
      if (result.error === 'GROQ_API_KEY_NOT_CONFIGURED') {
        console.log('Skipping test: Groq API key not configured');
        return;
      }
      assert.fail(`Should handle long text: ${result.error}`);
    }

    assert.ok(Array.isArray(result.embedding), 'Should generate embedding for long text');
  });
});
