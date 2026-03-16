import { useState, useEffect, useRef, useCallback } from 'react';

type InfiniteScrollProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
  threshold?: number;
  keyExtractor: (item: T, index: number) => string;
};

export default function InfiniteScroll<T>({
  items,
  renderItem,
  loadMore,
  hasMore,
  isLoading,
  threshold = 200,
  keyExtractor,
}: InfiniteScrollProps<T>) {
  const [isFetching, setIsFetching] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);

  const handleLoadMore = useCallback(async () => {
    if (isFetching || !hasMore || isLoading) return;

    setIsFetching(true);
    try {
      await loadMore();
    } finally {
      setIsFetching(false);
    }
  }, [isFetching, hasMore, isLoading, loadMore]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          void handleLoadMore();
        }
      },
      { threshold: 0.1, rootMargin: `${threshold}px` }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [hasMore, isLoading, threshold, handleLoadMore]);

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={keyExtractor(item, index)}>{renderItem(item, index)}</div>
      ))}

      {hasMore && (
        <div ref={observerTarget} className="flex justify-center py-4">
          {(isLoading || isFetching) && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-red dark:border-slate-700" />
              Загрузка...
            </div>
          )}
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Все элементы загружены
        </div>
      )}
    </div>
  );
}
