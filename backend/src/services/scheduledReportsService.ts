import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import {
  executeReport,
  getReportDefinition,
  exportReportToCsv,
  recordReportExecution,
  type ReportDefinition,
  type ScheduledReport,
} from './reportingService.js';
import { canSendEmails, sendEmail, sender } from './mailService.js';
import { pushTelegramNotification } from './telegramNotifier.js';
import { wrapEmailHtml } from '../helpers/emailTemplates.js';

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let schedulerRunning = false;

export const startScheduledReportsScheduler = () => {
  const runScheduler = async () => {
    if (schedulerRunning) {
      return;
    }

    schedulerRunning = true;
    try {
      await processScheduledReports();
    } catch (error) {
      logger.error('Scheduled reports scheduler failed', {
        error: serializeError(error),
      });
    } finally {
      schedulerRunning = false;
    }
  };

  // Run immediately on startup
  void runScheduler();

  // Then run periodically
  setInterval(() => {
    void runScheduler();
  }, SCHEDULER_INTERVAL_MS);

  logger.info('Scheduled reports scheduler started', {
    intervalMs: SCHEDULER_INTERVAL_MS,
  });
};

export const processScheduledReports = async () => {
  const result = await dbQuery(
    `select
      id::text,
      report_definition_id::text as "reportDefinitionId",
      name,
      schedule,
      delivery_method as "deliveryMethod",
      delivery_config as "deliveryConfig",
      recipient_ids::text[] as "recipientIds"
    from scheduled_reports
    where is_active = true
      and next_run_at <= now()
    limit 10`
  );

  const scheduledReports = result.rows as ScheduledReport[];

  logger.info('Processing scheduled reports', {
    count: scheduledReports.length,
  });

  for (const scheduledReport of scheduledReports) {
    await processScheduledReport(scheduledReport);
  }
};

const processScheduledReport = async (scheduledReport: ScheduledReport) => {
  const startTime = Date.now();

  try {
    logger.info('Processing scheduled report', {
      scheduledReportId: scheduledReport.id,
      name: scheduledReport.name,
    });

    // Get report definition
    const definition = await getReportDefinition(scheduledReport.reportDefinitionId);
    if (!definition) {
      logger.warn('Report definition not found for scheduled report', {
        scheduledReportId: scheduledReport.id,
        reportDefinitionId: scheduledReport.reportDefinitionId,
      });
      await updateScheduledReportNextRun(scheduledReport);
      return;
    }

    // Execute report
    const data = await executeReport(definition.entityType, definition.config);
    const executionTime = Date.now() - startTime;

    // Deliver report
    await deliverReport(scheduledReport, definition, data);

    // Record successful execution
    await recordReportExecution({
      scheduledReportId: scheduledReport.id,
      reportDefinitionId: definition.id,
      status: 'success',
      rowCount: data.length,
      executionTimeMs: executionTime,
    });

    // Update next run time
    await updateScheduledReportNextRun(scheduledReport);

    logger.info('Scheduled report processed successfully', {
      scheduledReportId: scheduledReport.id,
      rowCount: data.length,
      executionTime,
    });
  } catch (error) {
    logger.error('Failed to process scheduled report', {
      scheduledReportId: scheduledReport.id,
      error: serializeError(error),
    });

    // Record failed execution
    await recordReportExecution({
      scheduledReportId: scheduledReport.id,
      reportDefinitionId: scheduledReport.reportDefinitionId,
      status: 'failed',
      errorMessage: (error as Error).message,
      executionTimeMs: Date.now() - startTime,
    });

    // Still update next run time to avoid getting stuck
    await updateScheduledReportNextRun(scheduledReport);
  }
};

const deliverReport = async (
  scheduledReport: ScheduledReport,
  definition: ReportDefinition,
  data: any[]
) => {
  const { deliveryMethod, recipientIds } = scheduledReport;

  // Generate CSV for delivery
  const csvContent = exportReportToCsv(data);
  const csvBuffer = Buffer.from('\uFEFF' + csvContent, 'utf-8'); // Add BOM for Excel

  // Deliver via email
  if ((deliveryMethod === 'email' || deliveryMethod === 'both') && canSendEmails()) {
    await deliverReportViaEmail(scheduledReport, definition, data, csvBuffer);
  }

  // Deliver via Telegram
  if (deliveryMethod === 'telegram' || deliveryMethod === 'both') {
    await deliverReportViaTelegram(scheduledReport, definition, data);
  }
};

