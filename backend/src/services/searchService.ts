import { dbQuery } from '../db.js';
import type { PoolClient } from 'pg';

export type SearchResultItem = {
  id: string;
  type: 'tenant' | 'project' | 'installation' | 'service_request' | 'direction' | 'user';
  title: string;
  subtitle?: string;
  description?: string;
  rank: number;
  metadata?: Record<string, unknown>;
};

export type SearchOptions = {
  query: string;
  limit?: number;
  types?: Array<'tenant' | 'project' | 'installation' | 'service_request' | 'direction' | 'user'>;
  actorId?: string;
  actorRole?: string;
};

const SEARCH_LIMIT = 50;

/**
 * Cross-entity search using PostgreSQL full-text search with tsvector
 * Implements weighted results (title > description) and fuzzy matching
 */
export async function searchAcrossEntities(options: SearchOptions): Promise<SearchResultItem[]> {
  const { query, limit = SEARCH_LIMIT, types, actorId, actorRole } = options;

  if (!query || query.trim().length === 0) {
    return [];
  }

  const searchQuery = query.trim();
  const tsQuery = searchQuery
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(' & ');

  const allowedTypes = types && types.length > 0 ? types : ['tenant', 'project', 'installation', 'service_request', 'direction', 'user'];
  const canSearchTenants = allowedTypes.includes('tenant') && ['admin', 'manager', 'curator', 'dispatcher'].includes(actorRole || '');
  const canSearchUsers = allowedTypes.includes('user') && ['admin', 'manager', 'curator', 'dispatcher'].includes(actorRole || '');
  const canSearchProjects = allowedTypes.includes('project') || allowedTypes.includes('installation');
  const canSearchServiceRequests = allowedTypes.includes('service_request');
  const canSearchDirections = allowedTypes.includes('direction');

  const results: SearchResultItem[] = [];

  // Search tenants (weighted: name A, brand_name A, inn B)
  if (canSearchTenants) {
    const tenantQuery = `
      select
        id,
        name,
        brand_name,
        inn,
        ts_rank(
          setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(brand_name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(inn, '')), 'B'),
          to_tsquery('simple', $1)
        ) as rank
      from tenants
      where deleted_at is null
        and (
          setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(brand_name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(inn, '')), 'B')
        ) @@ to_tsquery('simple', $1)
      order by rank desc
      limit $2
    `;

    try {
      const tenantResult = await dbQuery(tenantQuery, [tsQuery, limit]);
      results.push(
        ...tenantResult.rows.map((row) => ({
          id: String(row.id),
          type: 'tenant' as const,
          title: String(row.brand_name || row.name || 'Без названия'),
          subtitle: String(row.inn || ''),
          rank: Number(row.rank || 0),
        }))
      );
    } catch (error) {
      // Continue with other searches
    }
  }

  // Search projects (weighted: title A, description B)
  if (canSearchProjects) {
    const projectQuery = `
      select
        id,
        title,
        description,
        status,
        system_type,
        ts_rank(
          setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(description, '')), 'B'),
          to_tsquery('simple', $1)
        ) as rank
      from requests
      where type = 'installation'
        and is_project = true
        and deleted_at is null
        and (
          setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(description, '')), 'B')
        ) @@ to_tsquery('simple', $1)
      order by rank desc
      limit $2
    `;

    try {
      const projectResult = await dbQuery(projectQuery, [tsQuery, limit]);
      results.push(
        ...projectResult.rows.map((row) => ({
          id: String(row.id),
          type: (allowedTypes.includes('installation') ? 'installation' : 'project') as 'installation' | 'project',
          title: String(row.title || 'Без названия'),
          subtitle: String(row.status || ''),
          description: String(row.description || '').substring(0, 200),
          rank: Number(row.rank || 0),
          metadata: {
            systemType: row.system_type,
          },
        }))
      );
    } catch (error) {
      // Continue with other searches
    }
  }

  // Search service requests (weighted: title A, description B)
  if (canSearchServiceRequests) {
    const serviceRequestQuery = `
      select
        id,
        title,
        description,
        status,
        priority,
        system_type,
        ts_rank(
          setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(description, '')), 'B'),
          to_tsquery('simple', $1)
        ) as rank
      from requests
      where type <> 'installation'
        and deleted_at is null
        and (
          setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(description, '')), 'B')
        ) @@ to_tsquery('simple', $1)
      order by rank desc
      limit $2
    `;

    try {
      const serviceRequestResult = await dbQuery(serviceRequestQuery, [tsQuery, limit]);
      results.push(
        ...serviceRequestResult.rows.map((row) => ({
          id: String(row.id),
          type: 'service_request' as const,
          title: String(row.title || 'Без названия'),
          subtitle: String(row.status || ''),
          description: String(row.description || '').substring(0, 200),
          rank: Number(row.rank || 0),
          metadata: {
            priority: row.priority,
            systemType: row.system_type,
          },
        }))
      );
    } catch (error) {
      // Continue with other searches
    }
  }

  // Search directions (weighted: name A, address B)
  if (canSearchDirections) {
    const directionQuery = `
      select
        id,
        name,
        address,
        ts_rank(
          setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(address, '')), 'B'),
          to_tsquery('simple', $1)
        ) as rank
      from directions
      where deleted_at is null
        and (
          setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(address, '')), 'B')
        ) @@ to_tsquery('simple', $1)
      order by rank desc
      limit $2
    `;

    try {
      const directionResult = await dbQuery(directionQuery, [tsQuery, limit]);
      results.push(
        ...directionResult.rows.map((row) => ({
          id: String(row.id),
          type: 'direction' as const,
          title: String(row.name || 'Без названия'),
          subtitle: String(row.address || ''),
          rank: Number(row.rank || 0),
        }))
      );
    } catch (error) {
      // Continue with other searches
    }
  }

  // Search users (weighted: full_name A, email B)
  if (canSearchUsers) {
    const userQuery = `
      select
        id,
        full_name,
        email,
        role,
        ts_rank(
          setweight(to_tsvector('simple', coalesce(full_name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(email, '')), 'B'),
          to_tsquery('simple', $1)
        ) as rank
      from users
      where deleted_at is null
        and (
          setweight(to_tsvector('simple', coalesce(full_name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(email, '')), 'B')
        ) @@ to_tsquery('simple', $1)
      order by rank desc
      limit $2
    `;

    try {
      const userResult = await dbQuery(userQuery, [tsQuery, limit]);
      results.push(
        ...userResult.rows.map((row) => ({
          id: String(row.id),
          type: 'user' as const,
          title: String(row.full_name || row.email || 'Без имени'),
          subtitle: String(row.email || ''),
          rank: Number(row.rank || 0),
          metadata: {
            role: row.role,
          },
        }))
      );
    } catch (error) {
      // Continue with other searches
    }
  }

  // Sort by rank and limit
  return results.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

/**
 * Highlight matching terms in text
 */
export function highlightMatches(text: string, query: string): string {
  if (!text || !query) return text;

  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) return text;

  const regex = new RegExp(`(${terms.join('|')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}
