import { dbQuery } from '../db.js';
import { isUuidValue, normalizeText } from '../helpers/normalize.js';
import { logger, serializeError } from '../logger.js';
import { TelegramBotClient, TelegramMessage } from './telegramClient.js';
import { appConfig } from '../config.js';

// Conversation state management
type ConversationState = {
    userId: string;
    chatId: number | string;
    state: 'idle' | 'awaiting_ticket_title' | 'awaiting_ticket_description' | 'awaiting_search_query';
    context?: Record<string, unknown>;
    createdAt: number;
    expiresAt: number;
};

const conversationStates = new Map<string, ConversationState>();
const CONVERSATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired conversation states
setInterval(() => {
    const now = Date.now();
    for (const [key, state] of conversationStates.entries()) {
        if (state.expiresAt < now) {
            conversationStates.delete(key);
        }
    }
}, 60 * 1000); // Clean up every minute

const setConversationState = (chatId: number | string, userId: string, state: ConversationState['state'], context?: Record<string, unknown>) => {
    const now = Date.now();
    conversationStates.set(String(chatId), {
        userId,
        chatId,
        state,
        context,
        createdAt: now,
        expiresAt: now + CONVERSATION_TTL_MS,
    });
};

const getConversationState = (chatId: number | string): ConversationState | null => {
    const state = conversationStates.get(String(chatId));
    if (!state) return null;
    if (state.expiresAt < Date.now()) {
        conversationStates.delete(String(chatId));
        return null;
    }
    return state;
};

const clearConversationState = (chatId: number | string) => {
    conversationStates.delete(String(chatId));
};

// Get user ID from chat ID
const getUserIdFromChatId = async (chatId: number | string): Promise<string | null> => {
    try {
        const result = await dbQuery(
            `select id::text as user_id
             from app_users
             where telegram_chat_id = $1
             limit 1`,
            [String(chatId)]
        );
        return result.rows[0]?.user_id || null;
    } catch (error) {
        logger.error('Failed to get user ID from chat ID', { error: serializeError(error), chatId });
        return null;
    }
};

// Command handlers
export const handleStartCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const args = normalizeText(message?.text).split(/\s+/).slice(1);
    const deepLinkParam = args[0];

    let text = [
        '👋 Добро пожаловать в бот Новинжстрой!',
        '',
        'Доступные команды:',
        '/help — список всех команд',
        '/status — статус системы',
        '/mytickets — мои заявки',
        '/create — создать новую заявку',
        '/search — поиск по заявкам',
        '/link <код> — привязать аккаунт',
        '/unlink — отвязать аккаунт',
    ].join('\n');

    // Handle deep linking
    if (deepLinkParam) {
        if (deepLinkParam.startsWith('ticket_')) {
            const ticketId = deepLinkParam.replace('ticket_', '');
            text += `\n\n🔗 Открываю заявку ${ticketId}...`;
            await bot.sendMessage(chatId, text);
            // Trigger ticket view
            await handleStatusCommand(bot, message, ticketId);
            return;
        } else if (deepLinkParam.startsWith('link_')) {
            const token = deepLinkParam.replace('link_', '');
            text += `\n\n🔗 Привязываю аккаунт с т��кеном ${token}...`;
            await bot.sendMessage(chatId, text);
            // Trigger link command
            const linkMessage = { ...message, text: `/link ${token}` };
            await handleLinkCommand(bot, linkMessage, token);
            return;
        }
    }

    await bot.sendMessage(chatId, text);
};

export const handleHelpCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const text = [
        '📖 Команды бота Новинжстрой:',
        '',
        '🔐 Аккаунт:',
        '/start — начать работу с ботом',
        '/link <код> — привязать Telegram к аккаунту',
        '/unlink — отвязать аккаунт',
        '',
        '📋 Заявки:',
        '/mytickets — список моих заявок',
        '/status <номер> — статус заявки по номеру',
        '/create — создать новую заявку',
        '/search <запрос> — поиск по заявкам',
        '',
        '📍 Другое:',
        '/help — показать эту справку',
        '',
        '💡 Вы также можете использовать inline-режим:',
        'Напишите @' + appConfig.telegramBotUsername + ' в любом чате для быстрого поиска',
    ].join('\n');

    await bot.sendMessage(chatId, text);
};

