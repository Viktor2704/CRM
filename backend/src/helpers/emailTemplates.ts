import { smtpSendMail, sender, canSendEmails } from '../services/mailService.js';
import { escapeHtml, isEmailValue, normalizeText } from './normalize.js';
import { callLLM } from '../services/aiService.js';
import { logger } from '../logger.js';
import { appConfig } from '../config.js';
import { createHash } from 'node:crypto';

const AI_ENHANCE_CACHE_TTL_MS = 10 * 60 * 1000;
const AI_ENHANCE_CACHE_MAX_SIZE = 500;
const AI_ENHANCE_MIN_DESCRIPTION_CHARS = 20;
const EMAIL_FOOTER_YEAR = new Date().getFullYear();
const aiEnhanceCache = new Map<string, { value: string; expiresAt: number }>();
const SERVICE_REQUEST_STATUS_LABELS: Record<string, string> = {
    new: 'Новая',
    triage: 'На разборе',
    assigned: 'Назначена',
    in_progress: 'В работе',
    review: 'На проверке',
    done: 'Выполнена',
    closed: 'Закрыта',
    cancelled: 'Отменена',
    paused: 'Приостановлена',
};

const pruneAiEnhanceCache = () => {
    const now = Date.now();
    for (const [key, entry] of aiEnhanceCache.entries()) {
        if (entry.expiresAt <= now) {
            aiEnhanceCache.delete(key);
        }
    }
    if (aiEnhanceCache.size <= AI_ENHANCE_CACHE_MAX_SIZE) {
        return;
    }
    const overflow = aiEnhanceCache.size - AI_ENHANCE_CACHE_MAX_SIZE;
    const keys = Array.from(aiEnhanceCache.keys());
    for (let index = 0; index < overflow; index += 1) {
        aiEnhanceCache.delete(keys[index]);
    }
};

const buildAiEnhanceCacheKey = (profile: string, subject: string, description: string): string => {
    const digest = createHash('sha256')
        .update(profile)
        .update('\n')
        .update(subject)
        .update('\n')
        .update(description)
        .digest('hex');
    return `${profile}:${digest}`;
};

const getCachedAiEnhancement = (key: string): string | null => {
    const entry = aiEnhanceCache.get(key);
    if (!entry) {
        return null;
    }
    if (entry.expiresAt <= Date.now()) {
        aiEnhanceCache.delete(key);
        return null;
    }
    return entry.value;
};

const setCachedAiEnhancement = (key: string, value: string): void => {
    aiEnhanceCache.set(key, {
        value,
        expiresAt: Date.now() + AI_ENHANCE_CACHE_TTL_MS,
    });
    pruneAiEnhanceCache();
};

const AI_EMAIL_SYSTEM_PROMPT = `Ты — технический эксперт управляющей компании "Новинжстрой" по обслуживанию систем безопасности (АПС, СОУЭ, АУПТ, ВПВ, СКУД, СВН, огнетушители и др.).

Твоя задача — на основе описания заявки составить профессиональную структурированную инструкцию по выполнению работ.

Формат ответа:
1. Краткое описание работ (1-2 предложения)
2. Перечень работ по шагам (нумерованный список)
3. Нормативные требования (ГОСТ, СП, НПБ — только если уместны)
4. Меры безопасности (если применимо)

Правила:
- Только русский язык
- Конкретные технические действия, без воды
- Максимум 300 слов
- Отвечай только готовым текстом инструкции, без вводных фраз типа "Вот инструкция:"
- Если описание слишком короткое или неинформативное — улучши и структурируй то что есть`;

export const enhanceDescriptionWithAI = async (description: string, subject: string): Promise<string> => {
    if (!description) return description;
    if (description.trim().length < AI_ENHANCE_MIN_DESCRIPTION_CHARS) return description;
    if (!appConfig.aiEnabled) return description;
    const cacheKey = buildAiEnhanceCacheKey('default', subject, description);
    const cached = getCachedAiEnhancement(cacheKey);
    if (cached) return cached;
    try {
        const result = await callLLM(
            AI_EMAIL_SYSTEM_PROMPT,
            `Тема заявки: ${subject}\n\nОписание работ:\n${description}`,
            { timeoutMs: 5000, maxTokens: 512, temperature: 0.3 }
        );
        const resolved = normalizeText(result) || description;
        setCachedAiEnhancement(cacheKey, resolved);
        return resolved;
    } catch {
        return description;
    }
};

