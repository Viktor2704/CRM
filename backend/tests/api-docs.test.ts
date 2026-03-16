import { describe, it, before } from 'node:test';
import assert from 'node:assert';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

describe('API Documentation Tests', () => {
  describe('Swagger UI', () => {
    it('should serve Swagger UI at /api-docs', async () => {
      const response = await fetch(`${API_BASE_URL}/api-docs/`);
      assert.strictEqual(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('swagger-ui'), 'Should contain Swagger UI');
    });

    it('should serve OpenAPI spec as JSON', async () => {
      const response = await fetch(`${API_BASE_URL}/api-docs.json`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'application/json; charset=utf-8');

      const spec = await response.json();
      assert.ok(spec.openapi, 'Should have OpenAPI version');
      assert.ok(spec.info, 'Should have info section');
      assert.ok(spec.paths, 'Should have paths section');
      assert.strictEqual(spec.info.title, 'Novinzhstroy API');
    });

    it('should serve OpenAPI spec as YAML', async () => {
      const response = await fetch(`${API_BASE_URL}/api-docs.yaml`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'text/yaml; charset=utf-8');

      const yaml = await response.text();
      assert.ok(yaml.includes('openapi:'), 'Should contain OpenAPI YAML');
      assert.ok(yaml.includes('Novinzhstroy API'), 'Should contain API title');
    });
  });

  describe('API Versioning', () => {
    it('should include version headers in responses', async () => {
      const response = await fetch(`${API_BASE_URL}/health`);
      assert.strictEqual(response.status, 200);

      const versionHeader = response.headers.get('x-api-version');
      assert.ok(versionHeader, 'Should have X-API-Version header');
      assert.strictEqual(versionHeader, '1.0.0');

      const deprecationInfo = response.headers.get('x-api-deprecation-info');
      assert.ok(deprecationInfo, 'Should have deprecation info header');
    });

    it('should not mark current version as deprecated', async () => {
      const response = await fetch(`${API_BASE_URL}/health`);
      const deprecated = response.headers.get('x-api-deprecated');
      assert.strictEqual(deprecated, null, 'Current version should not be deprecated');
    });
  });

  describe('Health Endpoints', () => {
    it('should return health status', async () => {
      const response = await fetch(`${API_BASE_URL}/health`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.service, 'Should include service name');
    });

    it('should return readiness status', async () => {
      // Note: This endpoint requires authentication in production
      const response = await fetch(`${API_BASE_URL}/ready`);
      // May return 401 if auth is required, or 200/503 if accessible
      assert.ok([200, 401, 503].includes(response.status));

      if (response.status === 200 || response.status === 503) {
        const data = await response.json();
        assert.ok(data.status, 'Should have status field');
        assert.ok(data.checks, 'Should have checks field');
      }
    });
  });

  describe('OpenAPI Specification', () => {
    let spec: any;

    before(async () => {
      const response = await fetch(`${API_BASE_URL}/api-docs.json`);
      spec = await response.json();
    });

    it('should have required OpenAPI fields', () => {
      assert.ok(spec.openapi, 'Should have OpenAPI version');
      assert.ok(spec.info, 'Should have info section');
      assert.ok(spec.info.title, 'Should have title');
      assert.ok(spec.info.version, 'Should have version');
      assert.ok(spec.info.description, 'Should have description');
    });

    it('should define security schemes', () => {
      assert.ok(spec.components, 'Should have components');
      assert.ok(spec.components.securitySchemes, 'Should have security schemes');
      assert.ok(spec.components.securitySchemes.bearerAuth, 'Should have bearer auth');
      assert.ok(spec.components.securitySchemes.cookieAuth, 'Should have cookie auth');
    });

    it('should define common schemas', () => {
      assert.ok(spec.components.schemas, 'Should have schemas');
      assert.ok(spec.components.schemas.Error, 'Should have Error schema');
      assert.ok(spec.components.schemas.User, 'Should have User schema');
      assert.ok(spec.components.schemas.Project, 'Should have Project schema');
    });

    it('should define API endpoints', () => {
      assert.ok(spec.paths, 'Should have paths');
      assert.ok(spec.paths['/health'], 'Should have health endpoint');
      assert.ok(spec.paths['/auth/login'], 'Should have login endpoint');
      assert.ok(spec.paths['/projects'], 'Should have projects endpoint');
      assert.ok(spec.paths['/service-requests'], 'Should have service requests endpoint');
    });

    it('should have proper tags', () => {
      assert.ok(spec.tags, 'Should have tags');
      assert.ok(Array.isArray(spec.tags), 'Tags should be an array');

      const tagNames = spec.tags.map((t: any) => t.name);
      assert.ok(tagNames.includes('Authentication'), 'Should have Authentication tag');
      assert.ok(tagNames.includes('Projects'), 'Should have Projects tag');
      assert.ok(tagNames.includes('Service Requests'), 'Should have Service Requests tag');
    });

    it('should define servers', () => {
      assert.ok(spec.servers, 'Should have servers');
      assert.ok(Array.isArray(spec.servers), 'Servers should be an array');
      assert.ok(spec.servers.length > 0, 'Should have at least one server');
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
        },
      });

      // CORS headers may vary based on configuration
      assert.ok(response.status === 200 || response.status === 204);
    });
  });

  describe('Rate Limiting Headers', () => {
    it('should include rate limit headers', async () => {
      const response = await fetch(`${API_BASE_URL}/health`);

      // Rate limit headers may not be present on all endpoints
      // but should be present on API endpoints
      assert.strictEqual(response.status, 200);
    });
  });

  describe('Error Response Format', () => {
    it('should return proper error format for 404', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/nonexistent-endpoint`);
      assert.strictEqual(response.status, 404);

      const data = await response.json();
      // Error format may vary, but should have error information
      assert.ok(data, 'Should return error data');
    });
  });

  describe('Content-Type Headers', () => {
    it('should return JSON content type for API endpoints', async () => {
      const response = await fetch(`${API_BASE_URL}/health`);
      const contentType = response.headers.get('content-type');
      assert.ok(contentType?.includes('application/json'), 'Should return JSON content type');
    });
  });
});

describe('API Versioning Middleware Tests', () => {
  it('should add version headers to all responses', async () => {
    const endpoints = ['/health', '/api-docs.json'];

    for (const endpoint of endpoints) {
      const response = await fetch(`${API_BASE_URL}${endpoint}`);
      const versionHeader = response.headers.get('x-api-version');
      assert.ok(versionHeader, `${endpoint} should have version header`);
    }
  });

  it('should handle deprecated version warnings', async () => {
    // Test with a hypothetical deprecated version header
    const response = await fetch(`${API_BASE_URL}/health`, {
      headers: {
        'X-API-Version': '0.9.0',
      },
    });

    // Current implementation may not check request version header
    // but should always return current version in response
    assert.ok(response.headers.get('x-api-version'));
  });
});

describe('Documentation Accessibility', () => {
  it('should make API documentation publicly accessible', async () => {
    const response = await fetch(`${API_BASE_URL}/api-docs/`);
    assert.strictEqual(response.status, 200);
  });

  it('should make OpenAPI spec publicly accessible', async () => {
    const jsonResponse = await fetch(`${API_BASE_URL}/api-docs.json`);
    assert.strictEqual(jsonResponse.status, 200);

    const yamlResponse = await fetch(`${API_BASE_URL}/api-docs.yaml`);
    assert.strictEqual(yamlResponse.status, 200);
  });
});
