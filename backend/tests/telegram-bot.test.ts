import assert from 'node:assert/strict';
import test from 'node:test';

import { __telegramBotTestUtils } from '../src/services/telegramBot.ts';

const ids = {
  executor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  manager: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  request: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  plan: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

const linkedExecutor = {
  id: ids.executor,
  full_name: 'Executor User',
  email: 'executor@example.com',
  role: 'executor',
};

const linkedManager = {
  id: ids.manager,
  full_name: 'Manager User',
  email: 'manager@example.com',
  role: 'manager',
};

const createBotHarness = () => {
  const sentMessages: Array<{ chatId: number; text: string; options?: Record<string, unknown> }> = [];
  const answeredCallbacks: Array<{ id: string; options?: Record<string, unknown> }> = [];
  const editedMessages: Array<{ text: string; options?: Record<string, unknown> }> = [];
  const fileRequests: string[] = [];

  return {
    sentMessages,
    answeredCallbacks,
    editedMessages,
    fileRequests,
    bot: {
      async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
        sentMessages.push({ chatId, text, options });
        return { message_id: sentMessages.length };
      },
      async answerCallbackQuery(id: string, options?: Record<string, unknown>) {
        answeredCallbacks.push({ id, options });
        return true;
      },
      async editMessageText(text: string, options?: Record<string, unknown>) {
        editedMessages.push({ text, options });
        return true;
      },
      async getFile(fileId: string) {
        fileRequests.push(fileId);
        return { file_path: 'photos/probe.jpg' };
      },
    },
  };
};

const setupTelegramHarness = (
  t: any,
  queryFn: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>,
  overrides: Partial<Record<'storeFile' | 'fetchImpl', any>> = {},
) => {
  __telegramBotTestUtils.reset();
  const harness = createBotHarness();
  __telegramBotTestUtils.setBot(harness.bot as any);
  __telegramBotTestUtils.setDeps({
    queryFn,
    ...overrides,
  });
  t.after(() => {
    __telegramBotTestUtils.reset();
  });
  return harness;
};

test('Telegram /status resolves requests through actor scope before returning details', async (t) => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = setupTelegramHarness(t, async (text, values = []) => {
    queries.push({ text, values });
    if (/from app_users/i.test(text) && /telegram_chat_id = \$1/i.test(text)) {
      return { rows: [linkedExecutor] };
    }
    if (/from requests r/i.test(text)) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  await __telegramBotTestUtils.handleStatus({
    chat: { id: 101 },
  } as any, 'deadbeef');

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0].text, 'Заявка не найдена. Проверьте номер.');
  assert.equal(queries.length, 2);
  assert.match(queries[1].text, /app_user_direction_bindings/i);
  assert.deepEqual(queries[1].values, ['deadbeef', ids.executor]);
});

test('Telegram photo attachments refuse inaccessible requests before any file download or storage', async (t) => {
  let storeCalled = false;
  const harness = setupTelegramHarness(t, async (text) => {
    if (/from app_users/i.test(text) && /telegram_chat_id = \$1/i.test(text)) {
      return { rows: [linkedExecutor] };
    }
    if (/from requests r/i.test(text)) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  }, {
    storeFile: async () => {
      storeCalled = true;
      throw new Error('storeFile should not run when access is denied');
    },
  });

  const handled = await __telegramBotTestUtils.handlePhotoMessage({
    chat: { id: 101 },
    caption: '#заявка deadbeef',
    photo: [{ file_id: 'file-1' }],
  } as any);

  assert.equal(handled, true);
  assert.equal(storeCalled, false);
  assert.deepEqual(harness.fileRequests, []);
  assert.equal(harness.sentMessages.at(-1)?.text, 'Заявка не найдена. Формат: #заявка <номер>');
});

test('Telegram callback management actions stay restricted to higher-privilege roles', async (t) => {
  const nonUserQueries: Array<string> = [];
  const harness = setupTelegramHarness(t, async (text) => {
    if (/from app_users/i.test(text) && /telegram_chat_id = \$1/i.test(text)) {
      return { rows: [linkedExecutor] };
    }
    nonUserQueries.push(text);
    throw new Error(`Unexpected non-user query: ${text}`);
  });

  for (const data of ['action:assign:deadbeef', 'action:confirm_plan:feedbeef']) {
    await __telegramBotTestUtils.handleCallbackQuery({
      id: `query-${data}`,
      data,
      message: {
        message_id: 1,
        chat: { id: 101 },
        text: 'Action',
      },
    } as any);
  }

  assert.equal(nonUserQueries.length, 0);
  assert.deepEqual(
    harness.answeredCallbacks.map((entry) => entry.options?.text),
    ['Недостаточно прав', 'Недостаточно прав'],
  );
});

