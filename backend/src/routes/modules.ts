import { Router } from 'express';
import { z } from 'zod';
import { moduleService } from '../services/moduleService.js';
import { hookSystem } from '../services/hookSystem.js';
import { requireAuth, requireAdminLike } from '../middleware/auth.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { ApiError } from '../errors.js';
import { dbQuery } from '../db.js';

const router = Router();

// Validation schemas
const installModuleSchema = z.object({
    name: z.string().min(1).max(100),
    display_name: z.string().min(1).max(200),
    version: z.string().min(1).max(50),
    description: z.string().optional(),
    author: z.string().optional(),
    category: z.enum(['core', 'business', 'integration', 'utility']).optional(),
    config: z.record(z.string(), z.any()).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
});

const updateModuleConfigSchema = z.object({
    config: z.record(z.string(), z.any()),
});

const updateModuleSettingSchema = z.object({
    setting_key: z.string().min(1),
    setting_value: z.any(),
});

const addDependencySchema = z.object({
    depends_on_module_id: z.string().uuid(),
    version_constraint: z.string().optional(),
    is_optional: z.boolean().optional(),
});

/**
 * @swagger
 * /api/modules:
 *   get:
 *     summary: List all modules
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [enabled, disabled, installing, uninstalling]
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [core, business, integration, utility]
 *       - in: query
 *         name: is_core
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of modules
 */
router.get(
    '/',
    requireAuth as any,
    (req: any, res: any, next: any) => { if (req.authUser?.role !== 'admin') { res.status(403).json({code:'FORBIDDEN',message:'Admin only',status:403}); return; } next(); },
    asyncHandler(async (req, res) => {
        const filters: any = {};

        if (req.query.status) {
            filters.status = req.query.status;
        }
        if (req.query.category) {
            filters.category = req.query.category;
        }
        if (req.query.is_core !== undefined) {
            filters.is_core = req.query.is_core === 'true';
        }

        const modules = await moduleService.listModules(filters);
        res.json({ modules });
    })
);

/**
 * @swagger
 * /api/modules/{id}:
 *   get:
 *     summary: Get module by ID
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module details
 *       404:
 *         description: Module not found
 */
router.get(
    '/:id',
    requireAuth as any,
    (req: any, res: any, next: any) => { if (req.authUser?.role !== 'admin') { res.status(403).json({code:'FORBIDDEN',message:'Admin only',status:403}); return; } next(); },
    asyncHandler(async (req, res) => {
        const module = await moduleService.getModuleById(req.params.id);
        if (!module) {
            throw new ApiError(404, 'NOT_FOUND', 'Module not found');
        }
        res.json({ module });
    })
);

/**
 * @swagger
 * /api/modules:
 *   post:
 *     summary: Install a new module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - display_name
 *               - version
 *     responses:
 *       201:
 *         description: Module installed
 */
router.post(
    '/',
    requireAuth as any,
    requireAdminLike as any,
    asyncHandler(async (req, res) => {
        const data = installModuleSchema.parse(req.body);

        const module = await moduleService.installModule(
            data.name,
            data.display_name,
            data.version,
            {
                description: data.description,
                author: data.author,
                category: data.category,
                config: data.config,
                metadata: data.metadata,
            }
        );

        res.status(201).json({ module });
    })
);

/**
 * @swagger
 * /api/modules/{id}/enable:
 *   post:
 *     summary: Enable a module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module enabled
 */
router.post(
    '/:id/enable',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        const module = await moduleService.enableModule(req.params.id, req.user?.id);
        res.json({ module });
    })
);

/**
 * @swagger
 * /api/modules/{id}/disable:
 *   post:
 *     summary: Disable a module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module disabled
 */
router.post(
    '/:id/disable',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        const module = await moduleService.disableModule(req.params.id, req.user?.id);
        res.json({ module });
    })
);

/**
 * @swagger
 * /api/modules/{id}:
 *   delete:
 *     summary: Uninstall a module
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module uninstalled
 */
router.delete(
    '/:id',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        await moduleService.uninstallModule(req.params.id, req.user?.id);
        res.json({ success: true });
    })
);

/**
 * @swagger
 * /api/modules/{id}/config:
 *   put:
 *     summary: Update module configuration
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Configuration updated
 */
router.put(
    '/:id/config',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        const data = updateModuleConfigSchema.parse(req.body);
        const module = await moduleService.updateModuleConfig(req.params.id, data.config);
        res.json({ module });
    })
);

