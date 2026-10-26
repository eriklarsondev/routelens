import { useCallback, useEffect, useState } from 'react';
import { fetchData, onFileChange } from '@/api';
import type { DashboardData } from '@/types';

/** The scan, fetched on load and again whenever a scanned file changes or the developer asks. */
export function useScan() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    if (fresh) setScanning(true);
    try {
      setData(await fetchData(fresh));
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // The server watches the project and pings when a scanned file changes.
  useEffect(() => onFileChange(() => void load(true)), [load]);

  const rescan = useCallback(() => void load(true), [load]);

  return { data, error, scanning, rescan };
}
