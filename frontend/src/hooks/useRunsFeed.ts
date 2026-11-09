import { useCallback, useEffect, useRef, useState } from 'react';

import { listRuns } from '@api/runs';
import type { RunSummary } from '@api/runs';

const PAGE_SIZE = 10;
const POLL_MS = 5000;

export default function useRunsFeed() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const runsRef = useRef<RunSummary[]>([]);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  const update = useCallback((next: RunSummary[]) => {
    runsRef.current = next;
    setRuns(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const latest = await listRuns(PAGE_SIZE, 0);
      const latestIds = new Set(latest.map((run) => run.id));
      update([
        ...latest,
        ...runsRef.current.filter((run) => !latestIds.has(run.id)),
      ]);
    } catch {
      // Keep the current list when the background refresh fails.
    }
  }, [update]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = await listRuns(PAGE_SIZE, runsRef.current.length);
      const known = new Set(runsRef.current.map((run) => run.id));
      update([...runsRef.current, ...next.filter((run) => !known.has(run.id))]);
      hasMoreRef.current = next.length === PAGE_SIZE;
      setHasMore(hasMoreRef.current);
    } catch {
      // Leave the current list intact so the user can retry by scrolling.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [update]);

  const removeRun = useCallback(
    (runId: string) => {
      update(runsRef.current.filter((run) => run.id !== runId));
    },
    [update],
  );

  const renameRunLocally = useCallback(
    (runId: string, title: string) => {
      update(
        runsRef.current.map((run) =>
          run.id === runId ? { ...run, title } : run,
        ),
      );
    },
    [update],
  );

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const first = await listRuns(PAGE_SIZE, 0);
        if (!active) {
          return;
        }
        update(first);
        hasMoreRef.current = first.length === PAGE_SIZE;
        setHasMore(hasMoreRef.current);
      } catch {
        // The empty state is enough; the next poll retries the request.
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    const timer = window.setInterval(() => {
      if (active) {
        void refresh();
      }
    }, POLL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh, update]);

  return {
    runs,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    removeRun,
    renameRunLocally,
  };
}