/**
 * @swagger
 * /api/modules/{id}/settings:
 *   get:
 *     summary: Get module settings
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module settings
 */
router.get(
    '/:id/settings',
    requireAuth,
    (req: any, res: any, next: any) => { if (req.authUser?.role !== 'admin') { res.status(403).json({code:'FORBIDDEN',message:'Admin only',status:403}); return; } next(); },
    asyncHandler(async (req, res) => {
        const settings = await moduleService.getModuleSettings(req.params.id);
        res.json({ settings });
    })
);

/**
 * @swagger
 * /api/modules/{id}/settings:
 *   put:
 *     summary: Update module setting
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               setting_key:
 *                 type: string
 *               setting_value:
 *                 type: any
 *     responses:
 *       200:
 *         description: Setting updated
 */
router.put(
    '/:id/settings',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        const data = updateModuleSettingSchema.parse(req.body);
        const setting = await moduleService.updateModuleSetting(
            req.params.id,
            data.setting_key,
            data.setting_value
        );
        res.json({ setting });
    })
);

/**
 * @swagger
 * /api/modules/{id}/dependencies:
 *   get:
 *     summary: Get module dependencies
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module dependencies
 */
router.get(
    '/:id/dependencies',
    requireAuth,
    asyncHandler(async (req, res) => {
        const dependencies = await moduleService.getModuleDependencies(req.params.id);
        res.json({ dependencies });
    })
);

/**
 * @swagger
 * /api/modules/{id}/dependencies:
 *   post:
 *     summary: Add module dependency
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               depends_on_module_id:
 *                 type: string
 *                 format: uuid
 *               version_constraint:
 *                 type: string
 *               is_optional:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Dependency added
 */
router.post(
    '/:id/dependencies',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        const data = addDependencySchema.parse(req.body);
        const dependency = await moduleService.addModuleDependency(
            req.params.id,
            data.depends_on_module_id,
            data.version_constraint,
            data.is_optional
        );
        res.status(201).json({ dependency });
    })
);

/**
 * @swagger
 * /api/modules/{id}/permissions:
 *   get:
 *     summary: Get module permissions
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Module permissions
 */
router.get(
    '/:id/permissions',
    requireAuth,
    asyncHandler(async (req, res) => {
        const permissions = await moduleService.getModulePermissions(req.params.id);
        res.json({ permissions });
    })
);

/**
 * @swagger
 * /api/modules/{id}/events:
 *   get:
 *     summary: Get module events
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Module events
 */
router.get(
    '/:id/events',
    requireAuth,
    asyncHandler(async (req, res) => {
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const events = await moduleService.getModuleEvents(req.params.id, limit);
        res.json({ events });
    })
);

/**
 * @swagger
 * /api/modules/hooks/registered:
 *   get:
 *     summary: Get all registered hooks
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of registered hooks
 */
router.get(
    '/hooks/registered',
    requireAuth,
    requireAdminLike,
    asyncHandler(async (req, res) => {
        const hooks = hookSystem.getRegisteredHooks();
        const hookDetails = hooks.map(hookName => ({
            name: hookName,
            handlers: hookSystem.getHookHandlers(hookName).map(h => ({
                module: h.module,
                priority: h.priority,
            })),
        }));
        res.json({ hooks: hookDetails });
    })
);

/**
 * @swagger
 * /api/modules/ui-components:
 *   get:
 *     summary: Get all active UI components from enabled modules
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: component_type
 *         schema:
 *           type: string
 *           enum: [page, widget, menu, tab, action]
 *       - in: query
 *         name: mount_point
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of UI components
 */
router.get(
    '/ui-components',
    requireAuth,
    asyncHandler(async (req, res) => {
        let query = `
            SELECT mc.*, m.name as module_name, m.display_name as module_display_name
            FROM module_ui_components mc
            JOIN modules m ON mc.module_id = m.id
            WHERE m.status = 'enabled' AND mc.is_active = true
        `;
        const params: any[] = [];
        let paramIndex = 1;

        if (req.query.component_type) {
            query += ` AND mc.component_type = $${paramIndex++}`;
            params.push(req.query.component_type);
        }

        if (req.query.mount_point) {
            query += ` AND mc.mount_point = $${paramIndex++}`;
            params.push(req.query.mount_point);
        }

        query += ' ORDER BY mc.order_index ASC, mc.component_name ASC';

        const result = await dbQuery(query, params);
        res.json({ components: result.rows });
    })
);

export function registerModuleRoutes(app: any): void {
    app.use('/modules', router);
}
