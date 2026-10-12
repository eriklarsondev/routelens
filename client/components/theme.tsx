import { createContext, useContext, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from '@/components/icons';
import { CONTROL } from '@/lib/utils';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'routelens-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];

const ThemeContext = createContext<{ theme: Theme; cycle: () => void } | null>(null);

function stored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Private browsing and friends: fall through to the system preference.
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'system' ? query.matches : theme === 'dark';
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();

    // Only `system` needs to follow the OS once it changes under us.
    if (theme !== 'system') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not worth failing over.
    }
  };

  return <ThemeContext.Provider value={{ theme, cycle }}>{children}</ThemeContext.Provider>;
}

const ICON = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeToggle must be used inside ThemeProvider');

  const Glyph = ICON[context.theme];

  return (
    <button
      type="button"
      onClick={context.cycle}
      title="Switch theme"
      className={CONTROL}
    >
      <Glyph />
      {/* A fixed width so cycling the label does not resize the button. */}
      <span className="w-10 text-center capitalize">{context.theme}</span>
    </button>
  );
}
