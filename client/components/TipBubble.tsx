import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

/** Between the trigger and the tooltip, room for the arrow. */
const GAP = 6;
/** The closest a tooltip comes to the window's edges. */
const MARGIN = 8;

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** The tooltip itself, placed beside its anchor before it is first painted. */
export function Bubble({
  id,
  anchor,
  side,
  align,
  mono,
  children,
}: {
  id: string;
  anchor: HTMLElement;
  side: Side;
  align: Align;
  mono: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);

  // Measured and placed before the first paint, so it never shows anywhere else.
  useLayoutEffect(() => {
    const element = box.current!;
    const place = placement(anchor.getBoundingClientRect(), element.getBoundingClientRect(), side, align);
    Object.assign(element.style, {
      top: `${place.top}px`,
      left: `${place.left}px`,
      transformOrigin: OPPOSITE[place.side],
      visibility: 'visible',
    });
    const vertical = place.side === 'top' || place.side === 'bottom';
    Object.assign(arrow.current!.style, {
      [OPPOSITE[place.side]]: '-4px',
      [vertical ? 'left' : 'top']: `${place.arrow - 4}px`,
    });
  }, [anchor, side, align]);

  return (
    <div
      ref={box}
      id={id}
      role="tooltip"
      data-slot="tooltip"
      style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
      className={cn(
        'bg-foreground text-background pointer-events-none z-50 w-fit max-w-sm rounded-md px-3 py-1.5 text-xs text-balance break-words',
        mono && 'font-mono text-[11px] break-all',
      )}
    >
      {children}
      <span ref={arrow} className="bg-foreground absolute size-2 rotate-45 rounded-[1px]" />
    </div>
  );
}

/**
 * Where a tooltip goes: on `side` of the anchor, or the opposite side when that
 * one has no room and the other has more, slid along the anchor to stay inside
 * the window. `arrow` is where the anchor's middle falls along the tooltip.
 */
function placement(anchor: DOMRect, box: DOMRect, preferred: Side, align: Align) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const room: Record<Side, number> = {
    top: anchor.top,
    bottom: height - anchor.bottom,
    left: anchor.left,
    right: width - anchor.right,
  };
  const vertical = preferred === 'top' || preferred === 'bottom';
  const needed = (vertical ? box.height : box.width) + GAP + MARGIN;
  const side = room[preferred] < needed && room[OPPOSITE[preferred]] > room[preferred] ? OPPOSITE[preferred] : preferred;

  const along = (start: number, end: number, size: number, limit: number) => {
    const at = align === 'start' ? start : align === 'end' ? end - size : (start + end) / 2 - size / 2;
    return clamp(at, MARGIN, limit - MARGIN - size);
  };

  if (vertical) {
    const left = along(anchor.left, anchor.right, box.width, width);
    const top = side === 'top' ? anchor.top - GAP - box.height : anchor.bottom + GAP;
    return { side, top, left, arrow: clamp(anchor.left + anchor.width / 2 - left, 10, box.width - 10) };
  }
  const top = along(anchor.top, anchor.bottom, box.height, height);
  const left = side === 'left' ? anchor.left - GAP - box.width : anchor.right + GAP;
  return { side, top, left, arrow: clamp(anchor.top + anchor.height / 2 - top, 8, box.height - 8) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
