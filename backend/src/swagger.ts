import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SwaggerConfig {
  app: Express;
  basePath?: string;
  version?: string;
}

/**
 * Configure Swagger UI and OpenAPI documentation
 */
export const setupSwagger = async (config: SwaggerConfig): Promise<void> => {
  const { app, basePath = '/api/v1', version = '1.0.0' } = config;

  try {
    // Load OpenAPI spec from YAML file
    const openApiPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
    const openApiContent = await fs.readFile(openApiPath, 'utf-8');
    const openApiSpec = yaml.load(openApiContent) as any;

    // Update version and base path dynamically
    if (openApiSpec.info) {
      openApiSpec.info.version = version;
    }
    if (openApiSpec.servers && openApiSpec.servers.length > 0) {
      openApiSpec.servers[0].url = `http://localhost:3000${basePath}`;
    }

    // Swagger UI options
    const swaggerUiOptions = {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Novinzhstroy API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        syntaxHighlight: {
          activate: true,
          theme: 'monokai',
        },
      },
    };

    // Serve Swagger UI at /api-docs
    app.use(
      '/api-docs',
      swaggerUi.serve,
      swaggerUi.setup(openApiSpec, swaggerUiOptions)
    );

    // Serve raw OpenAPI spec as JSON
    app.get('/api-docs.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(openApiSpec);
    });

    // Serve raw OpenAPI spec as YAML
    app.get('/api-docs.yaml', (_req, res) => {
      res.setHeader('Content-Type', 'text/yaml');
      res.send(openApiContent);
    });

    logger.info('Swagger UI available at /api-docs');
    logger.info('OpenAPI spec available at /api-docs.json and /api-docs.yaml');
  } catch (error) {
    logger.error('Failed to setup Swagger', { error });
    throw error;
  }
};

/**
 * API versioning middleware
 * Adds version information to response headers
 */
export const apiVersionMiddleware = (version: string) => {
  return (_req: any, res: any, next: any) => {
    res.setHeader('X-API-Version', version);
    res.setHeader('X-API-Deprecation-Info', 'https://docs.novinzhstroy.com/api/deprecation');
    next();
  };
};

/**
 * Check if a specific API version is deprecated
 */
export const isVersionDeprecated = (version: string): boolean => {
  const deprecatedVersions = ['0.9.0', '0.8.0'];
  return deprecatedVersions.includes(version);
};

/**
 * Middleware to warn about deprecated API versions
 */
export const deprecationWarningMiddleware = (currentVersion: string) => {
  return (req: any, res: any, next: any) => {
    const requestedVersion = req.headers['x-api-version'] || currentVersion;

    if (isVersionDeprecated(requestedVersion)) {
      res.setHeader('X-API-Deprecated', 'true');
      res.setHeader('X-API-Sunset-Date', '2026-12-31');
      res.setHeader('Warning', '299 - "This API version is deprecated. Please upgrade to v1.0.0"');
    }

    next();
  };
};

/**
 * Generate API documentation metadata
 */
export const getApiMetadata = () => {
  return {
    version: '1.0.0',
    title: 'Novinzhstroy API',
    description: 'Project management and service request system',
    documentation: '/api-docs',
    openApiSpec: '/api-docs.json',
    contact: {
      name: 'API Support',
      email: 'support@novinzhstroy.com',
    },
    license: {
      name: 'Proprietary',
    },
  };
};
