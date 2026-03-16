import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { searchAcrossEntities, highlightMatches } from '../services/searchService.js';
import { asyncHandler } from '../helpers/asyncHandler.js';

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  types: z.string().optional(),
  highlight: z.coerce.boolean().optional().default(false),
});

export function registerSearchRoutes(params: {
  app: Express;
  requireAuth: (req: Request, res: Response, next: () => void) => void;
}) {
  const { app, requireAuth } = params;

  /**
   * GET /search
   * Cross-entity search endpoint
   */
  app.get(
    '/search',
    requireAuth,
    asyncHandler(async (request, response) => {
      const query = searchQuerySchema.parse({
        q: request.query.q,
        limit: request.query.limit,
        types: request.query.types,
        highlight: request.query.highlight,
      });

      const user = (request as any).authUser;
      const actorId = user?.id;
      const actorRole = user?.role;

      const types = query.types
        ? query.types.split(',').filter(Boolean) as Array<'tenant' | 'project' | 'installation' | 'service_request' | 'direction' | 'user'>
        : undefined;

      const results = await searchAcrossEntities({
        query: query.q,
        limit: query.limit,
        types,
        actorId,
        actorRole,
      });

      // Apply highlighting if requested
      const finalResults = query.highlight
        ? results.map((item) => ({
            ...item,
            title: highlightMatches(item.title, query.q),
            subtitle: item.subtitle ? highlightMatches(item.subtitle, query.q) : undefined,
            description: item.description ? highlightMatches(item.description, query.q) : undefined,
          }))
        : results;

      response.json({
        query: query.q,
        total: finalResults.length,
        results: finalResults,
      });
    })
  );
}
