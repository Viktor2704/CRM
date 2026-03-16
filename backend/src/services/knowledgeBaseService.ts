import { randomUUID } from 'node:crypto';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { generateEmbedding, generateEmbeddingBatch, isEmbeddingError } from './embeddingService.js';
// @ts-ignore - pdf-parse has module resolution issues
// @ts-ignore
// DISABLED: import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const CHUNK_SIZE = 500; // tokens per chunk (approximate)
const CHUNK_OVERLAP = 50; // overlap between chunks

export type KnowledgeBaseDocument = {
  id: string;
  title: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_key: string;
  content: string;
  metadata: Record<string, any>;
  uploaded_by_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

export type KnowledgeBaseChunk = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  embedding: number[] | null;
  metadata: Record<string, any>;
  created_at: Date;
};

export type SearchResult = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  similarity: number;
};

/**
 * Extract text content from file buffer based on file type
 */
export async function extractTextFromFile(
  buffer: Buffer,
  fileType: string
): Promise<string> {
  try {
    if (fileType === 'pdf') {
      // PDF parsing is disabled due to module resolution issues
      logger.warn('PDF parsing is currently disabled', { fileType });
      throw new Error('PDF parsing is not available');
    }

    if (fileType === 'docx' || fileType === 'doc') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (fileType === 'txt' || fileType === 'md') {
      return buffer.toString('utf-8');
    }

    throw new Error(`Unsupported file type: ${fileType}`);
  } catch (error) {
    logger.error('Failed to extract text from file', {
      fileType,
      error: serializeError(error),
    });
    throw error;
  }
}

/**
 * Chunk text into smaller pieces with overlap
 */
export function chunkText(text: string, chunkSize: number = CHUNK_SIZE, overlap: number = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk);
    i += chunkSize - overlap;
  }

  return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a new knowledge base document
 */
export async function createDocument(params: {
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  content: string;
  metadata?: Record<string, any>;
  uploadedById?: string;
}): Promise<KnowledgeBaseDocument> {
  const id = randomUUID();
  const now = new Date();

  const result = await dbQuery(
    `insert into knowledge_base_documents (
      id, title, file_name, file_type, file_size, storage_key, content, metadata, uploaded_by_id, created_at, updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    returning *`,
    [
      id,
      params.title,
      params.fileName,
      params.fileType,
      params.fileSize,
      params.storageKey,
      params.content,
      JSON.stringify(params.metadata || {}),
      params.uploadedById || null,
      now,
      now,
    ]
  );

  return result.rows[0];
}

/**
 * Create chunks for a document with embeddings
 */
