import { z } from 'zod';

const uploadDocumentSchema = z.object({
  title: z.string().min(1).max(500),
  fileName: z.string().min(1),
  fileType: z.enum(['pdf', 'txt', 'md', 'doc', 'docx']),
  dataUrl: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
});

const searchQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  matchThreshold: z.number().min(0).max(1).optional(),
  matchCount: z.number().int().min(1).max(20).optional(),
});

export const registerKnowledgeBaseRoutes = async (params: any) => {
  const {
    app,
    requireAuth,
    asyncHandler,
    ApiError,
    parseDataUrlPayload,
    storeFile,
  } = params;

  const knowledgeBaseService = await import('../services/knowledgeBaseService.js');
  const {
    ingestDocument,
    searchSimilarChunks,
    getDocumentById,
    listDocuments,
    deleteDocument,
    getDocumentChunks,
    getDocumentStats,
  } = knowledgeBaseService;

  // Upload and ingest document
  app.post('/knowledge-base/documents', requireAuth, asyncHandler(async (request: any, response: any) => {
    const body = uploadDocumentSchema.parse(request.body);

    // Parse data URL
    const parsed = parseDataUrlPayload({
      fileName: body.fileName,
      dataUrl: body.dataUrl,
    });

    // Store file
    const stored = await storeFile({
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      content: parsed.content,
    });

    // Ingest document (extract text, chunk, generate embeddings)
    const result = await ingestDocument({
      title: body.title,
      fileName: body.fileName,
      fileType: body.fileType,
      fileSize: parsed.content.length,
      storageKey: stored.storageKey,
      fileBuffer: parsed.content,
      metadata: body.metadata,
      uploadedById: request.authUser?.id,
    });

    response.status(201).json({
      document: {
        id: result.document.id,
        title: result.document.title,
        fileName: result.document.file_name,
        fileType: result.document.file_type,
        fileSize: result.document.file_size,
        createdAt: result.document.created_at,
      },
      chunks: result.chunks,
    });
  }));

  // List documents
  app.get('/knowledge-base/documents', requireAuth, asyncHandler(async (request: any, response: any) => {
    const limit = parseInt(String(request.query.limit || '50'), 10);
    const offset = parseInt(String(request.query.offset || '0'), 10);
    const uploadedById = request.query.uploadedById as string | undefined;

    const result = await listDocuments({
      limit: Math.min(limit, 100),
      offset: Math.max(offset, 0),
      uploadedById,
    });

    response.json({
      documents: result.documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        fileName: doc.file_name,
        fileType: doc.file_type,
        fileSize: doc.file_size,
        uploadedById: doc.uploaded_by_id,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
      })),
      total: result.total,
      limit,
      offset,
    });
  }));

  // Get document by ID
  app.get('/knowledge-base/documents/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;

    const document = await getDocumentById(id);
    if (!document) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    const stats = await getDocumentStats(id);

    response.json({
      id: document.id,
      title: document.title,
      fileName: document.file_name,
      fileType: document.file_type,
      fileSize: document.file_size,
      content: document.content,
      metadata: document.metadata,
      uploadedById: document.uploaded_by_id,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
      stats,
    });
  }));

  // Delete document
  app.delete('/knowledge-base/documents/:id', requireAuth, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;

    const deleted = await deleteDocument(id);
    if (!deleted) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    response.json({ success: true });
  }));

  // Get document chunks
  app.get('/knowledge-base/documents/:id/chunks', requireAuth, asyncHandler(async (request: any, response: any) => {
    const { id } = request.params;

    const document = await getDocumentById(id);
    if (!document) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    }

    const chunks = await getDocumentChunks(id);

    response.json({
      documentId: id,
      chunks: chunks.map(chunk => ({
        id: chunk.id,
        chunkIndex: chunk.chunk_index,
        content: chunk.content,
        tokenCount: chunk.token_count,
        hasEmbedding: !!chunk.embedding,
        createdAt: chunk.created_at,
      })),
    });
  }));

  // Semantic search
  app.post('/knowledge-base/search', requireAuth, asyncHandler(async (request: any, response: any) => {
    const body = searchQuerySchema.parse(request.body);

    const results = await searchSimilarChunks(body.query, {
      matchThreshold: body.matchThreshold || 0.7,
      matchCount: body.matchCount || 5,
    });

    response.json({
      query: body.query,
      results: results.map(result => ({
        chunkId: result.chunk_id,
        documentId: result.document_id,
        documentTitle: result.document_title,
        content: result.content,
        similarity: result.similarity,
      })),
      total: results.length,
    });
  }));

  // Get relevant documents for service request (RAG integration)
  app.post('/knowledge-base/suggest-for-request', requireAuth, asyncHandler(async (request: any, response: any) => {
    const { description, title } = request.body;

    if (!description && !title) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'description or title is required');
    }

    const query = [title, description].filter(Boolean).join(' ').slice(0, 2000);

    const results = await searchSimilarChunks(query, {
      matchThreshold: 0.6,
      matchCount: 3,
    });

    // Group by document
    const documentMap = new Map();
    for (const result of results) {
      if (!documentMap.has(result.document_id)) {
        documentMap.set(result.document_id, {
          documentId: result.document_id,
          documentTitle: result.document_title,
          maxSimilarity: result.similarity,
          chunks: [],
        });
      }
      const doc = documentMap.get(result.document_id);
      doc.chunks.push({
        content: result.content,
        similarity: result.similarity,
      });
      doc.maxSimilarity = Math.max(doc.maxSimilarity, result.similarity);
    }

    const suggestions = Array.from(documentMap.values())
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity);

    response.json({
      suggestions,
      total: suggestions.length,
    });
  }));
};
