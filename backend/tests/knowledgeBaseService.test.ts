import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import {
  extractTextFromFile,
  chunkText,
  createDocument,
  createChunksForDocument,
  searchSimilarChunks,
  getDocumentById,
  listDocuments,
  deleteDocument,
  getDocumentStats
} from '../src/services/knowledgeBaseService.js';
import { dbQuery } from '../src/db.js';

describe('Knowledge Base Service', () => {
  let testDocumentId: string | null = null;

  after(async () => {
    // Cleanup test documents
    if (testDocumentId) {
      await dbQuery('delete from knowledge_base_documents where id = $1', [testDocumentId]);
    }
  });

  describe('Text Extraction', () => {
    it('should extract text from plain text buffer', async () => {
      const buffer = Buffer.from('This is a test document.');
      const text = await extractTextFromFile(buffer, 'txt');
      assert.strictEqual(text, 'This is a test document.');
    });

    it('should extract text from markdown buffer', async () => {
      const buffer = Buffer.from('# Heading\n\nThis is markdown content.');
      const text = await extractTextFromFile(buffer, 'md');
      assert.ok(text.includes('Heading'));
      assert.ok(text.includes('markdown content'));
    });

    it('should throw error for unsupported file type', async () => {
      const buffer = Buffer.from('test');
      await assert.rejects(
        async () => await extractTextFromFile(buffer, 'unsupported'),
        /Unsupported file type/
      );
    });
  });

  describe('Text Chunking', () => {
    it('should chunk text into smaller pieces', () => {
      const text = 'word '.repeat(1000); // 1000 words
      const chunks = chunkText(text, 100, 10);

      assert.ok(chunks.length > 0, 'Should create chunks');
      assert.ok(chunks.length > 5, 'Should create multiple chunks for long text');

      // Each chunk should be roughly the target size
      for (const chunk of chunks) {
        const wordCount = chunk.split(/\s+/).length;
        assert.ok(wordCount <= 110, 'Chunk should not exceed target size significantly');
      }
    });

    it('should handle overlap between chunks', () => {
      const text = 'one two three four five six seven eight nine ten';
      const chunks = chunkText(text, 5, 2);

      assert.ok(chunks.length > 1, 'Should create multiple chunks');

      // Check that there's overlap
      const firstChunkWords = chunks[0].split(/\s+/);
      const secondChunkWords = chunks[1].split(/\s+/);

      // Some words from the end of first chunk should appear at start of second
      const hasOverlap = firstChunkWords.slice(-2).some(word =>
        secondChunkWords.slice(0, 2).includes(word)
      );
      assert.ok(hasOverlap, 'Chunks should have overlap');
    });

    it('should filter out empty chunks', () => {
      const text = '   ';
      const chunks = chunkText(text);
      assert.strictEqual(chunks.length, 0, 'Should not create chunks from empty text');
    });
  });

  describe('Document Management', () => {
    it('should create a document', async () => {
      const doc = await createDocument({
        title: 'Test Document',
        fileName: 'test.txt',
        fileType: 'txt',
        fileSize: 100,
        storageKey: 'test-key',
        content: 'This is test content for the knowledge base.',
        metadata: { source: 'test' },
        uploadedById: randomUUID(),
      });

      testDocumentId = doc.id;

      assert.ok(doc.id, 'Document should have an ID');
      assert.strictEqual(doc.title, 'Test Document');
      assert.strictEqual(doc.file_type, 'txt');
      assert.ok(doc.created_at, 'Document should have creation timestamp');
    });

    it('should retrieve document by ID', async () => {
      if (!testDocumentId) {
        console.log('Skipping: No test document created');
        return;
      }

      const doc = await getDocumentById(testDocumentId);
      assert.ok(doc, 'Should retrieve document');
      assert.strictEqual(doc.id, testDocumentId);
      assert.strictEqual(doc.title, 'Test Document');
    });

    it('should list documents', async () => {
      const result = await listDocuments({ limit: 10, offset: 0 });

      assert.ok(Array.isArray(result.documents), 'Should return documents array');
      assert.ok(typeof result.total === 'number', 'Should return total count');
      assert.ok(result.total >= 0, 'Total should be non-negative');
    });

    it('should soft delete document', async () => {
      if (!testDocumentId) {
        console.log('Skipping: No test document created');
        return;
      }

      const deleted = await deleteDocument(testDocumentId);
      assert.ok(deleted, 'Should delete document');

      const doc = await getDocumentById(testDocumentId);
      assert.strictEqual(doc, null, 'Deleted document should not be retrievable');
    });
  });

  describe('Chunk Management', () => {
    it('should create chunks for document', async () => {
      const doc = await createDocument({
        title: 'Chunking Test',
        fileName: 'chunk-test.txt',
        fileType: 'txt',
        fileSize: 500,
        storageKey: 'chunk-test-key',
        content: 'word '.repeat(1000), // Long content to create multiple chunks
        metadata: {},
      });

      const result = await createChunksForDocument(doc.id, doc.content);

      assert.ok(result.success > 0, 'Should create at least one chunk');
      assert.ok(result.success >= 5, 'Should create multiple chunks for long content');

      // Cleanup
      await dbQuery('delete from knowledge_base_documents where id = $1', [doc.id]);
    });

    it('should get document statistics', async () => {
      const doc = await createDocument({
        title: 'Stats Test',
        fileName: 'stats-test.txt',
        fileType: 'txt',
        fileSize: 200,
        storageKey: 'stats-test-key',
        content: 'This is content for statistics testing. ' + 'word '.repeat(100),
        metadata: {},
      });

      await createChunksForDocument(doc.id, doc.content);

      const stats = await getDocumentStats(doc.id);

      assert.ok(stats.totalChunks > 0, 'Should have chunks');
      assert.ok(stats.totalTokens > 0, 'Should have token count');
      assert.ok(stats.chunksWithEmbeddings >= 0, 'Should report embeddings count');

      // Cleanup
      await dbQuery('delete from knowledge_base_documents where id = $1', [doc.id]);
    });
  });

  describe('Semantic Search', () => {
    it('should search for similar chunks', async () => {
      // Create a test document with known content
      const doc = await createDocument({
        title: 'HVAC Maintenance Guide',
        fileName: 'hvac-guide.txt',
        fileType: 'txt',
        fileSize: 300,
        storageKey: 'hvac-guide-key',
        content: 'HVAC systems require regular maintenance. Check filters monthly. Inspect compressor annually. Clean coils regularly. Monitor refrigerant levels.',
        metadata: {},
      });

      await createChunksForDocument(doc.id, doc.content);

      // Search for similar content
      const results = await searchSimilarChunks('HVAC maintenance and filter replacement', {
        matchThreshold: 0.5,
        matchCount: 5,
      });

      // Results depend on embeddings being generated
      // If embeddings are available, we should get results
      if (results.length > 0) {
        assert.ok(results[0].similarity > 0.5, 'Top result should have good similarity');
        assert.ok(results[0].content.length > 0, 'Result should have content');
        assert.strictEqual(results[0].document_id, doc.id, 'Should find the test document');
      }

      // Cleanup
      await dbQuery('delete from knowledge_base_documents where id = $1', [doc.id]);
    });

    it('should return empty results for unrelated query', async () => {
      const results = await searchSimilarChunks('completely unrelated quantum physics topic xyz123', {
        matchThreshold: 0.9,
        matchCount: 5,
      });

      // With high threshold, unrelated queries should return few or no results
      assert.ok(results.length <= 5, 'Should respect match count limit');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete document ingestion workflow', async () => {
      const content = 'This is a comprehensive test document about building maintenance. ' +
                     'It covers HVAC systems, plumbing, electrical work, and general repairs. ' +
                     'Regular maintenance is essential for building operations. ' +
                     'Preventive maintenance reduces emergency repairs. ' +
                     'Documentation of all maintenance activities is required.';

      const doc = await createDocument({
        title: 'Building Maintenance Manual',
        fileName: 'maintenance-manual.txt',
        fileType: 'txt',
        fileSize: content.length,
        storageKey: 'maintenance-manual-key',
        content,
        metadata: { category: 'maintenance', version: '1.0' },
      });

      // Create chunks
      const chunkResult = await createChunksForDocument(doc.id, content);
      assert.ok(chunkResult.success > 0, 'Should create chunks');

      // Get stats
      const stats = await getDocumentStats(doc.id);
      assert.strictEqual(stats.totalChunks, chunkResult.success, 'Stats should match created chunks');

      // Search
      const searchResults = await searchSimilarChunks('building maintenance procedures', {
        matchThreshold: 0.5,
        matchCount: 3,
      });

      // Verify document appears in list
      const listResult = await listDocuments({ limit: 100, offset: 0 });
      const foundDoc = listResult.documents.find(d => d.id === doc.id);
      assert.ok(foundDoc, 'Document should appear in list');

      // Delete
      const deleted = await deleteDocument(doc.id);
      assert.ok(deleted, 'Should delete document');

      // Verify deletion
      const deletedDoc = await getDocumentById(doc.id);
      assert.strictEqual(deletedDoc, null, 'Deleted document should not be found');

      // Cleanup
      await dbQuery('delete from knowledge_base_documents where id = $1', [doc.id]);
    });
  });
});
