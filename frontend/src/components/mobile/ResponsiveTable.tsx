import type { ReactNode } from 'react';
import { useMobileDetect } from '@/hooks/useMobileDetect';

type Column<T> = {
  key: string;
  label: string;
  render?: (item: T) => ReactNode;
  mobileLabel?: string;
  hideOnMobile?: boolean;
};

type ResponsiveTableProps<T> = {
  data: T[];
  columns: Column<T>[];
  onRowClick?: (item: T) => void;
  keyExtractor: (item: T) => string;
};

export default function ResponsiveTable<T>({
  data,
  columns,
  onRowClick,
  keyExtractor,
}: ResponsiveTableProps<T>) {
  const { isMobile } = useMobileDetect();

  if (isMobile) {
    return (
      <div className="space-y-3">
        {data.map((item) => (
          <div
            key={keyExtractor(item)}
            onClick={() => onRowClick?.(item)}
            className={`rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${
              onRowClick ? 'cursor-pointer active:bg-slate-50 dark:active:bg-slate-800' : ''
            }`}
          >
            {columns
              .filter((col) => !col.hideOnMobile)
              .map((col) => (
                <div key={col.key} className="mb-2 last:mb-0">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {col.mobileLabel || col.label}
                  </div>
                  <div className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                    {col.render
                      ? col.render(item)
                      : String((item as Record<string, unknown>)[col.key] ?? '')}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full">
        <thead className="bg-slate-50 dark:bg-slate-900">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
          {data.map((item) => (
            <tr
              key={keyExtractor(item)}
              onClick={() => onRowClick?.(item)}
              className={onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">
                  {col.render
                    ? col.render(item)
                    : String((item as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
