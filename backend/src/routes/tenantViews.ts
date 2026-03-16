import {
    createLocalMockSavedView,
    createSavedView,
    deleteLocalMockSavedView,
    deleteSavedView,
    listLocalMockSavedViews,
    listSavedViews,
    updateLocalMockSavedView,
    updateSavedView,
} from '../helpers/savedViews.js';
import { tenantSavedViewConfig } from '../helpers/tenantHelpers.js';
import { ApiError } from '../errors.js';

export const registerMockTenantViewRoutes = (params) => {
    const { app, requireAuth } = params;

    const assertTenantViewsAccess = (request) => {
        const actorRole = request.authUser?.role ?? '';
        if (!actorRole) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage tenant views');
        }
        return request.authUser?.id ?? '';
    };

    app.get('/tenants/views', requireAuth, (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const result = listLocalMockSavedViews({
            actorUserId,
            config: tenantSavedViewConfig,
        });
        response.status(200).json(result);
    });

    app.post('/tenants/views', requireAuth, (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const result = createLocalMockSavedView({
            actorUserId,
            config: tenantSavedViewConfig,
            input: request.body,
        });
        response.status(201).json(result);
    });

    app.patch('/tenants/views/:viewId', requireAuth, (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const viewId = request.params.viewId;
        const result = updateLocalMockSavedView({
            actorUserId,
            config: tenantSavedViewConfig,
            viewId,
            input: request.body,
        });
        response.status(200).json(result);
    });

    app.delete('/tenants/views/:viewId', requireAuth, (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const viewId = request.params.viewId;
        deleteLocalMockSavedView({
            actorUserId,
            config: tenantSavedViewConfig,
            viewId,
        });
        response.status(204).send();
    });
};

export const registerTenantViewRoutes = (params) => {
    const { app, requireAuth, asyncHandler, dbQuery, withTx } = params;

    const assertTenantViewsAccess = (request) => {
        const actorRole = request.authUser?.role ?? '';
        if (!actorRole) {
            throw new ApiError(403, 'FORBIDDEN', 'Role is not allowed to manage tenant views');
        }
        return request.authUser?.id ?? '';
    };

    app.get('/tenants/views', requireAuth, asyncHandler(async (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const result = await listSavedViews({
            actorUserId,
            config: tenantSavedViewConfig,
            dbQuery,
        });
        response.status(200).json(result);
    }));

    app.post('/tenants/views', requireAuth, asyncHandler(async (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const result = await createSavedView({
            actorUserId,
            config: tenantSavedViewConfig,
            input: request.body,
            withTx,
        });
        response.status(201).json(result);
    }));

    app.patch('/tenants/views/:viewId', requireAuth, asyncHandler(async (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const viewId = request.params.viewId;
        const result = await updateSavedView({
            actorUserId,
            config: tenantSavedViewConfig,
            viewId,
            input: request.body,
            withTx,
        });
        response.status(200).json(result);
    }));

    app.delete('/tenants/views/:viewId', requireAuth, asyncHandler(async (request, response) => {
        const actorUserId = assertTenantViewsAccess(request);
        const viewId = request.params.viewId;
        await deleteSavedView({
            actorUserId,
            config: tenantSavedViewConfig,
            viewId,
            withTx,
        });
        response.status(204).send();
    }));
};
