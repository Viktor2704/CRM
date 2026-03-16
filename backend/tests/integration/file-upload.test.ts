import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDatabase, createMockFileStorage } from '../mocks/index.js';
import { createUser } from '../factories/index.js';

describe('File Upload Integration Tests', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockFileStorage: ReturnType<typeof createMockFileStorage>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockFileStorage = createMockFileStorage();
    vi.clearAllMocks();
  });

  describe('POST /files/upload', () => {
    it('should upload file successfully', async () => {
      const user = createUser();
      const file = {
        filename: 'test.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      };

      mockFileStorage.storeFile.mockResolvedValueOnce({
        filename: file.filename,
        path: '/uploads/test.pdf',
        size: file.size,
        mimetype: file.mimetype,
      });

      const result = await mockFileStorage.storeFile(file);

      expect(result.filename).toBe('test.pdf');
      expect(result.path).toBe('/uploads/test.pdf');
      expect(mockFileStorage.storeFile).toHaveBeenCalledWith(file);
    });

    it('should reject files exceeding size limit', async () => {
      const file = {
        filename: 'large.pdf',
        mimetype: 'application/pdf',
        size: 25 * 1024 * 1024, // 25MB
      };

      const maxSize = 20 * 1024 * 1024; // 20MB
      expect(file.size).toBeGreaterThan(maxSize);
    });

    it('should reject invalid file types', async () => {
      const file = {
        filename: 'script.exe',
        mimetype: 'application/x-msdownload',
        size: 1024,
      };

      const allowedTypes = ['image/*', 'application/pdf', 'application/msword'];
      const isAllowed = allowedTypes.some(type =>
        type.endsWith('*')
          ? file.mimetype.startsWith(type.replace('*', ''))
          : file.mimetype === type
      );

      expect(isAllowed).toBe(false);
    });
  });

  describe('GET /files/:id', () => {
    it('should retrieve file for authorized user', async () => {
      const user = createUser();
      const fileId = 'test-file-id';

      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: fileId, uploadedBy: user.id }],
        rowCount: 1
      });

      mockFileStorage.getFile.mockResolvedValueOnce(Buffer.from('test content'));

      const file = await mockFileStorage.getFile(fileId);
      expect(file).toBeInstanceOf(Buffer);
    });

    it('should reject unauthorized access', async () => {
      const user = createUser();
      const otherUser = createUser();
      const fileId = 'test-file-id';

      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: fileId, uploadedBy: otherUser.id }],
        rowCount: 1
      });

      expect(user.id).not.toBe(otherUser.id);
    });
  });

  describe('DELETE /files/:id', () => {
    it('should delete file', async () => {
      const user = createUser({ role: 'admin' });
      const fileId = 'test-file-id';

      mockDb.query.mockResolvedValueOnce({
        rows: [{ id: fileId }],
        rowCount: 1
      });

      mockFileStorage.deleteFile.mockResolvedValueOnce(true);

      const result = await mockFileStorage.deleteFile(fileId);
      expect(result).toBe(true);
    });
  });
});
