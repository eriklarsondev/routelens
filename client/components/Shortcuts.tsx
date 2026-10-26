const SHORTCUTS: Array<[string, string]> = [
  ['/', 'filter'],
  ['↑ ↓', 'move, across cards'],
  ['← →', 'pick a method'],
  ['space', 'show / hide it'],
  ['↵', 'open in a tab'],
  ['o', 'open the source'],
  ['esc', 'clear the selection'],
];

/** The side panel before anything is selected: what it is for, and the keys. */
export function Shortcuts() {
  return (
    <aside className="bg-card text-muted-foreground flex h-full flex-col gap-4 border-l p-6 text-sm">
      <p>Select an endpoint to get its URL, what runs in front of it and its source.</p>
      <dl className="grid gap-1 font-mono text-xs">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="flex gap-3">
            <dt className="w-12 shrink-0 text-right">{keys}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
