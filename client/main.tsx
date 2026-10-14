import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { ThemeProvider } from '@/components/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('routelens: #root is missing from the dashboard shell');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={400}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
