import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@api/http';
import { createRun, listRuns, listSources } from '@api/runs';
import type { RunSummary, Source } from '@api/runs';
import {
  AlertCircleIcon,
  BoltIcon,
  CheckIcon,
  InfoIcon,
  ListNumberedIcon,
  RssIcon,
  ScheduleIcon,
  TuneIcon,
} from '@components/ui/icons';
import WorkspaceLayout from '@components/workspace/WorkspaceLayout';

const INTERVALS = [
  { hours: 12, label: '12 часов', disabled: true },
  { hours: 24, label: '24 часа', disabled: false },
  { hours: 48, label: '48 часов', disabled: true },
] as const;

const NEWS_COUNTS = [
  { value: 3, disabled: true },
  { value: 5, disabled: false },
  { value: 7, disabled: true },
  { value: 10, disabled: true },
] as const;

const POLICIES = [
  'Склейка дубликатов',
  'Защита Prompt Injection',
  'Без оценочных суждений',
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
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingData, setLoadingData] = useState(true);
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
        const [sourceList, runList] = await Promise.all([
          listSources(),
          listRuns(6),
        ]);

        if (!active) {
          return;
        }

        setSources(sourceList);
        setSelectedSources(
          new Set(sourceList.filter((source) => source.enabled).map((source) => source.id)),
        );
        setRuns(runList);
      } catch (error) {
        if (active) {
          setDataError(
            error instanceof ApiError
              ? error.message
              : 'Не удалось загрузить источники и последние сессии.',
          );
        }
      } finally {
        if (active) {
          setLoadingData(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void listRuns(6).then(setRuns).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(timer);
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
    selectAllSources();
    setIntervalHours(24);
    setNewsCount(5);
    setSubmitError(null);
    setSessionNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openRun(run: RunSummary) {
    navigate(`/runs/${run.id}`);
  }

  function handleDeleteRun(run: RunSummary) {
    setSessionNotice(
      `Удаление сессии ${run.id.slice(0, 8)} будет доступно после подключения backend.`,
    );
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
  const estimatedSeconds =
    selectedCount === 0
      ? 0
      : Math.round(35 + selectedCount * 2.5 + newsCount * 4 + (intervalHours / 12) * 4);

  return (
    <WorkspaceLayout
      runs={runs}
      loadingRuns={loadingData}
      onSelectRun={openRun}
      onDeleteRun={handleDeleteRun}
      onNewQuery={resetForm}
    >
      <form className="ws-card" onSubmit={handleSubmit}>
        <div className="ws-card-head">
          <div className="ws-card-icon">
            <TuneIcon />
          </div>
          <div>
            <h1 className="ws-card-title">Параметры сбора и анализа новостей</h1>
            <p className="ws-card-sub">
              Настройте окно мониторинга, количество материалов и источники.
            </p>
          </div>
        </div>

        {dataError && (
          <div className="ws-alert ws-alert--error" role="alert">
            <AlertCircleIcon />
            <span>{dataError}</span>
          </div>
        )}

        {sessionNotice && (
          <div className="ws-alert ws-alert--info" role="status">
            <InfoIcon />
            <span>{sessionNotice}</span>
          </div>
        )}

        <div className="ws-params">
          <section className="ws-param ws-param--5">
            <div className="ws-param-head">
              <span className="ws-param-title">
                <ScheduleIcon />
                Временной интервал
              </span>
              <span className="ws-param-hint">За последние 24ч</span>
            </div>
            <div className="ws-pills">
              {INTERVALS.map((item) => (
                <button
                  className={`ws-pill${
                    intervalHours === item.hours ? ' ws-pill--active' : ''
                  }${item.disabled ? ' ws-pill--disabled' : ''}`}
                  key={item.hours}
                  type="button"
                  disabled={item.disabled}
                  title={
                    item.disabled
                      ? 'Пока поддерживается только 24-часовой интервал'
                      : undefined
                  }
                  onClick={() => setIntervalHours(item.hours)}
                >
                  {intervalHours === item.hours && <CheckIcon />}
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="ws-param ws-param--7">
            <div className="ws-param-head">
              <span className="ws-param-title">
                <ListNumberedIcon />
                Количество новостей в дайджесте
              </span>
              <span className="ws-param-badge">Оптимум для дежурной смены</span>
            </div>
            <div className="ws-pills">
              {NEWS_COUNTS.map((item) => (
                <button
                  className={`ws-pill${
                    newsCount === item.value ? ' ws-pill--active' : ''
                  }${item.disabled ? ' ws-pill--disabled' : ''}`}
                  key={item.value}
                  type="button"
                  disabled={item.disabled}
                  title={
                    item.disabled
                      ? 'Количество финальных материалов пока задаётся регламентом'
                      : undefined
                  }
                  onClick={() => setNewsCount(item.value)}
                >
                  {newsCount === item.value && <CheckIcon />}
                  {item.value} новостей
                </button>
              ))}
            </div>
          </section>

          <section className="ws-param ws-param--12">
            <div className="ws-param-head">
              <span className="ws-param-title">
                <RssIcon />
                Источники мониторинга
                <span className="ws-param-badge">
                  {selectedCount} из {enabledCount} активно
                </span>
              </span>
              <span className="ws-sources-actions">
                <button className="ws-link-button" type="button" onClick={selectAllSources}>
                  Выбрать все
                </button>
                <span className="ws-muted-dot">•</span>
                <button className="ws-link-button ws-link-button--muted" type="button" onClick={resetSources}>
                  Сбросить
                </button>
              </span>
            </div>

            <div className="ws-sources">
              {loadingData && <span className="ws-sidebar-note">Загружаем источники…</span>}
              {!loadingData && sources.length === 0 && (
                <span className="ws-sidebar-note">Источники не найдены.</span>
              )}
              {sources.map((source) => {
                const selected = selectedSources.has(source.id);
                return (
                  <button
                    className={`ws-source${selected ? ' ws-source--selected' : ''}`}
                    key={source.id}
                    type="button"
                    title={source.url}
                    onClick={() => toggleSource(source.id)}
                  >
                    <span className="ws-source-dot" />
                    <span>{source.name}</span>
                    <span className="ws-source-badge">{source.trust}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="ws-card-footer">
          <div className="ws-policies">
            {POLICIES.map((policy) => (
              <label className="ws-switch-label" key={policy}>
                <input
                  className="ws-switch-input"
                  type="checkbox"
                  checked
                  disabled
                  readOnly
                />
                <span className="ws-switch-track" />
                <span>{policy}</span>
              </label>
            ))}
          </div>

          <div className="ws-submit-block">
            <span className="ws-estimate">
              Примерное время:{' '}
              <strong>
                {selectedCount === 0 ? 'выберите источники' : formatEstimate(estimatedSeconds)}
              </strong>
            </span>
            <button className="ws-submit" type="submit" disabled={submitting}>
              <BoltIcon />
              {submitting ? 'Запускаем…' : 'Сформировать дайджест'}
            </button>
          </div>
        </div>

        {submitError && (
          <div className="ws-alert ws-alert--error" role="alert">
            <AlertCircleIcon />
            <span>{submitError}</span>
          </div>
        )}

      </form>

    </WorkspaceLayout>
  );
}
