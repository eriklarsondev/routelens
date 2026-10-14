import { useState } from 'react';
import { Check, Copy } from '@/components/icons';
import { cn, CONTROL } from '@/lib/utils';

export function CopyButton({
  value,
  label,
  icon: Glyph = Copy,
  className,
}: {
  value: string;
  label: string;
  icon?: typeof Copy;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={cn(CONTROL, className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard access can be denied; the text is on screen either way.
        }
      }}
    >
      {copied ? <Check className="text-method-get" /> : <Glyph />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}