const deliverReportViaEmail = async (
  scheduledReport: ScheduledReport,
  definition: ReportDefinition,
  data: any[],
  csvBuffer: Buffer
) => {
  try {
    // Get recipient emails
    const recipients = await loadRecipientEmails(scheduledReport.recipientIds);

    if (recipients.length === 0) {
      logger.warn('No email recipients found for scheduled report', {
        scheduledReportId: scheduledReport.id,
      });
      return;
    }

    const subject = `Отчет: ${definition.name}`;
    const htmlBody = wrapEmailHtml(`
      <h2>${definition.name}</h2>
      ${definition.description ? `<p>${definition.description}</p>` : ''}
      <p>Отчет выполнен: ${new Date().toLocaleString('ru-RU')}</p>
      <p>Количество строк: ${data.length}</p>
      <p>Отчет прикреплен в формате CSV.</p>
    `);

    for (const recipient of recipients) {
      await sendEmail({
        to: recipient.email,
        from: sender,
        subject,
        text: `Отчет "${definition.name}" готов. Количество строк: ${data.length}`,
        html: htmlBody,
        attachments: [
          {
            filename: `${definition.name}_${Date.now()}.csv`,
            content: csvBuffer,
            contentType: 'text/csv',
          },
        ],
      });
    }

    logger.info('Report delivered via email', {
      scheduledReportId: scheduledReport.id,
      recipientCount: recipients.length,
    });
  } catch (error) {
    logger.error('Failed to deliver report via email', {
      scheduledReportId: scheduledReport.id,
      error: serializeError(error),
    });
  }
};

const deliverReportViaTelegram = async (
  scheduledReport: ScheduledReport,
  definition: ReportDefinition,
  data: any[]
) => {
  try {
    // Get recipient Telegram IDs
    const recipients = await loadRecipientTelegramIds(scheduledReport.recipientIds);

    if (recipients.length === 0) {
      logger.warn('No Telegram recipients found for scheduled report', {
        scheduledReportId: scheduledReport.id,
      });
      return;
    }

    const message = `📊 *${definition.name}*\n\n${
      definition.description ? `${definition.description}\n\n` : ''
    }Выполнен: ${new Date().toLocaleString('ru-RU')}\nСтрок: ${data.length}`;

    for (const recipient of recipients) {
      if (recipient.telegramChatId) {
        await pushTelegramNotification({
          chatId: recipient.telegramChatId,
          text: message,
        });
      }
    }

    logger.info('Report delivered via Telegram', {
      scheduledReportId: scheduledReport.id,
      recipientCount: recipients.length,
    });
  } catch (error) {
    logger.error('Failed to deliver report via Telegram', {
      scheduledReportId: scheduledReport.id,
      error: serializeError(error),
    });
  }
};

const loadRecipientEmails = async (recipientIds: string[]): Promise<Array<{ email: string }>> => {
  if (recipientIds.length === 0) {
    return [];
  }

  const result = await dbQuery(
    `select lower(trim(email)) as email
    from app_users
    where id = any($1::uuid[])
      and status::text = 'active'
      and coalesce(trim(email), '') <> ''`,
    [recipientIds]
  );

  return result.rows;
};

const loadRecipientTelegramIds = async (
  recipientIds: string[]
): Promise<Array<{ telegramChatId: string }>> => {
  if (recipientIds.length === 0) {
    return [];
  }

  const result = await dbQuery(
    `select telegram_chat_id::text as "telegramChatId"
    from app_users
    where id = any($1::uuid[])
      and status::text = 'active'
      and telegram_chat_id is not null`,
    [recipientIds]
  );

  return result.rows;
};

const updateScheduledReportNextRun = async (scheduledReport: ScheduledReport) => {
  const nextRunAt = calculateNextRunTime(scheduledReport.schedule);

  await dbQuery(
    `update scheduled_reports
    set last_run_at = now(),
        next_run_at = $2
    where id = $1::uuid`,
    [scheduledReport.id, nextRunAt]
  );
};

const calculateNextRunTime = (schedule: 'daily' | 'weekly' | 'monthly'): string => {
  const now = new Date();
  const next = new Date(now);

  switch (schedule) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      break;
    case 'weekly':
      next.setDate(next.getDate() + (7 - next.getDay() + 1)); // Next Monday
      next.setHours(9, 0, 0, 0);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      next.setDate(1);
      next.setHours(9, 0, 0, 0);
      break;
  }

  return next.toISOString();
};
