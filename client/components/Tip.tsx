import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bubble, type Align, type Side } from '@/components/TipBubble';

/** How long a pointer rests on a trigger before its tooltip opens. */
const DELAY = 400;
/** Moving on to the next trigger this soon after one closes opens it at once. */
const SKIP_DELAY = 300;

let lastClosed = 0;

/**
 * A tooltip on one element, in one line: `<Tip content="Rescan"><button …/></Tip>`.
 * The child becomes the trigger, so it must be a DOM element. With no content
 * it renders the child alone. It opens when a pointer rests on the trigger or
 * the keyboard focuses it, and closes on leaving, a click, Escape or a scroll.
 */
export function Tip({
  content,
  children,
  side = 'top',
  align = 'center',
  mono = false,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  align?: Align;
  /** A path or a `file:line`, set in the code face. */
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const timer = useRef(0);
  const id = useId();

  const show = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen((was) => {
      if (was) lastClosed = Date.now();
      return false;
    });
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && hide();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);

  if (content === null || content === undefined || content === '') return children;

  const own = children.props as Record<string, ((event: Event) => void) | undefined>;
  const chain = (name: string, then: (event: Event) => void) => (event: Event) => {
    own[name]?.(event);
    then(event);
  };

  return (
    <>
      {cloneElement(children, {
        ref: trigger,
        'aria-describedby': open ? id : undefined,
        onPointerEnter: chain('onPointerEnter', (event) => {
          // A tap is a click, not a hover.
          if ((event as PointerEvent).pointerType === 'touch') return;
          show(Date.now() - lastClosed < SKIP_DELAY ? 0 : DELAY);
        }),
        onPointerLeave: chain('onPointerLeave', hide),
        onPointerDown: chain('onPointerDown', hide),
        // Focus from the keyboard, not the focus a click leaves behind.
        onFocus: chain('onFocus', (event) => (event.currentTarget as Element).matches(':focus-visible') && show(0)),
        onBlur: chain('onBlur', hide),
      })}
      {open && trigger.current
        ? createPortal(
            <Bubble id={id} anchor={trigger.current} side={side} align={align} mono={mono}>
              {content}
            </Bubble>,
            document.body,
          )
        : null}
    </>
  );
}
