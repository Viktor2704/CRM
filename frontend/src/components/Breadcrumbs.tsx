import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

type Crumb = {
  label: string;
  to?: string;
};

interface BreadcrumbsProps {
  items: Crumb[];
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Навигационная цепочка" className="mb-4 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1">
          {index > 0 ? <ChevronRight size={14} /> : null}
          {item.to ? (
            <Link to={item.to} className="transition hover:text-slate-900 dark:hover:text-white">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-slate-900 dark:text-white">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
