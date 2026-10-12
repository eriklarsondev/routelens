import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme';
import { cn } from '@/lib/utils';
import type { DashboardData } from '@/types';

interface HeaderProps {
  data: DashboardData | null;
  scanning: boolean;
  onRescan: () => void;
}

export function Header({ data, scanning, onRescan }: HeaderProps) {
  return (
    <header className="bg-card flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Logo />
        <div className="min-w-0">
          <h1 className="text-sm leading-tight font-semibold tracking-tight">routelens</h1>
          <p className="text-muted-foreground truncate font-mono text-[11px] leading-tight">
            {data?.root ?? 'scanning…'}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-method-put border-method-put/35 bg-method-put/10 hidden sm:inline-flex"
            >
              dev only
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Refuses to run when NODE_ENV=production</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-muted-foreground hidden sm:inline-flex">
              read only
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Reads your source. Never sends a request to your endpoints.</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 !h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onRescan} disabled={scanning}>
              <RefreshCw className={cn(scanning && 'animate-spin')} />
              <span className="sr-only">Rescan</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rescan the project</TooltipContent>
        </Tooltip>

        <ThemeToggle />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="border-primary relative flex size-6 shrink-0 items-center justify-center rounded-full border-2"
    >
      <span className="bg-primary size-2 rounded-full" />
    </span>
  );
}