const AI_EXECUTOR_INSTRUCTION_PROMPT = `Ты — технический эксперт управляющей компании "Новинжстрой" по обслуживанию систем безопасности (АПС, СОУЭ, АУПТ, ВПВ, СКУД, СВН, огнетушители и др.).

Составь подробную инструкцию для исполнителя (инженера/техника) по выполнению работ.

Формат ответа:
1. Краткое описание задачи (1-2 предложения)
2. Пошаговый порядок работ (нумерованный список, конкретные действия)
3. Нормативные документы — обязательно укажи применимые:
   - ГОСТ Р 59638-2021 (системы пожарной сигнализации)
   - СП 484.1311500.2020 (проектирование и монтаж СПС)
   - СП 486.1311500.2020 (перечень зданий с АУПТ)
   - СП 485.1311500.2020 (установки пожаротушения)
   - СП 3.13130.2009 (СОУЭ)
   - СП 10.13130.2020 (ВПВ)
   - СП 9.13130.2009 (огнетушители)
   - ГОСТ 12.4.009-83 (средства пожаротушения)
   - НПБ 88-2001 (установки пожаротушения и сигнализации)
   - Р 78.36.002-2010 (СКУД)
   - ГОСТ Р 51241-2008 (СКУД)
   - ГОСТ Р 51558-2014 (СВН)
   Указывай только те, которые реально относятся к данной работе.
4. Необходимые инструменты и материалы (если очевидно из контекста)
5. Меры безопасности (если применимо)

Правила:
- Только русский язык
- Конкретные технические действия, без воды
- Максимум 400 слов
- Отвечай только готовым текстом инструкции
- Если описание короткое — додумай типовой порядок работ для данного типа системы`;

const AI_CLIENT_DESCRIPTION_PROMPT = `Ты — представитель управляющей компании "Новинжстрой", пишешь клиенту (заказчику) о работах по его заявке.

Составь понятное описание для клиента: что будет сделано, зачем это нужно, какие нормативы требуют этих работ.

Формат ответа:
1. Что будет сделано (простым языком, 2-3 предложения)
2. Зачем это нужно (безопасность, требования законодательства, надёжность)
3. Нормативное основание — укажи применимые документы понятным языком:
   - Например: "согласно СП 484.1311500.2020 (правила проектирования систем пожарной сигнализации)"
   - Или: "в соответствии с ГОСТ Р 59638-2021 (требования к системам ПС)"
   Указывай только реально относящиеся к работе документы, с кратким пояснением что это за документ.
4. Ожидаемый результат (1 предложение)

Правила:
- Только русский язык
- Простой понятный язык, без технического жаргона
- Максимум 200 слов
- Отвечай только готовым текстом описания
- Тон: профессиональный, уважительный, вызывающий доверие`;

export const enhanceForExecutor = async (description: string, subject: string): Promise<string> => {
    if (!description) return description;
    if (description.trim().length < AI_ENHANCE_MIN_DESCRIPTION_CHARS) return description;
    if (!appConfig.aiEnabled) return description;
    const cacheKey = buildAiEnhanceCacheKey('executor', subject, description);
    const cached = getCachedAiEnhancement(cacheKey);
    if (cached) return cached;
    try {
        const result = await callLLM(
            AI_EXECUTOR_INSTRUCTION_PROMPT,
            `Тема заявки: ${subject}\n\nОписание работ:\n${description}`,
            { timeoutMs: 8000, maxTokens: 768, temperature: 0.3 }
        );
        const resolved = normalizeText(result) || description;
        setCachedAiEnhancement(cacheKey, resolved);
        return resolved;
    } catch {
        return description;
    }
};

export const enhanceForClient = async (description: string, subject: string): Promise<string> => {
    if (!description) return description;
    if (description.trim().length < AI_ENHANCE_MIN_DESCRIPTION_CHARS) return description;
    if (!appConfig.aiEnabled) return description;
    const cacheKey = buildAiEnhanceCacheKey('client', subject, description);
    const cached = getCachedAiEnhancement(cacheKey);
    if (cached) return cached;
    try {
        const result = await callLLM(
            AI_CLIENT_DESCRIPTION_PROMPT,
            `Тема заявки: ${subject}\n\nОписание работ:\n${description}`,
            { timeoutMs: 6000, maxTokens: 512, temperature: 0.3 }
        );
        const resolved = normalizeText(result) || description;
        setCachedAiEnhancement(cacheKey, resolved);
        return resolved;
    } catch {
        return description;
    }
};

