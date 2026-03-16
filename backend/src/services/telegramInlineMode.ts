import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { TelegramBotClient } from './telegramClient.js';
import { appConfig } from '../config.js';

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

type TelegramInlineQuery = {
    id?: string;
    from?: {
        id?: number;
        username?: string;
    };
    query?: string;
    offset?: string;
};

type TelegramChosenInlineResult = {
    result_id?: string;
    from?: {
        id?: number;
        username?: string;
    };
    query?: string;
};

// Get user ID from Telegram user ID
const getUserIdFromTelegramUserId = async (telegramUserId: number): Promise<string | null> => {
    try {
        const result = await dbQuery(
            `select id::text as user_id
             from app_users
             where telegram_chat_id = $1
             limit 1`,
            [String(telegramUserId)]
        );
        return result.rows[0]?.user_id || null;
    } catch (error) {
        logger.error('Failed to get user ID from Telegram user ID', { error: serializeError(error), telegramUserId });
        return null;
    }
};

// Handle inline query
export const handleInlineQuery = async (bot: TelegramBotClient, query: TelegramInlineQuery) => {
    const queryId = query?.id;
    const searchQuery = normalizeText(query?.query);
    const telegramUserId = query?.from?.id;

    if (!queryId || !telegramUserId) {
        return;
    }

    try {
        // Check if user is linked
        const userId = await getUserIdFromTelegramUserId(telegramUserId);
        if (!userId) {
            // User not linked - show link instruction
            await (bot as any).callApi('answerInlineQuery', {
                inline_query_id: queryId,
                results: [
                    {
                        type: 'article',
                        id: 'not_linked',
                        title: '❌ Аккаунт не привязан',
                        description: 'Сначала привяжите аккаунт командой /link',
                        input_message_content: {
                            message_text: '❌ Для использования inline-режима сначала привяжите аккаунт.\n\nОтправьте боту команду /link для получения кода привязки.',
                        },
                    }
                ],
                cache_time: 0,
            });
            return;
        }

        // If no query, show recent tickets
        if (!searchQuery) {
            const result = await dbQuery(
                `select
                    sr.id::text,
                    sr.number,
                    sr.title,
                    sr.status,
                    sr.priority,
                    sr.created_at,
                    t.name as tenant_name
                 from service_requests sr
                 left join tenants t on t.id = sr.tenant_id
                 where sr.assigned_to_user_id = $1::uuid
                   or sr.created_by_user_id = $1::uuid
                 order by sr.created_at desc
                 limit 10`,
                [userId]
            );

            const results = result.rows.map((ticket, index) => {
                const statusLabels: Record<string, string> = {
                    new: '🆕 Новая',
                    triage: '🔍 Сортировка',
                    assigned: '👤 Назначена',
                    in_progress: '⚙️ В работе',
                    on_site: '📍 На объекте',
                    done: '✅ Выполнена',
                    closed: '🔒 Закрыта',
                    cancelled: '❌ Отменена',
                };

                const priorityLabels: Record<string, string> = {
                    critical: '🔴 Критический',
                    high: '🟠 Высокий',
                    medium: '🟡 Средний',
                    low: '⚪ Низкий',
                };

                const messageText = [
                    `📋 Заявка ${ticket.number}`,
                    '',
                    `📝 ${ticket.title}`,
                    `📊 Статус: ${statusLabels[ticket.status] || ticket.status}`,
                    `⚡ Приоритет: ${priorityLabels[ticket.priority] || ticket.priority}`,
                    ticket.tenant_name ? `🏢 Клиент: ${ticket.tenant_name}` : '',
                    `📅 ${new Date(ticket.created_at).toLocaleString('ru-RU')}`,
                    '',
                    `🔗 ${appConfig.appUrl}/service-requests/${ticket.id}`,
                ].filter(Boolean).join('\n');

                return {
                    type: 'article',
                    id: `ticket_${ticket.id}_${index}`,
                    title: `${ticket.number}: ${ticket.title}`,
                    description: `${statusLabels[ticket.status] || ticket.status} | ${priorityLabels[ticket.priority] || ticket.priority}`,
                    input_message_content: {
                        message_text: messageText,
                    },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔗 Открыть в системе', url: `${appConfig.appUrl}/service-requests/${ticket.id}` }
                            ]
                        ]
                    }
                };
            });

            if (results.length === 0) {
                results.push({
                    type: 'article',
                    id: 'no_tickets',
                    title: '📋 Нет заявок',
                    description: 'У вас пока нет заявок',
                    input_message_content: {
                        message_text: '📋 У вас пока нет заявок',
                    },
                });
            }

            await (bot as any).callApi('answerInlineQuery', {
                inline_query_id: queryId,
                results,
                cache_time: 30,
            });
            return;
        }

        // Search tickets
        const result = await dbQuery(
            `select
                sr.id::text,
                sr.number,
                sr.title,
                sr.status,
                sr.priority,
                sr.created_at,
                t.name as tenant_name,
                i.address as installation_address
             from service_requests sr
             left join tenants t on t.id = sr.tenant_id
             left join installations i on i.id = sr.installation_id
             where (sr.number ilike $1 or sr.title ilike $1 or sr.description ilike $1)
             order by sr.created_at desc
             limit 20`,
            [`%${searchQuery}%`]
        );

        const statusLabels: Record<string, string> = {
            new: '🆕 Новая',
            triage: '🔍 Сортировка',
            assigned: '👤 Назначена',
            in_progress: '⚙️ В работе',
            on_site: '📍 На объекте',
            done: '✅ Выполнена',
            closed: '🔒 Закрыта',
            cancelled: '❌ Отменена',
        };

        const priorityLabels: Record<string, string> = {
            critical: '🔴 Критический',
            high: '🟠 Высокий',
            medium: '🟡 Средний',
            low: '⚪ Низкий',
        };

        const results = result.rows.map((ticket, index) => {
            const messageText = [
                `📋 Заявка ${ticket.number}`,
                '',
                `📝 ${ticket.title}`,
                `📊 Статус: ${statusLabels[ticket.status] || ticket.status}`,
                `⚡ Приоритет: ${priorityLabels[ticket.priority] || ticket.priority}`,
                ticket.tenant_name ? `🏢 Клиент: ${ticket.tenant_name}` : '',
                ticket.installation_address ? `📍 Адрес: ${ticket.installation_address}` : '',
                `📅 ${new Date(ticket.created_at).toLocaleString('ru-RU')}`,
                '',
                `🔗 ${appConfig.appUrl}/service-requests/${ticket.id}`,
            ].filter(Boolean).join('\n');

            return {
                type: 'article',
                id: `search_${ticket.id}_${index}`,
                title: `${ticket.number}: ${ticket.title}`,
                description: `${statusLabels[ticket.status] || ticket.status} | ${priorityLabels[ticket.priority] || ticket.priority}`,
                input_message_content: {
                    message_text: messageText,
                },
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔗 Открыть в системе', url: `${appConfig.appUrl}/service-requests/${ticket.id}` }
                        ]
                    ]
                }
            };
        });

        if (results.length === 0) {
            results.push({
                type: 'article',
                id: 'no_results',
                title: '🔍 Ничего не найдено',
                description: `По запросу "${searchQuery}" ничего не найдено`,
                input_message_content: {
                    message_text: `🔍 По запросу "${searchQuery}" ничего не найдено`,
                },
            });
        }

        // Add quick action to create new ticket
        results.unshift({
            type: 'article',
            id: 'create_ticket',
            title: '➕ Создать новую заявку',
            description: 'Быстрое создание заявки',
            input_message_content: {
                message_text: '➕ Для создания новой заявки отправьте боту команду /create',
            },
        });

        await (bot as any).callApi('answerInlineQuery', {
            inline_query_id: queryId,
            results,
            cache_time: 30,
        });
    } catch (error) {
        logger.error('Failed to handle inline query', { error: serializeError(error), query: searchQuery });

        // Send error result
        try {
            await (bot as any).callApi('answerInlineQuery', {
                inline_query_id: queryId,
                results: [
                    {
                        type: 'article',
                        id: 'error',
                        title: '❌ Ошибка поиска',
                        description: 'Произошла ошибка при поиске',
                        input_message_content: {
                            message_text: '❌ Произошла ошибка при поиске. Попробуйте позже.',
                        },
                    }
                ],
                cache_time: 0,
            });
        } catch (answerError) {
            logger.error('Failed to send error inline query result', { error: serializeError(answerError) });
        }
    }
};

