import { History } from 'lucide-react';
import {
  INSTALLATION_CANCEL_REASON_LABELS,
  INSTALLATION_STAGE_LABELS,
} from '@/pages/installation/meta';

type EventRow = {
  id: string;
  eventType?: string;
  description?: string;
  userId?: string;
  actorUserId?: string;
  createdAt?: string;
  meta?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  created: 'Создание',
  project_created: 'Создание',
  project_deleted: 'Удаление',
  status_changed: 'Смена статуса',
  project_status_changed: 'Смена статуса',
  stage_changed: 'Смена этапа',
  project_stage_changed: 'Смена этапа',
  installation_stage_changed: 'Смена этапа',
  deadline_changed: 'Изменение сроков',
  project_due_changed: 'Изменение сроков',
  installation_deadline_changed: 'Изменение сроков',
  executor_added: 'Добавлен исполнитель',
  executor_removed: 'Снят исполнитель',
  project_members_changed: 'Исполнители',
  procurement_added: 'Добавлена позиция закупки',
  procurement_updated: 'Обновлена позиция закупки',
  procurement_deleted: 'Удалена позиция закупки',
  installation_procurement_changed: 'Закупка',
  installation_procurement_completed: 'Закупка завершена',
  file_added: 'Добавлен файл',
  file_deleted: 'Удалён файл',
  project_files_added: 'Файлы',
  project_files_removed: 'Файлы',
  comment_added: 'Новое сообщение',
  project_chat_message_created: 'Сообщение',
  project_tz_updated: 'Обновление ТЗ',
  manual_edit: 'Обновление ТЗ',
  project_updated: 'Обновление',
  project_update: 'Обновление',
  updated: 'Обновление',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  created: 'bg-green-500',
  project_created: 'bg-green-500',
  project_deleted: 'bg-red-500',
  status_changed: 'bg-blue-500',
  project_status_changed: 'bg-blue-500',
  stage_changed: 'bg-indigo-500',
  project_stage_changed: 'bg-indigo-500',
  installation_stage_changed: 'bg-indigo-500',
  deadline_changed: 'bg-amber-500',
  project_due_changed: 'bg-amber-500',
  installation_deadline_changed: 'bg-amber-500',
  executor_added: 'bg-teal-500',
  executor_removed: 'bg-orange-500',
  project_members_changed: 'bg-teal-500',
  procurement_added: 'bg-purple-500',
  procurement_updated: 'bg-purple-400',
  procurement_deleted: 'bg-red-400',
  installation_procurement_changed: 'bg-purple-500',
  installation_procurement_completed: 'bg-green-500',
  file_added: 'bg-cyan-500',
  file_deleted: 'bg-red-400',
  project_files_added: 'bg-cyan-500',
  project_files_removed: 'bg-red-400',
  comment_added: 'bg-slate-400',
  project_chat_message_created: 'bg-slate-400',
  project_tz_updated: 'bg-blue-500',
  manual_edit: 'bg-blue-500',
  project_updated: 'bg-slate-400',
  project_update: 'bg-slate-400',
  updated: 'bg-slate-400',
};

const UPDATED_FIELD_LABELS: Record<string, string> = {
  title: 'название',
  description: 'описание',
  tenantId: 'компания',
  directionId: 'направление',
  systemType: 'тип системы',
  priority: 'приоритет',
  dueDatePreliminary: 'предварительный дедлайн',
  dueDateAdmin: 'админский дедлайн',
  responsibleIds: 'исполнители',
};

const PROCUREMENT_STATUS_LABELS: Record<string, string> = {
  needed: 'Нужно',
  ordered: 'Заказано',
  received: 'Получено',
};

const VISIBILITY_LABELS: Record<string, string> = {
  internal: 'Внутреннее',
  'client-visible': 'Клиентское',
};

const normalizeText = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
);

const getEventPayload = (event: EventRow): Record<string, unknown> => {
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    return event.payload;
  }
  if (event.meta && typeof event.meta === 'object' && !Array.isArray(event.meta)) {
    return event.meta;
  }
  return {};
};

const formatDateOnly = (value: string) => {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-');
    return `${day}.${month}.${year}`;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleDateString('ru-RU');
};

const formatStageLabel = (value: unknown) => {
  const normalized = normalizeText(value);
  return INSTALLATION_STAGE_LABELS[normalized] || normalized;
};

const formatCancelReasonLabel = (value: unknown) => {
  const normalized = normalizeText(value);
  return INSTALLATION_CANCEL_REASON_LABELS[normalized] || normalized;
};

