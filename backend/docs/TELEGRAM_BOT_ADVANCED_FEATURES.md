# Telegram Bot Advanced Features

This document describes the advanced Telegram bot features implemented for the Novinzhstroy system.

## Features Implemented

### 1. Bot Commands

The following commands are now available:

- `/start` - Welcome message and bot introduction with deep linking support
- `/help` - Display all available commands
- `/status <number>` - Get status of a service request by number
- `/mytickets` - List all active tickets assigned to the user
- `/create` - Create a new service request (interactive)
- `/search <query>` - Search for service requests
- `/link <code>` - Link Telegram account to system account
- `/unlink` - Unlink Telegram account

#### Deep Linking

The `/start` command supports deep linking:
- `/start ticket_SR-12345` - Opens specific ticket
- `/start link_ABC123` - Auto-links account with token

### 2. Command Menu

Bot commands are automatically registered with Telegram, appearing in the command menu when users type `/`.

### 3. Conversation State Management

The bot maintains conversation state for multi-step interactions:

- **Ticket Creation Flow**:
  1. User sends `/create`
  2. Bot asks for title
  3. User provides title
  4. Bot asks for description
  5. User provides description
  6. Bot creates ticket and confirms

- **Search Flow**:
  1. User sends `/search` without query
  2. Bot asks for search query
  3. User provides query
  4. Bot displays results

Conversation states automatically expire after 10 minutes.

### 4. Inline Mode

Users can search and share tickets from any chat using inline mode:

```
@NovinzhstroyBot search query
```

Features:
- Search across all service requests
- Quick access to recent tickets
- Share ticket information in any chat
- Create new ticket shortcut

### 5. Webhooks

The bot supports webhook mode instead of polling for better performance and reliability.

#### Configuration

Set environment variables:
```bash
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook/telegram
TELEGRAM_WEBHOOK_SECRET=your-secret-token
```

#### Features

- **Webhook Verification**: Requests are verified using HMAC-SHA256 signature
- **Retry Logic**: Failed updates are retried with exponential backoff (1s, 5s, 15s, 60s)
- **Health Monitoring**: Automatic webhook health checks every minute
- **Graceful Fallback**: Falls back to polling if webhook setup fails

#### Endpoints

- `POST /webhook/telegram` - Webhook endpoint for Telegram updates
- `GET /webhook/telegram/health` - Health check endpoint

### 6. Telegram Mini App Support

The bot includes support for Telegram Web Apps (Mini Apps):

- Web App buttons in inline keyboards
- Deep linking to web interface
- Authentication flow integration

## File Structure

```
backend/src/
├── services/
│   ├── telegramBotCommands.ts      # Command handlers and conversation state
│   ├── telegramInlineMode.ts       # Inline query handlers
│   ├── telegramWebhooks.ts         # Webhook management and health monitoring
│   └── telegramBot.ts              # Main bot initialization (updated)
├── routes/
│   └── telegramWebhook.ts          # Webhook route handlers
└── tests/
    ├── telegram-bot-commands.test.ts
    ├── telegram-inline-mode.test.ts
    └── telegram-webhooks.test.ts
```

## Usage Examples

### Creating a Ticket via Bot

1. Send `/create` to the bot
2. Bot: "Введите название заявки:"
3. User: "Broken fire alarm"
4. Bot: "Введите описание заявки:"
5. User: "Fire alarm in building A is not working"
6. Bot creates ticket and provides link

### Searching via Inline Mode

In any chat, type:
```
@NovinzhstroyBot fire alarm
```

Bot shows matching tickets that can be shared in the chat.

### Deep Linking

Share a link like:
```
https://t.me/NovinzhstroyBot?start=ticket_SR-12345
```

When user clicks, bot opens and displays ticket SR-12345.

## Configuration

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_BOT_ENABLED=true

# Optional - Webhook Mode
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook/telegram
TELEGRAM_WEBHOOK_SECRET=your-secret-token