export async function createChunksForDocument(
  documentId: string,
  content: string
): Promise<{ success: number; failed: number }> {
  const chunks = chunkText(content);
  let success = 0;
  let failed = 0;

  logger.info('Creating chunks for document', {
    documentId,
    totalChunks: chunks.length,
  });

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const tokenCount = estimateTokenCount(chunkContent);

    try {
      // Generate embedding for chunk
      const embeddingResult = await generateEmbedding(chunkContent);

      let embedding: number[] | null = null;
      if (!isEmbeddingError(embeddingResult)) {
        embedding = embeddingResult.embedding;
      } else {
        logger.warn('Failed to generate embedding for chunk', {
          documentId,
          chunkIndex: i,
          error: embeddingResult.error,
        });
      }

      // Store chunk with embedding
      await dbQuery(
        `insert into knowledge_base_chunks (
          id, document_id, chunk_index, content, token_count, embedding, metadata, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          documentId,
          i,
          chunkContent,
          tokenCount,
          embedding ? JSON.stringify(embedding) : null,
          JSON.stringify({}),
          new Date(),
        ]
      );

      success++;

      // Small delay to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      logger.error('Failed to create chunk', {
        documentId,
        chunkIndex: i,
        error: serializeError(error),
      });
      failed++;
    }
  }

  logger.info('Chunks created for document', {
    documentId,
    success,
    failed,
  });

  return { success, failed };
}

/**
 * Ingest a document: create document record and generate chunks with embeddings
 */
export async function ingestDocument(params: {
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storageKey: string;
  fileBuffer: Buffer;
  metadata?: Record<string, any>;
  uploadedById?: string;
}): Promise<{ document: KnowledgeBaseDocument; chunks: { success: number; failed: number } }> {
  // Extract text from file
  const content = await extractTextFromFile(params.fileBuffer, params.fileType);

  // Create document record
  const document = await createDocument({
    title: params.title,
    fileName: params.fileName,
    fileType: params.fileType,
    fileSize: params.fileSize,
    storageKey: params.storageKey,
    content,
    metadata: params.metadata,
    uploadedById: params.uploadedById,
  });

  // Create chunks with embeddings
  const chunks = await createChunksForDocument(document.id, content);

  return { document, chunks };
}

/**
 * Search for similar chunks using vector similarity
 */
export async function searchSimilarChunks(
  query: string,
  options: {
    matchThreshold?: number;
    matchCount?: number;
  } = {}
): Promise<SearchResult[]> {
  const { matchThreshold = 0.7, matchCount = 5 } = options;

  // Generate embedding for query
  const embeddingResult = await generateEmbedding(query);

  if (isEmbeddingError(embeddingResult)) {
    logger.error('Failed to generate embedding for search query', {
      error: embeddingResult.error,
    });
    return [];
  }

  // Search using pgvector
  const result = await dbQuery(
    `select * from search_similar_chunks($1::vector, $2, $3)`,
    [JSON.stringify(embeddingResult.embedding), matchThreshold, matchCount]
  );

  return result.rows;
}

/**
 * Get document by ID
 */
export async function getDocumentById(id: string): Promise<KnowledgeBaseDocument | null> {
  const result = await dbQuery(
    `select * from knowledge_base_documents where id = $1 and deleted_at is null`,
    [id]
  );

  return result.rows[0] || null;
}

/**
 * List all documents
 */
export async function listDocuments(params: {
  limit?: number;
  offset?: number;
  uploadedById?: string;
}): Promise<{ documents: KnowledgeBaseDocument[]; total: number }> {
  const { limit = 50, offset = 0, uploadedById } = params;

  let whereClause = 'where deleted_at is null';
  const queryParams: any[] = [];

  if (uploadedById) {
    queryParams.push(uploadedById);
    whereClause += ` and uploaded_by_id = $${queryParams.length}`;
  }

  const countResult = await dbQuery(
    `select count(*) as total from knowledge_base_documents ${whereClause}`,
    queryParams
  );

  queryParams.push(limit, offset);
  const result = await dbQuery(
    `select * from knowledge_base_documents ${whereClause}
     order by created_at desc
     limit $${queryParams.length - 1} offset $${queryParams.length}`,
    queryParams
  );

  return {
    documents: result.rows,
    total: parseInt(countResult.rows[0].total, 10),
  };
}

/**
 * Delete document (soft delete)
 */
export async function deleteDocument(id: string): Promise<boolean> {
  const result = await dbQuery(
    `update knowledge_base_documents set deleted_at = now() where id = $1 and deleted_at is null`,
    [id]
  );

  return result.rowCount > 0;
}

/**
 * Get chunks for a document
 */
export async function getDocumentChunks(documentId: string): Promise<KnowledgeBaseChunk[]> {
  const result = await dbQuery(
    `select * from knowledge_base_chunks where document_id = $1 order by chunk_index`,
    [documentId]
  );

  return result.rows;
}

/**
 * Get document statistics
 */
export async function getDocumentStats(documentId: string): Promise<{
  totalChunks: number;
  chunksWithEmbeddings: number;
  totalTokens: number;
}> {
  const result = await dbQuery(
    `select
      count(*) as total_chunks,
      count(embedding) as chunks_with_embeddings,
      sum(token_count) as total_tokens
    from knowledge_base_chunks
    where document_id = $1`,
    [documentId]
  );

  const row = result.rows[0];
  return {
    totalChunks: parseInt(row.total_chunks, 10),
    chunksWithEmbeddings: parseInt(row.chunks_with_embeddings, 10),
    totalTokens: parseInt(row.total_tokens, 10) || 0,
  };
}
