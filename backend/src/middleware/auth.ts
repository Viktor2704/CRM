import { ApiError } from '../errors.js';
import { verifyAccessToken } from '../security.js';
import { INTERNAL_GLOBAL_ROLES } from '../types.js';
export const requireAuth = (request, _response, next) => {
    const authHeader = request.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token is required');
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token is required');
    }
    try {
        const payload = verifyAccessToken(token) as any;
        request.authUser = { id: payload.sub, role: payload.role };
        next();
    }
    catch (_error) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid access token');
    }
};
export const requireAdminLike = (request, _response, next) => {
    const role = request.authUser?.role;
    if (role !== 'admin' && role !== 'manager') {
        throw new ApiError(403, 'FORBIDDEN', 'Admin or manager role is required');
    }
    next();
};
export const requireUserPageAccess = (request, _response, next) => {
    const role = request.authUser?.role;
    if (role !== 'admin') {
        throw new ApiError(403, 'FORBIDDEN', 'Access to user management is restricted');
    }
    next();
};
export const requireTenantPageAccess = (request, _response, next) => {
    const role = request.authUser?.role;
    if (!INTERNAL_GLOBAL_ROLES.has(role ?? '')) {
        throw new ApiError(403, 'FORBIDDEN', 'Access to tenant management is restricted');
    }
    next();
};
