import { Moon, Mountain, Settings, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { Link } from 'react-router';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/lib/hooks';

export function AppHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isDark = resolvedTheme === 'dark';

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Mountain className="size-5 text-primary" aria-hidden />
          TrailPlanner
        </Link>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Réglages"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </Button>
        </div>
      </div>
      {settingsOpen && (
        <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} />
      )}
    </header>
  );
}
