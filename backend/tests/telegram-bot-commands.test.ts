import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
    handleStartCommand,
    handleHelpCommand,
    handleStatusCommand,
    handleMyTicketsCommand,
    handleCreateCommand,
    handleSearchCommand,
    handleLinkCommand,
    handleUnlinkCommand,
    handleConversationMessage,
} from '../src/services/telegramBotCommands.js';

describe('Telegram Bot Commands', () => {
    const mockBot = {
        sendMessage: mock.fn(async () => ({ message_id: 1 })),
        answerCallbackQuery: mock.fn(async () => true),
        callApi: mock.fn(async () => true),
    };

    const mockMessage = {
        chat: { id: 12345 },
        text: '/start',
        message_id: 1,
    };

    it('should handle /start command', async () => {
        await handleStartCommand(mockBot as any, mockMessage);
        assert.strictEqual(mockBot.sendMessage.mock.calls.length, 1);
        const [chatId, text] = mockBot.sendMessage.mock.calls[0].arguments;
        assert.strictEqual(chatId, 12345);
        assert.ok(text.includes('Добро пожаловать'));
    });

    it('should handle /help command', async () => {
        mockBot.sendMessage.mock.resetCalls();
        await handleHelpCommand(mockBot as any, mockMessage);
        assert.strictEqual(mockBot.sendMessage.mock.calls.length, 1);
        const [chatId, text] = mockBot.sendMessage.mock.calls[0].arguments;
        assert.strictEqual(chatId, 12345);
        assert.ok(text.includes('Команды бота'));
    });

    it('should handle /start with deep link', async () => {
        mockBot.sendMessage.mock.resetCalls();
        const deepLinkMessage = {
            ...mockMessage,
            text: '/start ticket_SR-12345',
        };
        await handleStartCommand(mockBot as any, deepLinkMessage);
        assert.ok(mockBot.sendMessage.mock.calls.length >= 1);
    });

    it('should handle conversation state for ticket creation', async () => {
        mockBot.sendMessage.mock.resetCalls();
        const createMessage = { ...mockMessage, text: '/create' };
        await handleCreateCommand(mockBot as any, createMessage);
        assert.strictEqual(mockBot.sendMessage.mock.calls.length, 1);
        const [chatId, text] = mockBot.sendMessage.mock.calls[0].arguments;
        assert.ok(text.includes('Введите название'));
    });
});

describe('Telegram Bot Conversation State', () => {
    const mockBot = {
        sendMessage: mock.fn(async () => ({ message_id: 1 })),
    };

    it('should return false for non-conversation messages', async () => {
        const message = {
            chat: { id: 99999 },
            text: 'random text',
        };
        const handled = await handleConversationMessage(mockBot as any, message);
        assert.strictEqual(handled, false);
    });
});