const listPayloadFileNames = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? normalizeText((item as { name?: unknown }).name) : ''))
    .filter(Boolean)
    .slice(0, 3);
};

const resolveEventDetails = (event: EventRow) => {
  const payload = getEventPayload(event);
  const eventType = normalizeText(event.eventType) || 'updated';
  const detailLines: string[] = [];
  let summary = '';

  if (eventType === 'stage_changed' || eventType === 'project_stage_changed' || eventType === 'installation_stage_changed') {
    const fromLabel = normalizeText(payload.fromLabel) || formatStageLabel(payload.fromStage);
    const toLabel = normalizeText(payload.toLabel) || formatStageLabel(payload.toStage);
    if (fromLabel && toLabel) summary = `${fromLabel} -> ${toLabel}`;
    if (normalizeText(payload.reason)) detailLines.push(`Причина: ${normalizeText(payload.reason)}`);
    if (normalizeText(payload.overrideReason)) detailLines.push(`Override: ${normalizeText(payload.overrideReason)}`);
    if (normalizeText(payload.pauseReason)) detailLines.push(`Пауза: ${normalizeText(payload.pauseReason)}`);
    if (normalizeText(payload.cancelReason)) detailLines.push(`Отмена: ${formatCancelReasonLabel(payload.cancelReason)}`);
    if (normalizeText(payload.cancelComment)) detailLines.push(`Комментарий: ${normalizeText(payload.cancelComment)}`);
  }

  if (!summary && (eventType === 'status_changed' || eventType === 'project_status_changed')) {
    const fromStatus = formatStageLabel(payload.fromStatus);
    const toStatus = formatStageLabel(payload.toStatus);
    if (fromStatus && toStatus) summary = `${fromStatus} -> ${toStatus}`;
    if (normalizeText(payload.source)) detailLines.push(`Источник: ${normalizeText(payload.source)}`);
  }

  if (!summary && (eventType === 'deadline_changed' || eventType === 'project_due_changed' || eventType === 'installation_deadline_changed')) {
    const stageLabel = formatStageLabel(payload.stage);
    const oldDate = formatDateOnly(normalizeText(payload.oldDate) || normalizeText(payload.oldDue));
    const newDate = formatDateOnly(normalizeText(payload.newDate) || normalizeText(payload.newDue));
    if (stageLabel && (oldDate || newDate)) {
      summary = `Этап «${stageLabel}»: ${oldDate || 'не задан'} -> ${newDate || 'не задан'}`;
    } else if (oldDate || newDate) {
      summary = `${oldDate || 'не задан'} -> ${newDate || 'не задан'}`;
    }
    if (normalizeText(payload.reason)) detailLines.push(`Причина: ${normalizeText(payload.reason)}`);
  }

  if (!summary && eventType === 'installation_procurement_changed') {
    const action = normalizeText(payload.action);
    const itemName = normalizeText(payload.name);
    if (action === 'added') {
      summary = `Добавлена позиция${itemName ? ` «${itemName}»` : ''}`;
      if (payload.quantity !== undefined && payload.quantity !== null) detailLines.push(`Количество: ${String(payload.quantity)}`);
    } else if (action === 'updated') {
      summary = 'Позиция закупки обновлена';
      const changes = payload.changes && typeof payload.changes === 'object' && !Array.isArray(payload.changes)
        ? payload.changes as Record<string, unknown>
        : {};
      if (normalizeText(changes.name)) detailLines.push(`Название: ${normalizeText(changes.name)}`);
      if (normalizeText(changes.status)) detailLines.push(`Статус: ${PROCUREMENT_STATUS_LABELS[normalizeText(changes.status)] || normalizeText(changes.status)}`);
      if (normalizeText(changes.comment)) detailLines.push(`Комментарий: ${normalizeText(changes.comment)}`);
      if (normalizeText(changes.link)) detailLines.push(`Ссылка обновлена`);
    } else if (action === 'deleted') {
      summary = `Удалена позиция${itemName ? ` «${itemName}»` : ''}`;
    }
  }

  if (!summary && eventType === 'installation_procurement_completed') {
    summary = 'Все позиции закупки получены';
  }

  if (!summary && eventType === 'project_members_changed') {
    summary = 'Состав исполнителей изменён';
    if (Array.isArray(payload.added) && payload.added.length > 0) detailLines.push(`Добавлено: ${payload.added.length}`);
    if (Array.isArray(payload.removed) && payload.removed.length > 0) detailLines.push(`Снято: ${payload.removed.length}`);
    if (payload.total !== undefined && payload.total !== null) detailLines.push(`Всего исполнителей: ${String(payload.total)}`);
  }

  if (!summary && eventType === 'project_files_added') {
    summary = `Добавлено файлов: ${String(payload.addedCount ?? 0)}`;
    const names = listPayloadFileNames(payload.files);
    if (names.length > 0) detailLines.push(`Файлы: ${names.join(', ')}`);
  }

  if (!summary && eventType === 'project_files_removed') {
    summary = `Удалено файлов: ${String(payload.removedCount ?? 0)}`;
    if (payload.remainingCount !== undefined && payload.remainingCount !== null) {
      detailLines.push(`Осталось: ${String(payload.remainingCount)}`);
    }
  }

  if (!summary && (eventType === 'project_updated' || eventType === 'project_update' || eventType === 'updated')) {
    summary = 'Данные монтажа обновлены';
    const updatedFields = payload.updatedFields && typeof payload.updatedFields === 'object' && !Array.isArray(payload.updatedFields)
      ? payload.updatedFields as Record<string, unknown>
      : {};
    const labels = Object.entries(updatedFields)
      .filter(([, value]) => value === true)
      .map(([key]) => UPDATED_FIELD_LABELS[key] || key);
    if (labels.length > 0) detailLines.push(`Изменено: ${labels.join(', ')}`);
  }

  if (!summary && (eventType === 'project_chat_message_created' || eventType === 'comment_added')) {
    summary = 'Добавлено сообщение';
    if (normalizeText(payload.visibility)) detailLines.push(`Видимость: ${VISIBILITY_LABELS[normalizeText(payload.visibility)] || normalizeText(payload.visibility)}`);
  }

  if (!summary && (eventType === 'project_tz_updated' || eventType === 'manual_edit')) {
    summary = 'Техническое задание обновлено';
    if (payload.revisionNo !== undefined && payload.revisionNo !== null) detailLines.push(`Ревизия: ${String(payload.revisionNo)}`);
    if (normalizeText(payload.reason)) detailLines.push(`Причина: ${normalizeText(payload.reason)}`);
  }

  if (!summary && (eventType === 'created' || eventType === 'project_created')) {
    summary = 'Монтаж создан';
  }

  if (!summary && eventType === 'project_deleted') {
    summary = 'Монтаж удалён';
  }

  const description = normalizeText(event.description);
  if (!summary) summary = description || EVENT_TYPE_LABELS[eventType] || eventType;
  if (description && description !== summary && !detailLines.includes(description)) {
    detailLines.unshift(description);
  }

  return { summary, detailLines };
};