export const wrapEmailHtml = (bodyHtml: string, options?: { preheader?: string }) => {
    const preheader = options?.preheader || '';
    const preheaderHtml = preheader
        ? `<div style="display:none;font-size:1px;color:#f1f1f1;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}${'&zwnj;&nbsp;'.repeat(30)}</div>`
        : '';
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <style>
    @media only screen and (max-width: 680px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-body { padding: 24px 20px !important; font-size: 15px !important; }
      .email-header { padding: 22px 20px !important; }
      .email-footer { padding: 20px !important; }
      .email-footer-inner td { display: block !important; text-align: center !important; padding: 4px 0 !important; }
      .email-btn { display: block !important; width: 100% !important; margin: 8px 0 !important; box-sizing: border-box !important; }
      .email-topline { border-radius: 14px 14px 0 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#E7ECF3;background-image:linear-gradient(180deg,#F9FBFF 0%,#E7ECF3 100%);-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  ${preheaderHtml}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:transparent;">
    <tr>
      <td align="center" style="padding:34px 16px;">
        <table role="presentation" class="email-container" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #DCE3EE;box-shadow:0 12px 36px rgba(15,23,42,0.14);">
          <tr>
            <td class="email-topline" style="height:5px;background:#e11d48;background-image:linear-gradient(90deg,#e11d48,#f43f5e,#fb7185);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Header -->
          <tr>
            <td class="email-header" style="background:#0f172a;background-image:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:30px 36px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="color:#FFFFFF;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:4px;line-height:1.2;">НОВИНЖСТРОЙ</div>
                    <div style="color:#94a3b8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.4px;margin-top:5px;">Инженерные системы безопасности</div>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <div style="display:inline-block;padding:9px 12px;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.26);border-radius:999px;color:#FFFFFF;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">Официально</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="email-body" style="padding:36px 40px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1E293B;font-size:15px;line-height:1.72;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(to right,transparent,#CBD5E1 20%,#CBD5E1 80%,transparent);"></div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="email-footer" style="padding:24px 40px 30px;background:#f8fafc;">
              <table role="presentation" class="email-footer-inner" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#64748B;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.62;">
                    <strong style="color:#334155;font-size:13px;">ООО «Новинжстрой»</strong><br/>
                    <a href="tel:+74959220701" style="color:#64748B;text-decoration:none;">+7 (495) 922-07-01</a><br/>
                    <a href="mailto:info@novinzhstroy.ru" style="color:#64748B;text-decoration:none;">info@novinzhstroy.ru</a>
                  </td>
                  <td align="right" style="vertical-align:bottom;color:#94A3B8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.58;">
                    &copy; ${EMAIL_FOOTER_YEAR} Новинжстрой. Все права защищены.<br/>
                    <span style="display:inline-block;margin-top:4px;padding:3px 8px;border-radius:999px;background:#EBF1F9;border:1px solid #D7E1EE;">
                      <a href="https://novinzhstroy.ru" style="color:#64748B;text-decoration:none;">novinzhstroy.ru</a>
                    </span>
                  </td>
                </tr>
              </table>
              <p style="margin:13px 0 0;color:#94A3B8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;">Это автоматическое уведомление. Пожалуйста, не отвечайте на это письмо.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const emailButton = (href: string, label: string, color = '#e11d48') =>
    `<a href="${escapeHtml(href)}" class="email-btn" style="display:inline-block;min-width:188px;padding:16px 32px;background:linear-gradient(135deg,${color} 0%,${color === '#e11d48' ? '#be123c' : color} 100%);color:#FFFFFF;text-decoration:none;border-radius:12px;font-weight:600;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;letter-spacing:0.3px;line-height:1.2;text-align:center;box-shadow:0 4px 14px rgba(225,29,72,0.35);margin:6px 4px;">${escapeHtml(label)}</a>`;

export const emailButtonOutline = (href: string, label: string, color = '#e11d48') =>
    `<a href="${escapeHtml(href)}" class="email-btn" style="display:inline-block;min-width:188px;padding:16px 32px;background:transparent;color:${color};border:2px solid ${color};text-decoration:none;border-radius:12px;font-weight:600;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:15px;letter-spacing:0.3px;line-height:1.2;text-align:center;margin:6px 4px;">${escapeHtml(label)}</a>`;

export const emailButtonsRow = (buttons: string[]) =>
    buttons.length > 0
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:26px 0 8px;">${buttons.join(' ')}</td></tr></table>`
        : '';

export const emailStatusBadge = (label: string, bgColor = '#16a34a', textColor = '#FFFFFF', icon = '') =>
    `<span style="display:inline-block;padding:6px 14px;background:${bgColor};color:${textColor};border-radius:20px;font-weight:600;font-size:12px;letter-spacing:0.2px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;vertical-align:middle;">${icon ? `${icon} ` : '● '}${escapeHtml(label)}</span>`;

export const emailInfoCard = (content: string, accentColor = '#3b82f6') =>
    `<div style="background:#f0f9ff;border-left:4px solid ${accentColor};border-radius:12px;padding:20px 24px;margin:16px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#334155;font-size:14px;line-height:1.7;">${content}</div>`;

export const emailHighlightCard = (content: string) =>
    `<div style="background:#fff1f2;border-left:4px solid #e11d48;border-radius:12px;padding:20px 24px;margin:16px 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#9F1239;font-size:14px;line-height:1.7;">${content}</div>`;

export const emailSectionTitle = (title: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 12px;">
  <tr>
    <td style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#0F172A;padding-right:16px;white-space:nowrap;letter-spacing:0.2px;">${escapeHtml(title)}</td>
    <td style="width:100%;"><div style="height:1px;background:linear-gradient(to right,#CBD5E1,#E2E8F0);"></div></td>
  </tr>
</table>`;

export const emailKeyValue = (key: string, value: string) =>
    `<tr>
  <td style="padding:12px 16px 12px 0;color:#64748b;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;font-weight:500;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f1f5f9;">${escapeHtml(key)}</td>
  <td style="padding:12px 0;color:#1e293b;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${escapeHtml(value)}</td>
</tr>`;

export const emailKeyValueTable = (rows: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;border-collapse:collapse;">${rows}</table>`;

export const emailDivider = () =>
    `<div style="height:1px;background:linear-gradient(to right,transparent,#CBD5E1 20%,#CBD5E1 80%,transparent);margin:24px 0;"></div>`;

export const emailDueChange = (oldDue: string, newDue: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
  <tr><td style="padding:10px 16px 6px 16px;color:#64748B;font-size:13px;font-family:'Segoe UI',Arial,sans-serif;">Было</td><td style="padding:10px 16px 6px 0;text-decoration:line-through;color:#94A3B8;font-family:'Segoe UI',Arial,sans-serif;">${escapeHtml(oldDue)}</td></tr>
  <tr><td style="padding:6px 16px 10px 16px;color:#64748B;font-size:13px;font-family:'Segoe UI',Arial,sans-serif;">Стало</td><td style="padding:6px 16px 10px 0;font-weight:700;color:#DC2626;font-family:'Segoe UI',Arial,sans-serif;">${escapeHtml(newDue)}</td></tr>
</table>`;

export const emailTicketHeader = (ticketShortId: string, title: string) =>
    `<h2 style="margin:0 0 6px;color:#0F172A;font-size:22px;font-weight:800;font-family:'Segoe UI',Arial,sans-serif;letter-spacing:0.2px;">Заявка №${escapeHtml(ticketShortId)}</h2>
<p style="margin:0 0 20px;color:#64748B;font-size:14px;font-family:'Segoe UI',Arial,sans-serif;">${escapeHtml(title)}</p>`;

export const emailGreeting = (name: string) =>
    `<p style="margin:0 0 24px;color:#1e293b;font-size:16px;font-family:'Segoe UI',Arial,sans-serif;">Здравствуйте, ${escapeHtml(name)}!</p>`;

export const emailSignatureBlock = (signature: string) =>
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #E2E8F0;color:#64748B;font-size:13px;font-family:'Segoe UI',Arial,sans-serif;white-space:pre-line;">${escapeHtml(signature)}</div>`;

export const shortTicketId = (fullId: string) =>
    fullId && fullId.length > 8 ? fullId.slice(0, 8) : fullId;

const localizeServiceRequestStatus = (value: unknown): string => {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return 'Новая';
    }
    return SERVICE_REQUEST_STATUS_LABELS[normalized] || normalized;
};

export const sendServiceRequestEmail = async (params) => {
    const to = normalizeText(params?.to).toLowerCase();
    if (!to || !isEmailValue(to)) {
        return;
    }
    const requests = Array.isArray(params?.requests) ? params.requests : [];
    if (requests.length === 0) {
        return;
    }
    const toName = normalizeText(params?.toName) || 'коллега';
    const directionName = normalizeText(params?.directionName);
    const directionAddress = normalizeText(params?.directionAddress);
    const explicitDescription = normalizeText(params?.description);
    const description = explicitDescription || Array.from(new Set(requests
        .map((item) => normalizeText(item?.description))
        .filter(Boolean))).join('\n\n');
    const subject = normalizeText(params?.subject)
        || (requests.length > 1
            ? 'Новые заявки на ТО'
            : `Новая заявка на ТО: ${normalizeText(requests[0]?.title) || normalizeText(requests[0]?.id) || 'объект'}`);
    const isExecutor = params?.recipientRole === 'executor';
    const isClient = params?.recipientRole === 'client';
    const enhancedDescription = isExecutor
        ? await enhanceForExecutor(description, subject)
        : isClient
            ? await enhanceForClient(description, subject)
            : await enhanceDescriptionWithAI(description, subject);

    const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
        high: { bg: '#DC2626', text: '#FFFFFF', label: 'Высокий' },
        critical: { bg: '#7F1D1D', text: '#FFFFFF', label: 'Критический' },
        medium: { bg: '#D97706', text: '#FFFFFF', label: 'Средний' },
        low: { bg: '#16a34a', text: '#FFFFFF', label: 'Низкий' },
    };

    const objectRowsHtml = requests.map((item, index) => {
        const priority = normalizeText(item?.priority) || 'medium';
        const pStyle = priorityColors[priority] || priorityColors.medium;
        return `<tr style="${index % 2 === 1 ? 'background:#F8FAFC;' : ''}">
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;font-size:13px;">${index + 1}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#1E293B;">${escapeHtml(normalizeText(item?.title) || normalizeText(item?.id) || 'Объект')}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;"><span style="display:inline-block;padding:2px 10px;background:${pStyle.bg};color:${pStyle.text};border-radius:10px;font-size:12px;font-weight:600;">${escapeHtml(pStyle.label)}</span></td>
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#475569;">${escapeHtml(localizeServiceRequestStatus(item?.status))}</td>
</tr>`;
    }).join('');

    // Description block
    const descriptionHtml = enhancedDescription
        ? (isExecutor
            ? `${emailSectionTitle('Инструкция по выполнению')}${emailInfoCard(`<div style="white-space:pre-wrap;">${escapeHtml(enhancedDescription)}</div>`, '#B91C1C')}`
            : `${emailSectionTitle('Описание работ')}${emailInfoCard(`<div style="white-space:pre-wrap;">${escapeHtml(enhancedDescription)}</div>`)}`)
        : '';

    const contactName = normalizeText(params?.contactName);
    const contactPhone = normalizeText(params?.contactPhone);
    const scheduledDate = normalizeText(params?.scheduledDate);
    const confirmUrl = normalizeText(params?.confirmUrl);
    const rescheduleUrl = normalizeText(params?.rescheduleUrl);
    const openUrl = normalizeText(params?.openUrl);

    const contactHtml = contactName || contactPhone
        ? emailHighlightCard(`<strong>Контактное лицо:</strong> ${escapeHtml(contactName || '—')}${contactPhone ? ` &mdash; <a href="tel:${escapeHtml(contactPhone)}" style="color:#991B1B;font-weight:600;">${escapeHtml(contactPhone)}</a>` : ''}`)
        : '';

    // Buttons
    const buttonsHtml = isExecutor && openUrl
        ? emailButtonsRow([emailButton(openUrl, 'Открыть в системе')])
        : confirmUrl
            ? emailButtonsRow([
                emailButton(confirmUrl, 'Согласовано', '#16a34a'),
                ...(rescheduleUrl ? [emailButtonOutline(rescheduleUrl, 'Перенести', '#D97706')] : []),
            ])
            : '';

    // Heading
    const heading = isExecutor
        ? '<h2 style="margin:0 0 4px;color:#1E293B;font-size:20px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Новое задание</h2>'
        : '<h2 style="margin:0 0 4px;color:#1E293B;font-size:20px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Новая заявка по вашему объекту</h2>';

    const greeting = isExecutor
        ? `<p style="margin:0 0 20px;color:#475569;font-size:15px;">Здравствуйте, ${escapeHtml(toName)}! Вам назначена новая заявка.</p>`
        : `<p style="margin:0 0 20px;color:#475569;font-size:15px;">Здравствуйте, ${escapeHtml(toName)}! По вашему объекту создана заявка на обслуживание.</p>`;

    // Metadata
    const metaRows = [
        directionName ? emailKeyValue('Направление', `${directionName}${directionAddress ? ` (${directionAddress})` : ''}`) : '',
        scheduledDate ? emailKeyValue('Дата выполнения', scheduledDate) : '',
        contactName ? emailKeyValue('Контактное лицо', `${contactName}${contactPhone ? `, тел: ${contactPhone}` : ''}`) : '',
    ].filter(Boolean).join('');

    const bodyHtml = `${heading}
${greeting}
${metaRows ? `${emailSectionTitle('Детали')}${emailKeyValueTable(metaRows)}` : ''}
${descriptionHtml}
${!isExecutor ? contactHtml : ''}
${emailSectionTitle('Объекты')}
<table role="presentation" style="width:100%;border-collapse:collapse;">
  <thead>
    <tr style="background:#B91C1C;">
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">N</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">Объект</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">Приоритет</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">Статус</th>
    </tr>
  </thead>
  <tbody>${objectRowsHtml}</tbody>
</table>
${buttonsHtml}`;

    const preheader = isExecutor
        ? `Новое задание: ${normalizeText(requests[0]?.title) || 'объект'}`
        : `Заявка на обслуживание: ${normalizeText(requests[0]?.title) || 'объект'}`;
    const html = wrapEmailHtml(bodyHtml, { preheader });
    const plainText = htmlToPlainText(html);
    logger.info('sendServiceRequestEmail: sending', { to, subject: subject.slice(0, 80) });
    if (!canSendEmails() || !sender) {
        logger.warn('sendServiceRequestEmail: email not configured');
        return;
    }
    await smtpSendMail({ to, from: sender, subject, text: plainText, html });
    logger.info('sendServiceRequestEmail: sent', { to });
};
const systemBadgeColors: Record<string, string> = {
    aps: '#DC2626', soue: '#EA580C', aupt: '#2563EB', vpv: '#0891B2',
    fireExtinguishers: '#D97706', exitSigns: '#7C3AED', gas: '#059669',
};

const htmlToPlainText = (html: string) => html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h\d>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&#\d+;/g, ' ')
    .replace(/&\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();

export const sendMaintenancePlanEmail = async (params) => {
    const to = normalizeText(params?.to).toLowerCase();
    if (!to || !isEmailValue(to)) {
        return;
    }
    const toName = normalizeText(params?.toName) || 'коллега';
    const planDate = normalizeText(params?.planDate);
    const planTime = normalizeText(params?.planTime);
    const directionName = normalizeText(params?.directionName);
    const directionAddress = normalizeText(params?.directionAddress);
    const tenantName = normalizeText(params?.tenantName);
    const executorName = normalizeText(params?.executorName);
    const contactPerson = normalizeText(params?.contactPerson);
    const contactPhone = normalizeText(params?.contactPhone);
    const description = normalizeText(params?.description);
    const recipientRole = normalizeText(params?.recipientRole) || 'client';
    const isExecutor = recipientRole === 'executor';
    const subject = isExecutor
        ? `Задание на ТО: ${directionName || 'объект'}${planDate ? ` — ${planDate}` : ''}`
        : `Плановое ТО: ${directionName || 'объект'}${planDate ? ` — ${planDate}` : ''}`;
    const enhancedDescription = isExecutor
        ? await enhanceForExecutor(description, subject)
        : await enhanceForClient(description, subject);
    const confirmUrl = normalizeText(params?.confirmUrl);
    const rescheduleUrl = normalizeText(params?.rescheduleUrl);
    const openUrl = normalizeText(params?.openUrl);
    const items = Array.isArray(params?.items) ? params.items : [];

    // System badges for items table
    const itemsHtml = items.map((item, index) => {
        const systems = item?.systems && typeof item.systems === 'object' ? item.systems : {};
        const systemBadges = Object.entries(systems)
            .filter(([, active]) => active === true)
            .map(([key]) => {
                const name = maintenanceSystemRegulations[key]?.name ?? key;
                const color = systemBadgeColors[key] || '#64748B';
                return `<span style="display:inline-block;padding:2px 8px;background:${color};color:#FFFFFF;border-radius:10px;font-size:11px;font-weight:600;margin:2px 2px;">${escapeHtml(name)}</span>`;
            })
            .join(' ');
        return `<tr style="${index % 2 === 1 ? 'background:#F8FAFC;' : ''}">
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#64748B;font-size:13px;">${index + 1}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;font-weight:600;color:#1E293B;">${escapeHtml(item?.name)}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;color:#475569;">${escapeHtml(item?.address)}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;">${systemBadges || '<span style="color:#94A3B8;">—</span>'}</td>
</tr>`;
    }).join('');

    // Collect active systems for regulations table
    const activeSystems = new Set<string>();
    for (const item of items) {
        const systems = item?.systems && typeof item.systems === 'object' ? item.systems : {};
        for (const [key, active] of Object.entries(systems)) {
            if (active === true && maintenanceSystemRegulations[key]) {
                activeSystems.add(key);
            }
        }
    }
    const regulationsHtml = Array.from(activeSystems).map((key) => {
        const regulation = maintenanceSystemRegulations[key as string];
        const color = systemBadgeColors[key] || '#64748B';
        return `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;"><span style="display:inline-block;padding:2px 10px;background:${color};color:#FFFFFF;border-radius:10px;font-size:12px;font-weight:600;">${escapeHtml(regulation.name)}</span></td>
  <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;color:#475569;font-size:13px;">${escapeHtml(regulation.work)}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;font-style:italic;">${escapeHtml(regulation.regulation)}</td>
</tr>`;
    }).join('');

    // Description block
    const descriptionHtml = enhancedDescription
        ? (isExecutor
            ? `${emailSectionTitle('Инструкция по выполнению')}${emailInfoCard(`<div style="white-space:pre-wrap;">${escapeHtml(enhancedDescription)}</div>`, '#B91C1C')}`
            : `${emailSectionTitle('Описание работ')}${emailInfoCard(`<div style="white-space:pre-wrap;">${escapeHtml(enhancedDescription)}</div>`)}`)
        : '';

    // Contact block
    const contactHtml = contactPerson
        ? emailHighlightCard(`<strong>Контактное лицо:</strong> ${escapeHtml(contactPerson)}${contactPhone ? ` &mdash; <a href="tel:${escapeHtml(contactPhone)}" style="color:#991B1B;font-weight:600;">${escapeHtml(contactPhone)}</a>` : ''}`)
        : '';

    // Buttons
    const buttonsHtml = isExecutor && openUrl
        ? emailButtonsRow([emailButton(openUrl, 'Открыть в системе')])
        : confirmUrl
            ? emailButtonsRow([
                emailButton(confirmUrl, 'Согласовано', '#16a34a'),
                ...(rescheduleUrl ? [emailButtonOutline(rescheduleUrl, 'Перенести', '#D97706')] : []),
            ])
            : '';

    // Metadata block
    const metaRows = [
        planDate ? emailKeyValue('Дата и время', `${planDate}${planTime ? `, ${planTime}` : ''}`) : '',
        directionName ? emailKeyValue('Направление', `${directionName}${directionAddress ? ` (${directionAddress})` : ''}`) : '',
        tenantName ? emailKeyValue('Контрагент', tenantName) : '',
        executorName ? emailKeyValue('Исполнитель', executorName) : '',
        contactPerson ? emailKeyValue('Контактное лицо', `${contactPerson}${contactPhone ? `, тел: ${contactPhone}` : ''}`) : '',
    ].filter(Boolean).join('');

    const heading = isExecutor
        ? '<h2 style="margin:0 0 4px;color:#1E293B;font-size:20px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Задание на техническое обслуживание</h2>'
        : '<h2 style="margin:0 0 4px;color:#1E293B;font-size:20px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Плановое техническое обслуживание</h2>';

    const greeting = isExecutor
        ? `<p style="margin:0 0 20px;color:#475569;font-size:15px;">Здравствуйте, ${escapeHtml(toName)}! Вам назначено задание на техническое обслуживание.</p>`
        : `<p style="margin:0 0 20px;color:#475569;font-size:15px;">Здравствуйте, ${escapeHtml(toName)}! Информируем вас о запланированном техническом обслуживании на вашем объекте.</p>`;

    const bodyHtml = `${heading}
${greeting}
${emailSectionTitle('Детали')}
${emailKeyValueTable(metaRows)}
${descriptionHtml}
${!isExecutor ? contactHtml : ''}
${emailSectionTitle('Объекты обслуживания')}
<table role="presentation" style="width:100%;border-collapse:collapse;">
  <thead>
    <tr style="background:#B91C1C;">
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">N</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">Объект</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">Адрес</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;">Системы</th>
    </tr>
  </thead>
  <tbody>${itemsHtml || `<tr><td colspan="4" style="padding:12px;border-bottom:1px solid #E2E8F0;color:#94A3B8;">Объекты не указаны</td></tr>`}</tbody>
</table>
${regulationsHtml ? `${emailSectionTitle('Регламент работ')}
<table role="presentation" style="width:100%;border-collapse:collapse;">
  <thead>
    <tr style="background:#F1F5F9;">
      <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Система</th>
      <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Работы</th>
      <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748B;font-family:Arial,Helvetica,sans-serif;">Норматив</th>
    </tr>
  </thead>
  <tbody>${regulationsHtml}</tbody>
</table>` : ''}
${buttonsHtml}`;

    const preheader = isExecutor
        ? `Задание на ТО: ${directionName || 'объект'}, ${planDate || ''}`
        : `Плановое ТО: ${directionName || 'объект'}, ${planDate || ''}`;
    const html = wrapEmailHtml(bodyHtml, { preheader });
    const plainText = htmlToPlainText(html);
    const emailSubject = `ТО: ${planDate}${directionName ? ` | ${directionName}` : ''}`;
    if (!canSendEmails() || !sender) {
        logger.warn('sendMaintenancePlanEmail: email not configured');
        return;
    }
    await smtpSendMail({ to, from: sender, subject: emailSubject, text: plainText, html });
};

export const maintenanceSystemRegulations = {
    aps: {
        name: 'АПС (Пожарная сигнализация)',
        regulation: 'СП 484.1311500.2020',
        work: 'Проверка шлейфов, дымовых извещателей и ПКП — не формальность: закрашенный, загрязненный или неисправный датчик может не сработать вовремя. Включает визуальный осмотр, очистку и тест сработки.',
    },
    soue: {
        name: 'СОУЭ (Оповещение)',
        regulation: 'СП 3.13130.2009',
        work: 'Проверка оповещателей, речевых модулей, резервного питания.',
    },
    aupt: {
        name: 'АУПТ (Пожаротушение)',
        regulation: 'СП 485.1311500.2020',
        work: 'Проверка узлов управления, трубопроводов, запорной арматуры.',
    },
    vpv: {
        name: 'ВПВ (Водопровод)',
        regulation: 'СП 10.13130.2020',
        work: 'Проверка кранов, рукавов, давления в сети.',
    },
    fireExtinguishers: {
        name: 'Огнетушители',
        regulation: 'СП 9.13130.2009',
        work: 'Визуальный осмотр, проверка давления, маркировки.',
    },
    exitSigns: {
        name: 'Табло ВЫХОД',
        regulation: 'СП 3.13130.2009',
        work: 'Проверка работоспособности, подсветки, резервного питания.',
    },
    gas: {
        name: 'Газовое тушение',
        regulation: 'СП 485.1311500.2020',
        work: 'Проверка модулей, трубопроводов, взвешивание баллонов.',
    },
};