# Optional - Bot Settings
TELEGRAM_BOT_USERNAME=NovinzhstroyBot
TELEGRAM_LINK_SECRET=your-link-secret
```

### Switching Between Polling and Webhook

**Polling Mode** (default):
- No additional configuration needed
- Bot polls Telegram servers for updates
- Good for development

**Webhook Mode**:
- Set `TELEGRAM_WEBHOOK_URL` environment variable
- Bot automatically switches to webhook mode
- Better for production (lower latency, more reliable)

## Security

### Webhook Verification

All webhook requests are verified using HMAC-SHA256:
1. Telegram sends `X-Telegram-Bot-Api-Secret-Token` header
2. Server verifies signature matches expected value
3. Invalid signatures are rejected with 401 Unauthorized

### Account Linking

1. User requests link token in web interface
2. Token expires after 10 minutes
3. Token can only be used once
4. User sends `/link <token>` to bot
5. Bot verifies token and links account

## Monitoring

### Webhook Health

The system automatically monitors webhook health:
- Checks pending update count
- Detects connection errors
- Logs warnings for unhealthy webhooks

Access health status:
```bash
curl https://your-domain.com/webhook/telegram/health
```

### Logs

All bot operations are logged:
- Command executions
- Inline queries
- Webhook updates
- Errors and retries

## Testing

Run tests:
```bash
npm test
```

Test files:
- `telegram-bot-commands.test.ts` - Command handlers
- `telegram-inline-mode.test.ts` - Inline mode
- `telegram-webhooks.test.ts` - Webhook functionality

## Troubleshooting

### Bot Not Responding

1. Check bot is enabled: `TELEGRAM_BOT_ENABLED=true`
2. Verify token is correct: `TELEGRAM_BOT_TOKEN`
3. Check logs for errors
4. Verify webhook URL is accessible (if using webhooks)

### Webhook Not Working

1. Verify URL is HTTPS (required by Telegram)
2. Check webhook secret is set
3. Verify server is accessible from internet
4. Check webhook health endpoint
5. Review webhook info: Bot API `getWebhookInfo`

### Commands Not Appearing in Menu

Commands are set automatically on bot startup. If not appearing:
1. Restart bot
2. Check logs for "Bot commands menu set successfully"
3. Clear Telegram cache (restart Telegram app)

### Inline Mode Not Working

1. Verify bot username is correct
2. Check user account is linked
3. Ensure inline mode is enabled in BotFather
4. Check logs for inline query errors

## Future Enhancements

Possible improvements:
- Photo/document attachment to tickets
- Location-based check-ins
- Push notifications for ticket updates
- Multi-language support
- Voice message transcription
- Ticket assignment via bot
- Status change workflows
- Scheduled reports via bot

## API Reference

### TelegramBotCommands

```typescript
// Handle start command with deep linking
handleStartCommand(bot: TelegramBotClient, message: TelegramMessage): Promise<void>

// Handle help command
handleHelpCommand(bot: TelegramBotClient, message: TelegramMessage): Promise<void>

// Handle status query
handleStatusCommand(bot: TelegramBotClient, message: TelegramMessage, ticketNumber?: string): Promise<void>

// Handle my tickets list
handleMyTicketsCommand(bot: TelegramBotClient, message: TelegramMessage): Promise<void>

// Handle ticket creation
handleCreateCommand(bot: TelegramBotClient, message: TelegramMessage): Promise<void>

// Handle search
handleSearchCommand(bot: TelegramBotClient, message: TelegramMessage): Promise<void>

// Handle account linking
handleLinkCommand(bot: TelegramBotClient, message: TelegramMessage, token: string): Promise<void>

// Handle account unlinking
handleUnlinkCommand(bot: TelegramBotClient, message: TelegramMessage): Promise<void>

// Handle conversation messages
handleConversationMessage(bot: TelegramBotClient, message: TelegramMessage): Promise<boolean>

// Set bot commands menu
setBotCommands(bot: TelegramBotClient): Promise<void>
```

### TelegramInlineMode

```typescript
// Handle inline query
handleInlineQuery(bot: TelegramBotClient, query: TelegramInlineQuery): Promise<void>

// Handle chosen inline result
handleChosenInlineResult(result: TelegramChosenInlineResult): Promise<void>

// Enable inline mode
enableInlineMode(bot: TelegramBotClient): Promise<void>
```

### TelegramWebhooks

```typescript
// Generate webhook secret
generateWebhookSecret(): string

// Verify webhook signature
verifyWebhookSignature(body: string, signature: string, secret: string): boolean

// Set webhook
setWebhook(bot: TelegramBotClient, webhookUrl: string, secret?: string): Promise<boolean>

// Delete webhook
deleteWebhook(bot: TelegramBotClient, dropPendingUpdates?: boolean): Promise<boolean>

// Get webhook info
getWebhookInfo(bot: TelegramBotClient): Promise<WebhookInfo | null>

// Check webhook health
checkWebhookHealth(bot: TelegramBotClient): Promise<WebhookHealthStatus>

// Process webhook update with retry
processWebhookUpdate(update: any, handler: (update: any) => Promise<void>, retryCount?: number): Promise<void>

// Initialize webhook mode
initializeWebhookMode(bot: TelegramBotClient): Promise<boolean>

// Validate webhook update
validateWebhookUpdate(update: any): boolean
```

## License

Part of the Novinzhstroy system.
