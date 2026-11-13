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
  FormatGuide,
  InfoIcon,
  ListNumberedIcon,
  RssIcon,
  ScheduleIcon,
  TuneIcon,
  UploadIcon,
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

type DatasetFormat = 'json' | 'jsonl' | 'csv' | 'text' | 'zip';

const DATASET_FORMATS: Record<DatasetFormat, { label: string; example: string }> = {
  json: {
    label: 'JSON',
    example: `{
  "items": [
    {
      "id": "news-1",
      "title": "Заголовок новости",
      "text": "Полный текст публикации",
      "url": "https://example.com/news/1",
      "source": "Название источника",
      "published_at": "2026-11-12T10:00:00+03:00"
    }
  ]
}`,
  },
  jsonl: {
    label: 'JSONL',
    example: `{"id":"news-1","title":"Заголовок","text":"Текст","url":"https://example.com/news/1","source":"Источник","published_at":"2026-11-12T10:00:00+03:00"}
{"id":"news-2","title":"Заголовок 2","text":"Текст 2","url":"https://example.com/news/2","source":"Источник","published_at":"2026-11-12T11:00:00+03:00"}`,
  },
  csv: {
    label: 'CSV',
    example: `id,title,text,url,source,published_at
news-1,Заголовок,Текст,https://example.com/news/1,Источник,2026-11-12T10:00:00+03:00`,
  },
  text: {
    label: 'TXT / MD / HTML',
    example: `Один материал на файл.
Название файла может использоваться как заголовок.
Поддерживаются .txt, .md и .html.`,
  },
  zip: {
    label: 'ZIP',
    example: `ZIP-архив с любыми из поддерживаемых файлов:
JSON, JSONL, CSV, TXT, MD или HTML.`,
  },
};



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
    renameRunLocally,
  } = useRunsFeed();
  const [loadingSources, setLoadingSources] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [intervalHours, setIntervalHours] = useState(24);
  const [newsCount, setNewsCount] = useState(5);
  const [includeImages, setIncludeImages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [controlTime, setControlTime] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [datasetFormat, setDatasetFormat] = useState<DatasetFormat>('json');

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
    setFiles([]);
    setControlTime(undefined);
    setFileError(null);
    setSubmitError(null);
    setSessionNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleFiles(list: FileList | null) {
    const next = Array.from(list ?? []);
    setFileError(null);
    setFiles(next);
    setControlTime(undefined);
    const first = next.find((file) => /\.json$/i.test(file.name));
    if (!first) {
      return;
    }
    try {
      const parsed = JSON.parse(await first.text()) as {
        control_time?: unknown;
        items?: unknown;
      };
      if (typeof parsed.control_time === 'string') {
        setControlTime(parsed.control_time);
      }
      if (!Array.isArray(parsed.items)) {
        setFileError('В JSON нет массива items.');
      }
    } catch {
      setFileError('Не удалось прочитать JSON-файл.');
    }
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

    if (selectedSources.size === 0 && files.length === 0) {
      setSubmitError('Выберите источники и/или загрузите файлы датасета.');
      return;
    }

    setSubmitting(true);
    try {
      const run = await createRun({
        mode: files.length > 0 ? 'file' : 'live',
        sources: [...selectedSources],
        files,
        controlTime,
        intervalHours,
        maxItems: newsCount,
        policies: {
          dedup: true,
          injection_guard: true,
          neutral: true,
          include_images: includeImages,
        },
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
  const canSubmit =
    (selectedCount > 0 || files.length > 0) && !submitting && !loadingSources;
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
      onRenameRun={renameRunLocally}
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
                  </button>
                );
              })}
            </div>
          </section>

          <section className={cx(styles, "ws-param ws-param--12")}>
            <div className={cx(styles, "ws-param-head")}>
              <span className={cx(styles, "ws-param-title")}>
                <UploadIcon />
                Файлы датасета
                <span className={cx(styles, "ws-param-badge")}>
                  {files.length > 0 ? `${files.length} файлов` : 'необязательно'}
                </span>
              </span>
              <span className={cx(styles, "ws-param-hint")}>
                JSON, JSONL, CSV или ZIP
              </span>
            </div>
            <label
              className={cx(styles, `ws-file-picker${dragActive ? ' ws-file-picker--active' : ''}`)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                void handleFiles(event.dataTransfer.files);
              }}
            >
              <input
                type="file"
                multiple
                accept=".json,.jsonl,.ndjson,.csv,.zip,.txt,.md,.html"
                onChange={(event) => void handleFiles(event.target.files)}
              />
              <UploadIcon />
              <span>
                <strong>Выбрать файлы</strong>
                <small>или перетащите их в окно</small>
              </span>
            </label>
            {fileError && <span className={cx(styles, "ws-file-error")}>{fileError}</span>}
            {files.length > 0 && (
              <div className={cx(styles, "ws-file-list")}>
                {files.map((file) => (
                  <span className={cx(styles, "ws-file-item")} key={`${file.name}-${file.size}`}>
                    <span>{file.name}</span>
                    <small>{Math.ceil(file.size / 1024)} КБ</small>
                    <button
                      type="button"
                      aria-label={`Убрать ${file.name}`}
                      onClick={() => {
                        const next = files.filter((item) => item !== file);
                        setFiles(next);
                        setControlTime(undefined);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {controlTime && (
              <span className={cx(styles, "ws-param-hint")}>
                Контрольное время из датасета: {new Date(controlTime).toLocaleString('ru-RU')}
              </span>
            )}
            <FormatGuide
              title="Форматы файлов"
              formats={(Object.keys(DATASET_FORMATS) as DatasetFormat[]).map((format) => ({
                id: format,
                label: DATASET_FORMATS[format].label,
                example: DATASET_FORMATS[format].example,
              }))}
              value={datasetFormat}
              onChange={(value) => setDatasetFormat(value as DatasetFormat)}
              note="Можно загрузить один или несколько файлов. ZIP распаковывается автоматически."
            />
          </section>
        </div>

        <div className={cx(styles, "ws-card-footer")}>
          <button
            className={cx(styles, `ws-media-toggle ws-media-toggle--bare${
              includeImages ? ' ws-media-toggle--on' : ''
            }`)}
            type="button"
            role="switch"
            aria-checked={includeImages}
            title="Добавлять изображение из первоисточника, если оно есть"
            onClick={() => setIncludeImages((value) => !value)}
          >
            <span className={cx(styles, "ws-media-toggle-track")}>
              <span className={cx(styles, "ws-media-toggle-thumb")} />
            </span>
            <span>Изображения</span>
          </button>
          <div className={cx(styles, "ws-submit-block")}>
            <span className={cx(styles, "ws-estimate")}>
              Примерное время:{' '}
              <strong>
                {selectedCount === 0
                  ? files.length > 0
                    ? 'анализ по загруженным файлам'
                    : 'выберите источники и/или файлы'
                  : files.length > 0
                    ? `${formatEstimate(estimatedSeconds)} + файлы`
                    : formatEstimate(estimatedSeconds)}
              </strong>
            </span>
            <button
              className={cx(styles, "ws-submit")}
              type="submit"
              disabled={!canSubmit}
              title={
                selectedCount === 0 && files.length === 0
                  ? 'Выберите источник и/или загрузите файлы'
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
