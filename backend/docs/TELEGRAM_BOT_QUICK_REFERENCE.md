# Telegram Bot Advanced Features - Quick Reference

## Quick Start

### Enable Webhook Mode

```bash
# .env
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook/telegram
TELEGRAM_WEBHOOK_SECRET=your-secret-token
```

### Enable Polling Mode (Default)

```bash
# .env
# Just don't set TELEGRAM_WEBHOOK_URL
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=your-token
```

## Command Usage

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Welcome message | `/start` |
| `/start ticket_SR-123` | Open specific ticket | Deep link |
| `/help` | Show all commands | `/help` |
| `/status SR-123` | Get ticket status | `/status SR-12345` |
| `/mytickets` | List my tickets | `/mytickets` |
| `/create` | Create new ticket | `/create` (interactive) |
| `/search query` | Search tickets | `/search fire alarm` |
| `/link ABC123` | Link account | `/link ABC123` |
| `/unlink` | Unlink account | `/unlink` |

## Inline Mode

```
@NovinzhstroyBot search query
```

Use in any chat to search and share tickets.

## API Endpoints

- `POST /webhook/telegram` - Webhook endpoint
- `GET /webhook/telegram/health` - Health check

## Code Examples

### Add New Command

```typescript
// In telegramBotCommands.ts
export const handleMyCommand = async (bot: TelegramBotClient, message: TelegramMessage) => {
    const chatId = message?.chat?.id;
    if (!chatId) return;

    await bot.sendMessage(chatId, 'Response text');
};

// In telegramBot.ts
bot.onText(/^\/mycommand(?:@\w+)?(?:\s+.*)?$/i, (message) => {
    void handleMyCommand(bot, message);
});
```

### Add Conversation State

```typescript
// Set state
setConversationState(chatId, userId, 'awaiting_input', { context: 'data' });

// Get state
const state = getConversationState(chatId);

// Clear state
clearConversationState(chatId);
```

### Check Webhook Health

```typescript
import { checkWebhookHealth } from './services/telegramWebhooks.js';

const health = await checkWebhookHealth(bot);
console.log(health.isHealthy, health.pendingUpdates);
```

## Troubleshooting

### Bot not responding
1. Check `TELEGRAM_BOT_ENABLED=true`
2. Verify token is correct
3. Check logs for errors

### Webhook not working
1. Ensure URL is HTTPS
2. Check webhook secret is set
3. Verify server is accessible
4. Check health endpoint

### Commands not in menu
1. Restart bot
2. Check logs for "Bot commands menu set successfully"
3. Clear Telegram cache

## Files Reference

- **Commands**: `src/services/telegramBotCommands.ts`
- **Inline Mode**: `src/services/telegramInlineMode.ts`
- **Webhooks**: `src/services/telegramWebhooks.ts`
- **Routes**: `src/routes/telegramWebhook.ts`
- **Main Bot**: `src/services/telegramBot.ts`
- **Tests**: `tests/telegram-*.test.ts`
- **Docs**: `docs/TELEGRAM_BOT_ADVANCED_FEATURES.md`

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_BOT_ENABLED=true

# Optional - Webhook
TELEGRAM_WEBHOOK_URL=https://domain.com/webhook/telegram
TELEGRAM_WEBHOOK_SECRET=secret-token

# Optional - Settings
TELEGRAM_BOT_USERNAME=NovinzhstroyBot
TELEGRAM_LINK_SECRET=link-secret
```

## Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- tests/telegram-bot-commands.test.ts
```

## Monitoring

```bash
# Check webhook health
curl https://your-domain.com/webhook/telegram/health

# Check bot logs
tail -f logs/app.log | grep -i telegram
```
