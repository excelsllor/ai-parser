import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@api/http';
import { createRun, deleteRun, listSources } from '@api/runs';
import type { RunSummary, Source } from '@api/runs';
import useRunsFeed from '@hooks/useRunsFeed';
import {
  AlertCircleIcon,
  BoltIcon,
  CheckIcon,
  InfoIcon,
  ListNumberedIcon,
  RssIcon,
  ScheduleIcon,
  TuneIcon,
} from '@components/ui';
import { WorkspaceLayout } from '@components';
import { cx } from '@utils/cx';

import workspaceStyles from '@components/workspace/workspace.module.css';

const styles = workspaceStyles;

const INTERVALS = [
  { hours: 12, label: '12 часов' },
  { hours: 24, label: '24 часа' },
  { hours: 48, label: '48 часов' },
] as const;

const NEWS_COUNTS = [
  { value: 3 },
  { value: 5 },
  { value: 7 },
  { value: 10 },
] as const;

function formatEstimate(seconds: number): string {
  if (seconds <= 0) {
    return '—';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `~${minutes} мин ${rest.toString().padStart(2, '0')} с`;
}

export default function WorkspacePage() {
  const navigate = useNavigate();

  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const {
    runs,
    loading: loadingRuns,
    loadingMore,
    hasMore,
    loadMore,
    removeRun,
  } = useRunsFeed();
  const [loadingSources, setLoadingSources] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [intervalHours, setIntervalHours] = useState(24);
  const [newsCount, setNewsCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled),
    [sources],
  );

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const sourceList = await listSources();

        if (!active) {
          return;
        }

        setSources(sourceList);
      } catch (error) {
        if (active) {
          setDataError(
            error instanceof ApiError
              ? error.message
              : 'Не удалось загрузить источники.',
          );
        }
      } finally {
        if (active) {
          setLoadingSources(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  function toggleSource(id: string) {
    setSelectedSources((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllSources() {
    setSelectedSources(new Set(enabledSources.map((source) => source.id)));
  }

  function resetSources() {
    setSelectedSources(new Set());
  }

  function resetForm() {
    setSelectedSources(new Set());
    setIntervalHours(24);
    setNewsCount(5);
    setSubmitError(null);
    setSessionNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openRun(run: RunSummary) {
    navigate(`/runs/${run.id}`);
  }

  async function handleDeleteRun(run: RunSummary) {
    setSessionNotice(null);
    try {
      await deleteRun(run.id);
      removeRun(run.id);
      setSessionNotice(`Сессия ${run.id.slice(0, 8)} удалена.`);
    } catch (error) {
      setDataError(
        error instanceof Error ? error.message : 'Не удалось удалить сессию.',
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    if (selectedSources.size === 0) {
      setSubmitError('Выберите хотя бы один источник мониторинга.');
      return;
    }

    setSubmitting(true);
    try {
      const run = await createRun({
        mode: 'live',
        sources: [...selectedSources],
        intervalHours,
        maxItems: newsCount,
      });
      navigate(`/runs/${run.id}`);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : 'Не удалось создать запрос. Проверьте соединение с сервером.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCount = selectedSources.size;
  const enabledCount = enabledSources.length;
  const canSubmit = selectedCount > 0 && !submitting && !loadingSources;
  const estimatedSeconds =
    selectedCount === 0
      ? 0
      : Math.round(35 + selectedCount * 2.5 + newsCount * 4 + (intervalHours / 12) * 4);

  return (
    <WorkspaceLayout
      runs={runs}
      loadingRuns={loadingSources || loadingRuns}
      loadingMoreRuns={loadingMore}
      hasMoreRuns={hasMore}
      onLoadMoreRuns={loadMore}
      onSelectRun={openRun}
      onDeleteRun={handleDeleteRun}
      onNewQuery={resetForm}
    >
      <form className={cx(styles, "ws-card")} onSubmit={handleSubmit}>
        <div className={cx(styles, "ws-card-head")}>
          <div className={cx(styles, "ws-card-icon")}>
            <TuneIcon />
          </div>
          <div>
            <h1 className={cx(styles, "ws-card-title")}>Параметры сбора и анализа новостей</h1>
            <p className={cx(styles, "ws-card-sub")}>
              Настройте окно мониторинга, количество материалов и источники.
            </p>
          </div>
        </div>

        {dataError && (
          <div className={cx(styles, "ws-alert ws-alert--error")} role="alert">
            <AlertCircleIcon />
            <span>{dataError}</span>
          </div>
        )}

        {sessionNotice && (
          <div className={cx(styles, "ws-alert ws-alert--info")} role="status">
            <InfoIcon />
            <span>{sessionNotice}</span>
          </div>
        )}

        <div className={cx(styles, "ws-params")}>
          <section className={cx(styles, "ws-param ws-param--5")}>
            <div className={cx(styles, "ws-param-head")}>
              <span className={cx(styles, "ws-param-title")}>
                <ScheduleIcon />
                Временной интервал
              </span>
              <span className={cx(styles, "ws-param-hint")}>За последние {intervalHours} ч</span>
            </div>
            <div className={cx(styles, "ws-pills")}>
              {INTERVALS.map((item) => (
                <button
                  className={cx(styles, `ws-pill${
                    intervalHours === item.hours ? ' ws-pill--active' : ''
                  }`)}
                  key={item.hours}
                  type="button"
                  onClick={() => setIntervalHours(item.hours)}
                >
                  {intervalHours === item.hours && <CheckIcon />}
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className={cx(styles, "ws-param ws-param--7")}>
            <div className={cx(styles, "ws-param-head")}>
              <span className={cx(styles, "ws-param-title")}>
                <ListNumberedIcon />
                Количество новостей в дайджесте
              </span>
              <span className={cx(styles, "ws-param-badge")}>Оптимум для дежурной смены</span>
            </div>
            <div className={cx(styles, "ws-pills")}>
              {NEWS_COUNTS.map((item) => (
                <button
                  className={cx(styles, `ws-pill${
                    newsCount === item.value ? ' ws-pill--active' : ''
                  }`)}
                  key={item.value}
                  type="button"
                  onClick={() => setNewsCount(item.value)}
                >
                  {newsCount === item.value && <CheckIcon />}
                  {item.value} новостей
                </button>
              ))}
            </div>
          </section>

          <section className={cx(styles, "ws-param ws-param--12")}>
            <div className={cx(styles, "ws-param-head")}>
              <span className={cx(styles, "ws-param-title")}>
                <RssIcon />
                Источники мониторинга
                <span className={cx(styles, "ws-param-badge")}>
                  {selectedCount} из {enabledCount} активно
                </span>
              </span>
              <span className={cx(styles, "ws-sources-actions")}>
                <button className={cx(styles, "ws-link-button")} type="button" onClick={selectAllSources}>
                  Выбрать все
                </button>
                <span className={cx(styles, "ws-muted-dot")}>•</span>
                <button className={cx(styles, "ws-link-button ws-link-button--muted")} type="button" onClick={resetSources}>
                  Сбросить
                </button>
              </span>
            </div>

            <div className={cx(styles, "ws-sources")}>
              {loadingSources && <span className={cx(styles, "ws-sidebar-note")}>Загружаем источники…</span>}
              {!loadingSources && sources.length === 0 && (
                <span className={cx(styles, "ws-sidebar-note")}>Источники не найдены.</span>
              )}
              {sources.map((source) => {
                const selected = selectedSources.has(source.id);
                return (
                  <button
                    className={cx(styles, `ws-source${selected ? ' ws-source--selected' : ''}`)}
                    key={source.id}
                    type="button"
                    title={source.url}
                    onClick={() => toggleSource(source.id)}
                  >
                    <span className={cx(styles, "ws-source-dot")} />
                    <span>{source.name}</span>
                    <span className={cx(styles, "ws-source-badge")}>{source.trust}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className={cx(styles, "ws-card-footer")}>
          <div className={cx(styles, "ws-submit-block")}>
            <span className={cx(styles, "ws-estimate")}>
              Примерное время:{' '}
              <strong>
                {selectedCount === 0 ? 'выберите источники' : formatEstimate(estimatedSeconds)}
              </strong>
            </span>
            <button
              className={cx(styles, "ws-submit")}
              type="submit"
              disabled={!canSubmit}
              title={
                selectedCount === 0
                  ? 'Выберите хотя бы один источник'
                  : undefined
              }
            >
              <BoltIcon />
              {submitting ? 'Запускаем…' : 'Сформировать дайджест'}
            </button>
          </div>
        </div>

        {submitError && (
          <div className={cx(styles, "ws-alert ws-alert--error")} role="alert">
            <AlertCircleIcon />
            <span>{submitError}</span>
          </div>
        )}

      </form>

    </WorkspaceLayout>
  );
}
