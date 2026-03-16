import { AlertTriangle, Frown, Meh, Smile, Zap } from 'lucide-react';

type SentimentType = 'positive' | 'negative' | 'neutral' | 'urgent';

type SentimentBadgeProps = {
  sentiment: SentimentType;
  score?: number;
  isUrgent?: boolean;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

const SENTIMENT_CONFIG: Record<
  SentimentType,
  {
    label: string;
    icon: typeof Smile;
    bgColor: string;
    textColor: string;
    iconColor: string;
  }
> = {
  positive: {
    label: 'Позитивный',
    icon: Smile,
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  negative: {
    label: 'Негативный',
    icon: Frown,
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-300',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  neutral: {
    label: 'Нейтральный',
    icon: Meh,
    bgColor: 'bg-slate-100 dark:bg-slate-700/50',
    textColor: 'text-slate-700 dark:text-slate-300',
    iconColor: 'text-slate-600 dark:text-slate-400',
  },
  urgent: {
    label: 'Срочно',
    icon: Zap,
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    iconColor: 'text-orange-600 dark:text-orange-400',
  },
};

const SIZE_CONFIG = {
  sm: {
    iconSize: 12,
    padding: 'px-1.5 py-0.5',
    text: 'text-xs',
    gap: 'gap-1',
  },
  md: {
    iconSize: 14,
    padding: 'px-2 py-1',
    text: 'text-xs',
    gap: 'gap-1.5',
  },
  lg: {
    iconSize: 16,
    padding: 'px-2.5 py-1.5',
    text: 'text-sm',
    gap: 'gap-2',
  },
};

export default function SentimentBadge({
  sentiment,
  score,
  isUrgent = false,
  showLabel = true,
  size = 'md',
}: SentimentBadgeProps) {
  // Override sentiment if urgent flag is set
  const effectiveSentiment = isUrgent ? 'urgent' : sentiment;
  const config = SENTIMENT_CONFIG[effectiveSentiment];
  const sizeConfig = SIZE_CONFIG[size];
  const Icon = config.icon;

  // Add pulsing animation for urgent items
  const urgentAnimation = isUrgent ? 'animate-pulse' : '';

  return (
    <div
      className={`inline-flex items-center ${sizeConfig.gap} ${sizeConfig.padding} rounded-full ${config.bgColor} ${urgentAnimation}`}
      title={
        score !== undefined
          ? `${config.label} (${Math.round(score * 100)}%)`
          : config.label
      }
    >
      <Icon size={sizeConfig.iconSize} className={config.iconColor} />
      {showLabel && (
        <span className={`font-medium ${config.textColor} ${sizeConfig.text}`}>
          {config.label}
        </span>
      )}
      {score !== undefined && showLabel && (
        <span className={`${config.textColor} ${sizeConfig.text} opacity-75`}>
          {Math.round(score * 100)}%
        </span>
      )}
      {isUrgent && (
        <AlertTriangle
          size={sizeConfig.iconSize}
          className="text-orange-600 dark:text-orange-400"
        />
      )}
    </div>
  );
}