export const handleStatusCommand = async (bot: TelegramBotClient, message: TelegramMessage, ticketNumber?: string) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const userId = await getUserIdFromChatId(chatId);
    if (!userId) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    const args = normalizeText(message?.text).split(/\s+/).slice(1);
    const number = ticketNumber || args[0];

    if (!number) {
        await bot.sendMessage(chatId, 'Использование: /status <номер_заявки>\nПример: /status SR-12345');
        return;
    }

    try {
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
             where sr.number ilike $1
             limit 1`,
            [number]
        );

        if (result.rows.length === 0) {
            await bot.sendMessage(chatId, `❌ Заявка ${number} не найдена`);
            return;
        }

        const ticket = result.rows[0];
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
            medium: '🟡 Сре��ний',
            low: '⚪ Низкий',
        };

        const text = [
            `📋 Заявка ${ticket.number}`,
            '',
            `📝 ${ticket.title}`,
            `📊 Статус: ${statusLabels[ticket.status] || ticket.status}`,
            `⚡ Приоритет: ${priorityLabels[ticket.priority] || ticket.priority}`,
            ticket.tenant_name ? `🏢 Клиент: ${ticket.tenant_name}` : '',
            ticket.installation_address ? `📍 Адрес: ${ticket.installation_address}` : '',
            `📅 Создана: ${new Date(ticket.created_at).toLocaleString('ru-RU')}`,
        ].filter(Boolean).join('\n');

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔗 Открыть в системе', url: `${appConfig.appUrl}/service-requests/${ticket.id}` }
                ]
            ]
        };

        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
    } catch (error) {
        logger.error('Failed to get ticket status', { error: serializeError(error), number });
        await bot.sendMessage(chatId, '❌ Ошибка при получении статуса заявки');
    }
};

export const handleMyTicketsCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const userId = await getUserIdFromChatId(chatId);
    if (!userId) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    try {
        const result = await dbQuery(
            `select
                sr.id::text,
                sr.number,
                sr.title,
                sr.status,
                sr.priority,
                sr.created_at
             from service_requests sr
             where sr.assigned_to_user_id = $1::uuid
               and sr.status not in ('closed', 'cancelled')
             order by sr.created_at desc
             limit 10`,
            [userId]
        );

        if (result.rows.length === 0) {
            await bot.sendMessage(chatId, '📋 У вас нет активных заявок');
            return;
        }

        const statusLabels: Record<string, string> = {
            new: '🆕',
            triage: '🔍',
            assigned: '👤',
            in_progress: '⚙️',
            on_site: '📍',
            done: '✅',
        };

        const priorityLabels: Record<string, string> = {
            critical: '🔴',
            high: '🟠',
            medium: '🟡',
            low: '⚪',
        };

        let text = '📋 Ваши активные заявки:\n\n';
        const buttons = [];

        for (const ticket of result.rows) {
            const status = statusLabels[ticket.status] || '';
            const priority = priorityLabels[ticket.priority] || '';
            text += `${priority}${status} ${ticket.number}: ${ticket.title}\n`;
            buttons.push([
                { text: `${ticket.number}`, callback_data: `view_ticket:${ticket.id}` }
            ]);
        }

        const keyboard = { inline_keyboard: buttons };
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
    } catch (error) {
        logger.error('Failed to get user tickets', { error: serializeError(error), userId });
        await bot.sendMessage(chatId, '❌ Ошибка при получении списка заявок');
    }
};

export const handleCreateCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const userId = await getUserIdFromChatId(chatId);
    if (!userId) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    setConversationState(chatId, userId, 'awaiting_ticket_title');
    await bot.sendMessage(chatId, '📝 Создание новой заявки\n\nВведите название заявки:');
};

export const handleSearchCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const userId = await getUserIdFromChatId(chatId);
    if (!userId) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    const args = normalizeText(message?.text).split(/\s+/).slice(1);
    const query = args.join(' ');

    if (!query) {
        setConversationState(chatId, userId, 'awaiting_search_query');
        await bot.sendMessage(chatId, '🔍 Введите поисковый запрос:');
        return;
    }

    try {
        const result = await dbQuery(
            `select
                sr.id::text,
                sr.number,
                sr.title,
                sr.status,
                sr.priority
             from service_requests sr
             where (sr.number ilike $1 or sr.title ilike $1 or sr.description ilike $1)
             order by sr.created_at desc
             limit 10`,
            [`%${query}%`]
        );

        if (result.rows.length === 0) {
            await bot.sendMessage(chatId, `🔍 По запросу "${query}" ничего не найдено`);
            return;
        }

        const statusLabels: Record<string, string> = {
            new: '🆕',
            triage: '🔍',
            assigned: '👤',
            in_progress: '⚙️',
            on_site: '📍',
            done: '✅',
            closed: '🔒',
            cancelled: '❌',
        };

        let text = `🔍 Результаты поиска по "${query}":\n\n`;
        const buttons = [];

        for (const ticket of result.rows) {
            const status = statusLabels[ticket.status] || '';
            text += `${status} ${ticket.number}: ${ticket.title}\n`;
            buttons.push([
                { text: `${ticket.number}`, callback_data: `view_ticket:${ticket.id}` }
            ]);
        }

        const keyboard = { inline_keyboard: buttons };
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
    } catch (error) {
        logger.error('Failed to search tickets', { error: serializeError(error), query });
        await bot.sendMessage(chatId, '❌ Ошибка при поиске заявок');
    }
};

export const handleLinkCommand = async (bot: TelegramBotClient, message: TelegramMessage, token: string) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const normalizedToken = normalizeText(token).toUpperCase();
    if (!normalizedToken) {
        await bot.sendMessage(chatId, 'Использование: /link <код>\nПолучите код в веб-интерфейсе системы');
        return;
    }

    try {
        const tokenResult = await dbQuery(
            `select
                t.id::text as token_id,
                t.user_id::text as user_id,
                coalesce(u.full_name, '') as full_name,
                u.role::text as role
             from telegram_link_tokens t
             join app_users u on u.id = t.user_id
             where t.token = $1
               and t.used_at is null
               and t.expires_at > now()
             limit 1`,
            [normalizedToken]
        );

        if (tokenResult.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ Неверный или истекший код. Получите новый код в системе.');
            return;
        }

        const tokenData = tokenResult.rows[0];
        await dbQuery(
            `update app_users
             set telegram_chat_id = $1
             where id = $2::uuid`,
            [String(chatId), tokenData.user_id]
        );

        await dbQuery(
            `update telegram_link_tokens
             set used_at = now()
             where id = $1::uuid`,
            [tokenData.token_id]
        );

        await bot.sendMessage(
            chatId,
            `✅ Аккаунт успешно привязан!\n\nПривет, ${tokenData.full_name}!\n\nТеперь вы будете получать уведомления в Telegram.\n\nИспользуйте /help для списка команд.`
        );
    } catch (error) {
        logger.error('Failed to link account', { error: serializeError(error), token: normalizedToken });
        await bot.sendMessage(chatId, '❌ Ошибка при привязке аккаунта');
    }
};

export const handleUnlinkCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    const userId = await getUserIdFromChatId(chatId);
    if (!userId) {
        await bot.sendMessage(chatId, '❌ Ваш аккаунт не привязан');
        return;
    }

    try {
        await dbQuery(
            `update app_users
             set telegram_chat_id = null
             where id = $1::uuid`,
            [userId]
        );

        await bot.sendMessage(chatId, '✅ Аккаунт отвязан. Уведомления больше не будут приходить в Telegram.');
    } catch (error) {
        logger.error('Failed to unlink account', { error: serializeError(error), userId });
        await bot.sendMessage(chatId, '❌ Ошибка при отвязке аккаунта');
    }
};

// Handle conversation state messages
export const handleConversationMessage = async (bot: TelegramBotClient, message: TelegramMessage): Promise<boolean> => {
    const chatId = message?.chat?.id;
    if (!chatId) return false;

    const state = getConversationState(chatId);
    if (!state) return false;

    const text = normalizeText(message?.text);
    if (!text) return false;

    try {
        if (state.state === 'awaiting_ticket_title') {
            setConversationState(chatId, state.userId, 'awaiting_ticket_description', { title: text });
            await bot.sendMessage(chatId, '📝 Введите описание заявки:');
            return true;
        }

        if (state.state === 'awaiting_ticket_description') {
            const title = state.context?.title as string;

            // Create ticket
            const result = await dbQuery(
                `insert into service_requests (
                    tenant_id,
                    title,
                    description,
                    status,
                    priority,
                    created_by_user_id,
                    assigned_to_user_id
                )
                select
                    (select id from tenants limit 1),
                    $1,
                    $2,
                    'new',
                    'medium',
                    $3::uuid,
                    $3::uuid
                returning id::text, number`,
                [title, text, state.userId]
            );

            const ticket = result.rows[0];
            clearConversationState(chatId);

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔗 Открыть в системе', url: `${appConfig.appUrl}/service-requests/${ticket.id}` }
                    ]
                ]
            };

            await bot.sendMessage(
                chatId,
                `✅ Заявка ${ticket.number} создана!\n\n📝 ${title}\n\n${text}`,
                { reply_markup: keyboard }
            );
            return true;
        }

        if (state.state === 'awaiting_search_query') {
            clearConversationState(chatId);
            // Reuse search command handler
            const searchMessage = { ...message, text: `/search ${text}` };
            await handleSearchCommand(bot, searchMessage);
            return true;
        }
    } catch (error) {
        logger.error('Failed to handle conversation message', { error: serializeError(error), state: state.state });
        clearConversationState(chatId);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте снова.');
        return true;
    }

    return false;
};

// Set bot commands menu
export const setBotCommands = async (bot: TelegramBotClient) => {
    try {
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
        logger.info('Bot commands menu set successfully');
    } catch (error) {
        logger.error('Failed to set bot commands', { error: serializeError(error) });
    }
};
