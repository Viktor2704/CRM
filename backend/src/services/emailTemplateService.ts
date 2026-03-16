import { render } from '@react-email/render';
import * as React from 'react';

// Import email templates
import LoginTokenEmail from '../templates/email/LoginTokenEmail.js';
import ServiceRequestEmail from '../templates/email/ServiceRequestEmail.js';

export const renderLoginTokenEmail = async (params: { token: string; expiresInMinutes: number }) => {
  const html = await render(React.createElement(LoginTokenEmail, params));
  const text = `Ваш код входа: ${params.token}\n\nКод действует ${params.expiresInMinutes} минут.\nЕсли вы не запрашивали вход, проигнорируйте это письмо.`;
  return { html, text };
};

export const renderServiceRequestEmail = async (params: {
  toName: string;
  directionName?: string;
  directionAddress?: string;
  description: string;
  requests: Array<{
    id: string;
    title: string;
    priority: string;
    status: string;
  }>;
  recipientRole?: 'executor' | 'client';
  contactName?: string;
  contactPhone?: string;
  scheduledDate?: string;
  confirmUrl?: string;
  rescheduleUrl?: string;
  openUrl?: string;
}) => {
  const html = await render(React.createElement(ServiceRequestEmail, params));

  const isExecutor = params.recipientRole === 'executor';
  const text = `${isExecutor ? 'Новое задание' : 'Новая заявка по вашему объекту'}

Здравствуйте, ${params.toName}!

${params.description}

Объекты:
${params.requests.map((r, i) => `${i + 1}. ${r.title} (${r.priority}, ${r.status})`).join('\n')}

${params.contactName ? `Контактное лицо: ${params.contactName}${params.contactPhone ? `, тел: ${params.contactPhone}` : ''}` : ''}
${params.scheduledDate ? `Дата выполнения: ${params.scheduledDate}` : ''}
`;

  return { html, text };
};

export const emailTemplates = {
  loginToken: renderLoginTokenEmail,
  serviceRequest: renderServiceRequestEmail,
};
