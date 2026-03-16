import { useState, useRef, type ReactNode, type TouchEvent } from 'react';
import { RefreshCw } from 'lucide-react';

type PullToRefreshProps = {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  threshold?: number;
};

export default function PullToRefresh({
  children,
  onRefresh,
  threshold = 80,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [touchStart, setTouchStart] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      setTouchStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!touchStart || isRefreshing) return;

    const currentTouch = e.touches[0].clientY;
    const distance = currentTouch - touchStart;

    if (distance > 0 && containerRef.current && containerRef.current.scrollTop === 0) {
      setPullDistance(Math.min(distance, threshold * 1.5));
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
    setPullDistance(0);
    setTouchStart(0);
  };

  const rotation = Math.min((pullDistance / threshold) * 360, 360);
  const opacity = Math.min(pullDistance / threshold, 1);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative h-full overflow-auto"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center justify-center transition-transform"
        style={{
          transform: `translateX(-50%) translateY(${Math.min(pullDistance - 20, threshold)}px)`,
          opacity,
        }}
      >
        <div className="rounded-full bg-white p-2 shadow-lg dark:bg-slate-800">
          <RefreshCw
            size={20}
            className={`text-brand-red ${isRefreshing ? 'animate-spin' : ''}`}
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        </div>
      </div>
      <div
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: pullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