export default function HistoryTab({ events, userNameById }: {
  events: EventRow[]; userNameById: Record<string, string>;
}) {
  const resolveUserLabel = (userId?: string) => {
    if (!userId) return 'Система';
    return userNameById[userId] || 'Участник';
  };

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <History size={18} className="text-slate-500" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">История изменений</h3>
        </div>
        <div className="px-6 py-12 text-center">
          <History size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">История пуста</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <History size={18} className="text-slate-500" />
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          История изменений
          <span className="ml-2 text-xs font-normal text-slate-400">({events.length})</span>
        </h3>
      </div>

      <div className="px-6 py-4">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-200 dark:bg-slate-700" />

          <div className="space-y-4">
            {events.map((ev) => {
              const evType = ev.eventType || 'updated';
              const dotColor = EVENT_TYPE_COLORS[evType] || 'bg-slate-400';
              const { summary, detailLines } = resolveEventDetails(ev);
              const actorUserId = normalizeText(ev.actorUserId) || normalizeText(ev.userId);
              return (
                <div key={ev.id} className="relative flex items-start gap-4 pl-8">
                  {/* Dot */}
                  <div className={`absolute left-1.5 top-1.5 h-4 w-4 rounded-full border-2 border-white dark:border-slate-900 ${dotColor}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {EVENT_TYPE_LABELS[evType] || evType}
                      </span>
                      <span className="text-xs text-slate-400">
                        {ev.createdAt ? new Date(ev.createdAt).toLocaleString('ru-RU', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        }) : ''}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{summary}</p>
                    {detailLines.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {detailLines.map((line) => (
                          <span
                            key={`${ev.id}-${line}`}
                            className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {line}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {resolveUserLabel(actorUserId)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
