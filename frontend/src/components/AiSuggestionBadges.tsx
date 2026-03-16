import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { api } from '@/api/client';

type SuggestionValue = {
  value: string;
  label: string;
  confidence: string;
  explanation?: string;
} | null;

type AiMeta = {
  source?: string;
  provider?: string;
  error?: string;
};

type AiSuggestionBag = {
  type: SuggestionValue;
  systemType: SuggestionValue;
  priority: SuggestionValue;
  _meta?: AiMeta;
} | null;

interface AiSuggestionBadgesProps {
  suggestions: AiSuggestionBag;
  loading: boolean;
  error?: string | null;
  onAccept: (field: 'type' | 'systemType' | 'priority', value: string) => void;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high:
    'border-green-200 bg-green-50 text-green-700 hover:border-green-300 hover:bg-green-100 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300 dark:hover:border-green-800',
  medium:
    'border-yellow-200 bg-yellow-50 text-yellow-700 hover:border-yellow-300 hover:bg-yellow-100 dark:border-yellow-900/60 dark:bg-yellow-950/30 dark:text-yellow-300 dark:hover:border-yellow-800',
  low:
    'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

const SOURCE_LABELS: Record<string, string> = {
  ai: 'AI',
  fallback: 'AI (резерв)',
  rules: 'Правила',
};

const normalizeConfidence = (value: string | undefined) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized;
  }
  return 'medium';
};

const logSuggestionAudit = async (params: {
  suggestionType: string;
  suggestionData?: Record<string, unknown> | null;
  action: 'accepted' | 'rejected' | 'ignored';
  entityType?: string;
  entityId?: string;
}) => {
  try {
    await api.postT('/ai/suggestion-audit', params);
  } catch {
    // best-effort
  }
};

function FeedbackButtons({ endpoint, source, provider }: { endpoint: string; source?: string; provider?: string }) {
  const [sent, setSent] = useState<'positive' | 'negative' | null>(null);

  const send = async (rating: 'positive' | 'negative') => {
    setSent(rating);
    try {
      await api.postT('/ai/feedback', { endpoint, rating, source, provider });
    } catch {
      // best-effort
    }
    // Also log to suggestion audit
    void logSuggestionAudit({
      suggestionType: 'field_suggestion',
      suggestionData: { endpoint, source, provider },
      action: rating === 'positive' ? 'accepted' : 'rejected',
    });
  };

  if (sent) {
    return (
      <span className="text-[10px] text-slate-400 dark:text-slate-500">
        {sent === 'positive' ? 'Спасибо!' : 'Учтём'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void send('positive'); }}
        className="rounded p-0.5 text-slate-400 transition hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950/40 dark:hover:text-green-400"
        title="Полезно"
      >
        <ThumbsUp size={11} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void send('negative'); }}
        className="rounded p-0.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        title="Не полезно"
      >
        <ThumbsDown size={11} />
      </button>
    </span>
  );
}

function SuggestionBadge({ item, onAccept }: {
  item: { field: 'type' | 'systemType' | 'priority'; title: string; value: SuggestionValue };
  onAccept: (field: 'type' | 'systemType' | 'priority', value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const confidence = normalizeConfidence(item.value?.confidence);
  const confidenceLabel = CONFIDENCE_LABELS[confidence] || confidence;
  const explanation = item.value?.explanation || '';

  return (
    <div key={item.field} className="flex flex-col">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            onAccept(item.field, item.value?.value || '');
            void logSuggestionAudit({
              suggestionType: 'field_suggestion',
              suggestionData: { field: item.field, value: item.value?.value, label: item.value?.label, confidence: item.value?.confidence },
              action: 'accepted',
            });
          }}
          className={[
            'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
            CONFIDENCE_STYLES[confidence] || CONFIDENCE_STYLES.medium,
          ].join(' ')}
        >
          <span>{item.title}:</span>
          <span>{item.value?.label}</span>
          <span className="opacity-80">({confidenceLabel})</span>
        </button>
        {explanation && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => !prev); }}
            className="ml-0.5 text-[10px] text-slate-400 underline decoration-dotted hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition"
          >
            {expanded ? 'Скрыть' : 'Почему?'}
          </button>
        )}
      </div>
      {expanded && explanation && (
        <div className="mt-1 ml-1 rounded bg-slate-50 px-2 py-1 text-[11px] leading-snug text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          {explanation}
        </div>
      )}
    </div>
  );
}

export default function AiSuggestionBadges({ suggestions, loading, error, onAccept }: AiSuggestionBadgesProps) {
  if (loading) {
    return (
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        AI анализирует описание...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
        {error}
      </div>
    );
  }

  if (!suggestions) {
    return null;
  }

  const items: Array<{ field: 'type' | 'systemType' | 'priority'; title: string; value: SuggestionValue }> = [
    { field: 'type', title: 'Тип', value: suggestions.type },
    { field: 'systemType', title: 'Система', value: suggestions.systemType },
    { field: 'priority', title: 'Приоритет', value: suggestions.priority },
  ];

  const visibleItems = items.filter((item) => item.value && item.value.value);
  if (visibleItems.length === 0) {
    return null;
  }

  const meta = suggestions._meta;
  const sourceLabel = SOURCE_LABELS[meta?.source || ''] || '';

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">AI-подсказки (кликните для применения):</p>
        {sourceLabel && (
          <span className="inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {sourceLabel}
          </span>
        )}
        <FeedbackButtons endpoint="suggest-request-fields" source={meta?.source} provider={meta?.provider} />
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleItems.map((item) => (
          <SuggestionBadge key={item.field} item={item} onAccept={onAccept} />
        ))}
      </div>
    </div>
  );
}
