import { openInEditor } from '@/api';
import { FileCode } from '@/components/icons';
import { Tip } from '@/components/Tip';
import { shortSource } from '@/lib/sources';

/** A route's file and line, which opens it in the editor. */
export function SourceLink({ file, line }: { file: string; line: number }) {
  return (
    <Tip content={`${file}:${line}`} align="start" mono>
      <button
        className="hover:text-foreground flex min-w-0 items-center gap-1 underline-offset-2 hover:underline"
        onClick={() => void openInEditor(file, line)}
      >
        <FileCode className="size-3 shrink-0" />
        {/* Shortened from the front: the filename and line are the half worth
            reading, and a deep path would otherwise push them out of sight. */}
        <span className="truncate">{shortSource(file, line, 44)}</span>
      </button>
    </Tip>
  );
}