test('Telegram status callbacks reject invalid terminal jumps before opening a completion flow', async (t) => {
  const harness = setupTelegramHarness(t, async (text) => {
    if (/from app_users/i.test(text) && /telegram_chat_id = \$1/i.test(text)) {
      return { rows: [linkedExecutor] };
    }
    if (/from requests r/i.test(text)) {
      return {
        rows: [{
          id: ids.request,
          title: 'Scoped request',
          description: '',
          type: 'emergency',
          system_type: '',
          priority: 'medium',
          status: 'assigned',
          executor_ids: [ids.executor],
          created_by_id: '',
          created_at: '2099-01-01T00:00:00.000Z',
          updated_at: '2099-01-01T00:00:00.000Z',
          due_date_preliminary: null,
        }],
      };
    }
    if (/update requests/i.test(text)) {
      throw new Error('status update should not execute for an invalid transition');
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  await __telegramBotTestUtils.handleCallbackQuery({
    id: 'query-status',
    data: 'action:status:deadbeef:done',
    message: {
      message_id: 7,
      chat: { id: 101 },
      text: 'Статус',
    },
  } as any);

  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.answeredCallbacks.at(-1)?.options?.text, 'Недопустимый переход статуса');
});

test('Telegram request callbacks re-check scoped access during the mutation query', async (t) => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = setupTelegramHarness(t, async (text, values = []) => {
    queries.push({ text, values });
    if (/from app_users/i.test(text) && /telegram_chat_id = \$1/i.test(text)) {
      return { rows: [linkedExecutor] };
    }
    if (/from requests r/i.test(text) && /order by r\.created_at desc/i.test(text)) {
      return {
        rows: [{
          id: ids.request,
          title: 'Scoped request',
          description: '',
          type: 'emergency',
          system_type: '',
          priority: 'medium',
          status: 'assigned',
          executor_ids: [ids.executor],
          created_by_id: '',
          created_at: '2099-01-01T00:00:00.000Z',
          updated_at: '2099-01-01T00:00:00.000Z',
          due_date_preliminary: null,
        }],
      };
    }
    if (/update requests r/i.test(text)) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  await __telegramBotTestUtils.handleCallbackQuery({
    id: 'query-take',
    data: 'action:take:deadbeef',
    message: {
      message_id: 11,
      chat: { id: 101 },
      text: 'Статус',
    },
  } as any);

  assert.equal(harness.editedMessages.length, 0);
  assert.equal(harness.answeredCallbacks.at(-1)?.options?.text, 'Заявка недоступна');
  assert.match(queries.at(-1)?.text ?? '', /update requests r/i);
  assert.match(queries.at(-1)?.text ?? '', /executor_ids|created_by_id|curator_id/i);
  assert.deepEqual(queries.at(-1)?.values, [ids.request, ids.executor, ids.executor]);
});

test('Telegram plan callbacks re-check scoped access during confirmation writes', async (t) => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const harness = setupTelegramHarness(t, async (text, values = []) => {
    queries.push({ text, values });
    if (/from app_users/i.test(text) && /telegram_chat_id = \$1/i.test(text)) {
      return { rows: [linkedManager] };
    }
    if (/from maintenance_plans mp/i.test(text) && /order by mp\.created_at desc/i.test(text)) {
      return {
        rows: [{
          id: ids.plan,
          system_type: 'aps',
          valid_from: null,
          valid_to: null,
          contact_person: 'Client',
          contact_phone: '+7',
        }],
      };
    }
    if (/insert into maintenance_plan_confirmations/i.test(text)) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  await __telegramBotTestUtils.handleCallbackQuery({
    id: 'query-plan-confirm',
    data: 'action:confirm_plan:feedbeef',
    message: {
      message_id: 15,
      chat: { id: 202 },
      text: 'План ТО',
    },
  } as any);

  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.editedMessages.length, 0);
  assert.equal(harness.answeredCallbacks.at(-1)?.options?.text, 'План ТО недоступен');
  assert.match(queries.at(-1)?.text ?? '', /insert into maintenance_plan_confirmations/i);
  assert.match(queries.at(-1)?.text ?? '', /from maintenance_plans mp/i);
  assert.deepEqual(queries.at(-1)?.values?.slice(0, 1), [ids.plan]);
});
