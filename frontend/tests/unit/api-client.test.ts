import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock API client
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async get(endpoint: string) {
    const response = await fetch(`${this.baseUrl}${endpoint}`);
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  }

  async post(endpoint: string, data: any) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  }

  async patch(endpoint: string, data: any) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  }

  async delete(endpoint: string) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Request failed');
    return response.json();
  }
}

describe('API Client', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    apiClient = new ApiClient('http://localhost:8080');
    vi.clearAllMocks();
  });

  describe('GET requests', () => {
    it('should fetch data successfully', async () => {
      const mockData = { id: 1, name: 'Test' };
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await apiClient.get('/test');
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:8080/test');
    });

    it('should handle errors', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
      } as Response);

      await expect(apiClient.get('/test')).rejects.toThrow('Request failed');
    });
  });

  describe('POST requests', () => {
    it('should send data successfully', async () => {
      const mockData = { id: 1, name: 'Test' };
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await apiClient.post('/test', { name: 'Test' });
      expect(result).toEqual(mockData);
    });
  });

  describe('PATCH requests', () => {
    it('should update data successfully', async () => {
      const mockData = { id: 1, name: 'Updated' };
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockData,
      } as Response);

      const result = await apiClient.patch('/test/1', { name: 'Updated' });
      expect(result).toEqual(mockData);
    });
  });

  describe('DELETE requests', () => {
    it('should delete data successfully', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      const result = await apiClient.delete('/test/1');
      expect(result).toEqual({ success: true });
    });
  });
});
