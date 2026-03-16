import * as React from 'react';
import { Text, Section, Button, Link } from '@react-email/components';
import { BaseEmail } from './BaseEmail.js';

interface ServiceRequestEmailProps {
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
}

export const ServiceRequestEmail = ({
  toName,
  directionName,
  directionAddress,
  description,
  requests,
  recipientRole = 'client',
  contactName,
  contactPhone,
  scheduledDate,
  confirmUrl,
  rescheduleUrl,
  openUrl,
}: ServiceRequestEmailProps) => {
  const isExecutor = recipientRole === 'executor';

  const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
    high: { bg: '#DC2626', text: '#FFFFFF', label: 'Высокий' },
    critical: { bg: '#7F1D1D', text: '#FFFFFF', label: 'Критический' },
    medium: { bg: '#D97706', text: '#FFFFFF', label: 'Средний' },
    low: { bg: '#16a34a', text: '#FFFFFF', label: 'Низкий' },
  };

  const preheader = isExecutor
    ? `Новое задание: ${requests[0]?.title || 'объект'}`
    : `Заявка на обслуживание: ${requests[0]?.title || 'объект'}`;

  return (
    <BaseEmail preheader={preheader}>
      <Text style={headingStyle}>
        {isExecutor ? 'Новое задание' : 'Новая заявка по вашему объекту'}
      </Text>
      <Text style={paragraphStyle}>
        Здравствуйте, {toName}! {isExecutor ? 'Вам назначена новая заявка.' : 'По вашему объекту создана заявка на обслуживание.'}
      </Text>

      {/* Details */}
      {(directionName || scheduledDate || contactName) && (
        <Section style={detailsBoxStyle}>
          <Text style={sectionTitleStyle}>Детали</Text>
          {directionName && (
            <Text style={detailRowStyle}>
              <span style={detailLabelStyle}>Направление:</span> {directionName}
              {directionAddress && ` (${directionAddress})`}
            </Text>
          )}
          {scheduledDate && (
            <Text style={detailRowStyle}>
              <span style={detailLabelStyle}>Дата выполнения:</span> {scheduledDate}
            </Text>
          )}
          {contactName && (
            <Text style={detailRowStyle}>
              <span style={detailLabelStyle}>Контактное лицо:</span> {contactName}
              {contactPhone && `, тел: ${contactPhone}`}
            </Text>
          )}
        </Section>
      )}

      {/* Description */}
      {description && (
        <>
          <Text style={sectionTitleStyle}>
            {isExecutor ? 'Инструкция по выполнению' : 'Описание работ'}
          </Text>
          <Section style={descriptionBoxStyle}>
            <Text style={descriptionTextStyle}>{description}</Text>
          </Section>
        </>
      )}

      {/* Objects Table */}
      <Text style={sectionTitleStyle}>Объекты</Text>
      <table style={tableStyle}>
        <thead>
          <tr style={tableHeaderRowStyle}>
            <th style={tableHeaderCellStyle}>N</th>
            <th style={tableHeaderCellStyle}>Объект</th>
            <th style={tableHeaderCellStyle}>Приоритет</th>
            <th style={tableHeaderCellStyle}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((item, index) => {
            const priority = item.priority || 'medium';
            const pStyle = priorityColors[priority] || priorityColors.medium;
            return (
              <tr key={item.id} style={index % 2 === 1 ? tableRowAltStyle : tableRowStyle}>
                <td style={tableCellStyle}>{index + 1}</td>
                <td style={tableCellBoldStyle}>{item.title || item.id || 'Объект'}</td>
                <td style={tableCellStyle}>
                  <span style={{ ...badgeStyle, backgroundColor: pStyle.bg, color: pStyle.text }}>
                    {pStyle.label}
                  </span>
                </td>
                <td style={tableCellStyle}>{item.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Buttons */}
      {(confirmUrl || openUrl) && (
        <Section style={buttonContainerStyle}>
          {isExecutor && openUrl ? (
            <Button href={openUrl} style={primaryButtonStyle}>
              Открыть в системе
            </Button>
          ) : (
            <>
              {confirmUrl && (
                <Button href={confirmUrl} style={successButtonStyle}>
                  Согласовано
                </Button>
              )}
              {rescheduleUrl && (
                <Button href={rescheduleUrl} style={secondaryButtonStyle}>
                  Перенести
                </Button>
              )}
            </>
          )}
        </Section>
      )}
    </BaseEmail>
  );
};

const headingStyle = { margin: '0 0 4px', color: '#1E293B', fontSize: '20px', fontWeight: '700' };
const paragraphStyle = { margin: '0 0 20px', color: '#475569', fontSize: '15px' };
const sectionTitleStyle = { margin: '28px 0 12px', color: '#0F172A', fontSize: '16px', fontWeight: '700' };
const detailsBoxStyle = { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px 24px', margin: '16px 0' };
const detailRowStyle = { margin: '6px 0', fontSize: '14px', color: '#1E293B' };
const detailLabelStyle = { color: '#64748B', fontWeight: '600' };
const descriptionBoxStyle = { backgroundColor: '#f0f9ff', borderLeft: '4px solid #3b82f6', borderRadius: '12px', padding: '20px 24px', margin: '16px 0' };
const descriptionTextStyle = { margin: '0', color: '#334155', fontSize: '14px', lineHeight: '1.7', whiteSpace: 'pre-wrap' as const };
const tableStyle = { width: '100%', borderCollapse: 'collapse' as const, margin: '12px 0' };
const tableHeaderRowStyle = { backgroundColor: '#0f172a' };
const tableHeaderCellStyle = { padding: '10px 12px', textAlign: 'left' as const, fontSize: '12px', color: '#FFFFFF' };
const tableRowStyle = { borderBottom: '1px solid #E2E8F0' };
const tableRowAltStyle = { ...tableRowStyle, backgroundColor: '#F8FAFC' };
const tableCellStyle = { padding: '10px 12px', fontSize: '13px', color: '#475569' };
const tableCellBoldStyle = { ...tableCellStyle, fontWeight: '600', color: '#1E293B' };
const badgeStyle = { display: 'inline-block', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: '600' };
const buttonContainerStyle = { textAlign: 'center' as const, margin: '26px 0 8px' };
const primaryButtonStyle = { display: 'inline-block', padding: '16px 32px', background: 'linear-gradient(135deg,#e11d48 0%,#be123c 100%)', color: '#FFFFFF', textDecoration: 'none', borderRadius: '12px', fontWeight: '600', fontSize: '15px', letterSpacing: '0.3px', boxShadow: '0 4px 14px rgba(225,29,72,0.35)', margin: '6px 4px' };
const successButtonStyle = { ...primaryButtonStyle, background: 'linear-gradient(135deg,#16a34a 0%,#15803d 100%)', boxShadow: '0 4px 14px rgba(22,163,74,0.35)' };
const secondaryButtonStyle = { display: 'inline-block', padding: '16px 32px', background: 'transparent', color: '#D97706', border: '2px solid #D97706', textDecoration: 'none', borderRadius: '12px', fontWeight: '600', fontSize: '15px', letterSpacing: '0.3px', margin: '6px 4px' };

export default ServiceRequestEmail;
