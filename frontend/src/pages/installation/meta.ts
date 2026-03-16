export const INSTALLATION_STAGE_VALUES: string[] = [
  'new',
  'awaiting_assignment',
  'assigned',
  'procurement',
  'in_progress',
  'pnr',
  'acceptance',
  'completed',
  'paused',
  'cancelled',
];

export const INSTALLATION_STAGE_FLOW_ORDER: string[] = [
  'new',
  'awaiting_assignment',
  'assigned',
  'procurement',
  'in_progress',
  'pnr',
  'acceptance',
  'completed',
];

export const INSTALLATION_STAGE_LABELS: Record<string, string> = {
  new: 'Новая',
  awaiting_assignment: 'Ожидает назначения',
  assigned: 'Назначены',
  procurement: 'Закупка',
  in_progress: 'В работе',
  pnr: 'ПНР',
  acceptance: 'Сдача',
  completed: 'Завершена',
  paused: 'На паузе',
  cancelled: 'Отменена',
};

export const INSTALLATION_STAGE_PROGRESS_CLASSES: Record<string, string> = {
  new: 'bg-blue-500',
  awaiting_assignment: 'bg-amber-500',
  assigned: 'bg-indigo-500',
  procurement: 'bg-purple-500',
  in_progress: 'bg-yellow-500',
  pnr: 'bg-cyan-500',
  acceptance: 'bg-teal-500',
  completed: 'bg-green-500',
  paused: 'bg-slate-400',
  cancelled: 'bg-red-500',
};

export const INSTALLATION_STAGE_BADGE_CLASSES: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  awaiting_assignment: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  assigned: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  procurement: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  in_progress: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  pnr: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  acceptance: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  paused: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export const INSTALLATION_STAGE_TRANSITIONS: Record<string, string[]> = {
  new: ['awaiting_assignment', 'assigned', 'cancelled'],
  awaiting_assignment: ['assigned', 'paused', 'cancelled'],
  assigned: ['procurement', 'in_progress', 'paused', 'cancelled'],
  procurement: ['in_progress', 'paused', 'cancelled'],
  in_progress: ['pnr', 'acceptance', 'paused', 'cancelled'],
  pnr: ['acceptance', 'paused', 'cancelled'],
  acceptance: ['completed', 'in_progress', 'paused', 'cancelled'],
  completed: [],
  paused: ['awaiting_assignment', 'assigned', 'procurement', 'in_progress', 'pnr', 'acceptance', 'cancelled'],
  cancelled: [],
};

export const INSTALLATION_DEADLINE_STAGES: string[] = ['procurement', 'in_progress', 'pnr', 'acceptance'];

export const INSTALLATION_DEADLINE_STAGE_LABELS: Record<string, string> = {
  procurement: 'Закупка до',
  in_progress: 'Работа до',
  pnr: 'ПНР до',
  acceptance: 'Сдача до',
};

export const INSTALLATION_CANCEL_REASONS: string[] = [
  'client_refused',
  'duplicate',
  'no_access',
  'moved_to_other',
  'other',
];

export const INSTALLATION_CANCEL_REASON_LABELS: Record<string, string> = {
  client_refused: 'Клиент отказался',
  duplicate: 'Дубликат',
  no_access: 'Нет доступа',
  moved_to_other: 'Перенесли на другой проект',
  other: 'Другое',
};

type InstallationStageLike = {
  stage?: string | null;
  installationStage?: string | null;
  status?: string | null;
};

export const getInstallationStage = (
  item: InstallationStageLike | null | undefined,
  fallback = 'new',
) => {
  const normalized = String(item?.stage || item?.installationStage || item?.status || '').trim();
  return normalized || fallback;
};

export const isInstallationClosedStage = (stage: string) =>
  stage === 'completed' || stage === 'cancelled';

export const getInstallationStageProgressPercent = (stage: string) => {
  if (stage === 'paused' || stage === 'cancelled') return 0;
  const stageIndex = INSTALLATION_STAGE_FLOW_ORDER.indexOf(stage);
  if (stageIndex < 0) return 0;
  return Math.max(0, ((stageIndex + 1) / INSTALLATION_STAGE_FLOW_ORDER.length) * 100);
};
