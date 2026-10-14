import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui's Tooltip over Radix, the one primitive the dashboard takes from a
 * library: placing a popup against the edges of the window and keeping it
 * reachable from the keyboard is behaviour, not styling.
 */

function TooltipProvider({ delayDuration = 0, ...props }: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background z-50 w-fit max-w-sm rounded-md px-3 py-1.5 text-xs text-balance break-words',
          'origin-(--radix-tooltip-content-transform-origin)',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * A tooltip on one element, in one line: `<Tip content="Rescan"><button …/></Tip>`.
 * The child becomes the trigger, so it must take a ref and pass its props on —
 * any DOM element does. With no content it renders the child alone.
 */
function Tip({
  content,
  children,
  side,
  align,
  mono = false,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: ComponentProps<typeof TooltipPrimitive.Content>['side'];
  align?: ComponentProps<typeof TooltipPrimitive.Content>['align'];
  /** A path or a `file:line`, set in the code face. */
  mono?: boolean;
}) {
  if (content === null || content === undefined || content === '') return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={cn(mono && 'font-mono text-[11px] break-all')}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export { Tip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
