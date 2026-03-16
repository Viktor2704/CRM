import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { moduleService } from '../src/services/moduleService.js';
import { hookSystem, HOOKS, registerHook, doAction, applyFilters } from '../src/services/hookSystem.js';
import { moduleRegistry, defineModule } from '../src/services/moduleRegistry.js';
import { pool } from '../src/db.js';

describe('Module System', () => {
    let testModuleId: string;

    before(async () => {
        // Clean up any test modules
        await pool.query("DELETE FROM modules WHERE name LIKE 'test.%'");
    });

    after(async () => {
        // Clean up test data
        if (testModuleId) {
            try {
                await pool.query('DELETE FROM modules WHERE id = $1', [testModuleId]);
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        await pool.end();
    });

    describe('ModuleService', () => {
        it('should install a new module', async () => {
            const module = await moduleService.installModule(
                'test.sample',
                'Test Sample Module',
                '1.0.0',
                {
                    description: 'A test module',
                    category: 'utility',
                }
            );

            testModuleId = module.id;

            assert.strictEqual(module.name, 'test.sample');
            assert.strictEqual(module.display_name, 'Test Sample Module');
            assert.strictEqual(module.version, '1.0.0');
            assert.strictEqual(module.status, 'disabled');
            assert.strictEqual(module.is_core, false);
        });

        it('should list modules', async () => {
            const modules = await moduleService.listModules();
            assert.ok(modules.length > 0);
            assert.ok(modules.some(m => m.name === 'test.sample'));
        });

        it('should get module by name', async () => {
            const module = await moduleService.getModuleByName('test.sample');
            assert.ok(module);
            assert.strictEqual(module.name, 'test.sample');
        });

        it('should enable a module', async () => {
            const module = await moduleService.enableModule(testModuleId);
            assert.strictEqual(module.status, 'enabled');
            assert.ok(module.enabled_at);
        });

        it('should disable a module', async () => {
            const module = await moduleService.disableModule(testModuleId);
            assert.strictEqual(module.status, 'disabled');
            assert.ok(module.disabled_at);
        });

        it('should update module config', async () => {
            const config = { setting1: 'value1', setting2: 42 };
            const module = await moduleService.updateModuleConfig(testModuleId, config);
            assert.deepStrictEqual(module.config, config);
        });

        it('should add and retrieve module settings', async () => {
            await moduleService.updateModuleSetting(testModuleId, 'test_setting', 'test_value');
            const settings = await moduleService.getModuleSettings(testModuleId);
            assert.ok(settings.some(s => s.setting_key === 'test_setting'));
        });

        it('should log module events', async () => {
            await moduleService.logModuleEvent(testModuleId, 'updated', { test: true });
            const events = await moduleService.getModuleEvents(testModuleId);
            assert.ok(events.length > 0);
            assert.ok(events.some(e => e.event_type === 'updated'));
        });

        it('should prevent disabling core modules', async () => {
            const coreModule = await moduleService.getModuleByName('core.projects');
            if (coreModule) {
                await assert.rejects(
                    async () => await moduleService.disableModule(coreModule.id),
                    /Cannot disable core module/
                );
            }
        });

        it('should uninstall a module', async () => {
            await moduleService.uninstallModule(testModuleId);
            const module = await moduleService.getModuleById(testModuleId);
            assert.strictEqual(module, null);
            testModuleId = ''; // Clear so cleanup doesn't fail
        });
    });

    describe('HookSystem', () => {
        before(() => {
            hookSystem.clearAllHooks();
        });

        it('should register and execute action hooks', async () => {
            let executed = false;
            registerHook('test.module', 'test.action', async (data) => {
                executed = true;
                assert.strictEqual(data.value, 'test');
            });

            await doAction('test.action', { value: 'test' });
            assert.strictEqual(executed, true);
        });

        it('should execute filter hooks and modify data', async () => {
            registerHook('test.module', 'test.filter', async (data) => {
                return { ...data, modified: true };
            });

            const result = await applyFilters('test.filter', { value: 'test' });
            assert.strictEqual(result.modified, true);
            assert.strictEqual(result.value, 'test');
        });

        it('should execute hooks in priority order', async () => {
            const order: number[] = [];

            registerHook('test.module1', 'test.priority', async () => {
                order.push(1);
            }, 10);

            registerHook('test.module2', 'test.priority', async () => {
                order.push(2);
            }, 5);

            registerHook('test.module3', 'test.priority', async () => {
                order.push(3);
            }, 15);

            await doAction('test.priority', {});
            assert.deepStrictEqual(order, [2, 1, 3]); // Priority 5, 10, 15
        });

        it('should unregister module hooks', () => {
            registerHook('test.cleanup', 'test.hook', async () => {});
            assert.ok(hookSystem.hasHook('test.hook'));

            hookSystem.unregisterModuleHooks('test.cleanup');
            assert.strictEqual(hookSystem.hasHook('test.hook'), false);
        });

        it('should handle errors in hooks gracefully', async () => {
            registerHook('test.error', 'test.error.hook', async () => {
                throw new Error('Test error');
            });

            // Should not throw
            await doAction('test.error.hook', {});
        });
    });

    describe('ModuleRegistry', () => {
        it('should register a module definition', () => {
            const definition = defineModule({
                name: 'test.registry',
                display_name: 'Test Registry Module',
                version: '1.0.0',
                category: 'utility',
                permissions: [
                    { name: 'test.read', description: 'Read test', category: 'read' },
                ],
            });

            moduleRegistry.registerModule(definition);
            const registered = moduleRegistry.getModuleDefinition('test.registry');
            assert.ok(registered);
            assert.strictEqual(registered.name, 'test.registry');
        });

        it('should get all registered modules', () => {
            const modules = moduleRegistry.getRegisteredModules();
            assert.ok(modules.length > 0);
        });

        it('should check if module is initialized', () => {
            const isInitialized = moduleRegistry.isModuleInitialized('test.registry');
            assert.strictEqual(typeof isInitialized, 'boolean');
        });
    });

    describe('Module Dependencies', () => {
        let module1Id: string;
        let module2Id: string;

        before(async () => {
            const mod1 = await moduleService.installModule('test.dep1', 'Dep Module 1', '1.0.0');
            const mod2 = await moduleService.installModule('test.dep2', 'Dep Module 2', '1.0.0');
            module1Id = mod1.id;
            module2Id = mod2.id;
        });

        after(async () => {
            try {
                await pool.query('DELETE FROM modules WHERE id IN ($1, $2)', [module1Id, module2Id]);
            } catch (error) {
                // Ignore cleanup errors
            }
        });

        it('should add module dependency', async () => {
            const dep = await moduleService.addModuleDependency(module2Id, module1Id, '>=1.0.0');
            assert.strictEqual(dep.module_id, module2Id);
            assert.strictEqual(dep.depends_on_module_id, module1Id);
        });

        it('should get module dependencies', async () => {
            const deps = await moduleService.getModuleDependencies(module2Id);
            assert.ok(deps.length > 0);
            assert.ok(deps.some(d => d.depends_on_module_id === module1Id));
        });

        it('should prevent enabling module with disabled dependencies', async () => {
            await assert.rejects(
                async () => await moduleService.enableModule(module2Id),
                /Dependency module not enabled/
            );
        });
    });
});