// Handle chosen inline result (for analytics)
export const handleChosenInlineResult = async (result: TelegramChosenInlineResult) => {
    const resultId = normalizeText(result?.result_id);
    const query = normalizeText(result?.query);
    const telegramUserId = result?.from?.id;

    if (!resultId || !telegramUserId) {
        return;
    }

    try {
        const userId = await getUserIdFromTelegramUserId(telegramUserId);
        if (!userId) {
            return;
        }

        // Log inline query usage for analytics
        logger.info('Inline query result chosen', {
            userId,
            resultId,
            query,
        });

        // Could store this in database for analytics
        // await dbQuery(
        //     `insert into telegram_inline_analytics (user_id, result_id, query, created_at)
        //      values ($1::uuid, $2, $3, now())`,
        //     [userId, resultId, query]
        // );
    } catch (error) {
        logger.error('Failed to handle chosen inline result', { error: serializeError(error), resultId });
    }
};

// Enable inline mode for bot
export const enableInlineMode = async (bot: TelegramBotClient) => {
    try {
        // Set inline mode settings
        await (bot as any).callApi('setMyCommands', {
            commands: [
                { command: 'start', description: 'Начать работу с ботом' },
                { command: 'help', description: 'Список команд' },
                { command: 'status', description: 'Статус заявки' },
                { command: 'mytickets', description: 'Мои заявки' },
                { command: 'create', description: 'Создать заявку' },
                { command: 'search', description: 'Поиск заявок' },
                { command: 'link', description: 'Привязать аккаунт' },
                { command: 'unlink', description: 'Отвязать аккаунт' },
            ]
        });

        logger.info('Inline mode enabled successfully');
    } catch (error) {
        logger.error('Failed to enable inline mode', { error: serializeError(error) });
    }
};
