import { useRef, useState, type ReactNode, type TouchEvent } from 'react';

type SwipeableCardProps = {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  threshold?: number;
};

export default function SwipeableCard({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftAction,
  rightAction,
  threshold = 80,
}: SwipeableCardProps) {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e: TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
    setIsSwiping(true);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!touchStart) return;
    const currentTouch = e.targetTouches[0].clientX;
    const distance = currentTouch - touchStart;

    if (Math.abs(distance) > threshold) {
      setOffset(distance > 0 ? threshold : -threshold);
    } else {
      setOffset(distance);
    }
    setTouchEnd(currentTouch);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      setIsSwiping(false);
      setOffset(0);
      return;
    }

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && onSwipeLeft && Math.abs(offset) >= threshold) {
      onSwipeLeft();
    }
    if (isRightSwipe && onSwipeRight && Math.abs(offset) >= threshold) {
      onSwipeRight();
    }

    setIsSwiping(false);
    setOffset(0);
    setTouchStart(null);
    setTouchEnd(null);
  };

  return (
    <div className="relative overflow-hidden">
      {leftAction && offset > 0 && (
        <div className="absolute left-0 top-0 flex h-full items-center bg-green-500 px-4 text-white">
          {leftAction}
        </div>
      )}
      {rightAction && offset < 0 && (
        <div className="absolute right-0 top-0 flex h-full items-center bg-red-500 px-4 text-white">
          {rightAction}
        </div>
      )}
      <div
        ref={cardRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isSwiping ? 'none' : 'transform 0.3s ease-out',
        }}
        className="touch-pan-y"
      >
        {children}
      </div>
    </div>
  );
}
