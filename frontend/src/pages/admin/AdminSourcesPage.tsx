import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import {
  createAdminKeyword,
  createAdminSource,
  deleteAdminKeyword,
  deleteAdminSource,
  listAdminKeywords,
  listAdminSources,
  toggleAdminSource,
} from '@api/admin';
import type { AdminKeyword, AdminSource } from '@api/admin';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  DeleteIcon,
  FormatGuide,
  KeyIcon,
  RefreshIcon,
  RssIcon,
  SearchIcon,
  SortHeader,
  UploadIcon,
} from '@components/ui';
import { cx } from '@utils/cx';
import { errorMessage } from '@utils/errors';
import { sortRows } from '@utils/sort';
import type { SortDirection } from '@utils/sort';
import { useToast } from '@context/toast';

import adminStyles from '@components/admin/Admin.module.css';

const styles = adminStyles;

import { formatDateTime, initials } from './utils';

const KIND_LABELS: Record<string, string> = {
  rss: 'RSS',
  html: 'HTML',
};

const TRUST_LABELS: Record<string, string> = {
  primary: 'Первичный',
  reprint: 'Перепечатка',
  unknown: 'Неизвестно',
};

interface SourceImportRow {
  name: string;
  kind: string;
  url: string;
  trust: string;
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sourceFromUrl(url: string): SourceImportRow {
  return {
    name: hostFromUrl(url),
    kind: /rss|feed|\.xml/i.test(url) ? 'rss' : 'html',
    url,
    trust: 'reprint',
  };
}

function sourceFromRecord(record: unknown): SourceImportRow | null {
  if (typeof record === 'string') {
    return sourceFromUrl(record.trim());
  }
  if (!record || typeof record !== 'object') {
    return null;
  }
  const row = record as Record<string, unknown>;
  const url = String(row.url ?? row.feed ?? '').trim();
  if (!url) {
    return null;
  }
  const kind = String(row.kind ?? '').trim();
  const trust = String(row.trust ?? '').trim();
  return {
    name: String(row.name ?? '').trim() || hostFromUrl(url),
    kind: kind === 'html' ? 'html' : 'rss',
    url,
    trust: trust === 'primary' || trust === 'unknown' ? trust : 'reprint',
  };
}

// shortcut: CSV import does not support quoted commas, upgrade if users need full CSV.
function parseSourceFile(text: string, filename: string): SourceImportRow[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (filename.toLowerCase().endsWith('.json') || /^[[{]/.test(trimmed)) {
    const data = JSON.parse(trimmed) as unknown;
    const records = Array.isArray(data) ? data : [data];
    return records.map(sourceFromRecord).filter((row): row is SourceImportRow => !!row);
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((part) => part.trim()).filter(Boolean);
      const urlIndex = parts.findIndex((part) => /^https?:\/\//i.test(part));
      if (urlIndex < 0) {
        return null;
      }
      const url = parts[urlIndex];
      const name = parts.find((part, index) => index !== urlIndex && !/^(rss|html|primary|reprint|unknown)$/i.test(part));
      const kind = parts.find((part) => /^(rss|html)$/i.test(part))?.toLowerCase();
      const trust = parts.find((part) => /^(primary|reprint|unknown)$/i.test(part))?.toLowerCase();
      return {
        name: name || hostFromUrl(url),
        kind: kind === 'html' ? 'html' : 'rss',
        url,
        trust: trust === 'primary' || trust === 'unknown' ? trust : 'reprint',
      };
    })
    .filter((row): row is SourceImportRow => !!row);
}

type ImportTarget = 'sources' | 'keywords';
type ImportFormat = 'json' | 'csv' | 'txt';

const IMPORT_EXAMPLES: Record<ImportTarget, Record<ImportFormat, string>> = {
  sources: {
    json: `[
  {
    "name": "Example News",
    "url": "https://example.com/rss",
    "kind": "rss",
    "trust": "reprint"
  }
]`,
    csv: `name,url,kind,trust
Example News,https://example.com/rss,rss,reprint
Company Blog,https://example.com/blog,html,primary`,
    txt: `# одна ссылка в строке — имя и тип определятся автоматически
https://example.com/rss
https://example.com/news,html`,
  },
  keywords: {
    json: `["вакансия", "курс", "реклама"]`,
    csv: `вакансия,курс,реклама`,
    txt: `# одно стоп-слово в строке
вакансия
курс
реклама`,
  },
};

function parseKeywordFile(text: string, filename: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (filename.toLowerCase().endsWith('.json') || /^[[{]/.test(trimmed)) {
    const data = JSON.parse(trimmed) as unknown;
    const records = Array.isArray(data) ? data : [data];
    return records
      .map((record) => (typeof record === 'string' ? record : String((record as Record<string, unknown>)?.word ?? '')))
      .map((word) => word.trim())
      .filter(Boolean);
  }
  return trimmed
    .split(/[\r\n,;]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export default function AdminSourcesPage() {
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [keywords, setKeywords] = useState<AdminKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { pushToast } = useToast();
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState('rss');
  const [url, setUrl] = useState('');
  const [trust, setTrust] = useState('reprint');
  const [submitting, setSubmitting] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [keywordSubmitting, setKeywordSubmitting] = useState(false);
  const [importingSources, setImportingSources] = useState(false);
  const [importingKeywords, setImportingKeywords] = useState(false);
  const [importTarget, setImportTarget] = useState<ImportTarget>('sources');
  const [importFormat, setImportFormat] = useState<ImportFormat>('json');
  const [sortKey, setSortKey] = useState<'name' | 'kind' | 'trust' | 'language' | 'synced'>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [sourceList, keywordList] = await Promise.all([
        listAdminSources(),
        listAdminKeywords(),
      ]);
      setSources(sourceList);
      setKeywords(keywordList);
      setUpdatedAt(new Date().toISOString());
    } catch (caught) {
      setError(errorMessage(caught, 'Не удалось загрузить источники.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sources.filter((source) => {
      const matchesQuery =
        !needle ||
        source.name.toLowerCase().includes(needle) ||
        source.url.toLowerCase().includes(needle);
      const matchesKind = kind === 'all' || source.kind === kind;
      const matchesStatus =
        status === 'all' ||
        (status === 'enabled' && source.enabled) ||
        (status === 'disabled' && !source.enabled);
      return matchesQuery && matchesKind && matchesStatus;
    });
  }, [sources, query, kind, status]);

  const sortedFiltered = useMemo(
    () =>
      sortRows(filtered, sortDirection, (source) => {
        switch (sortKey) {
          case 'kind':
            return source.kind;
          case 'trust':
            return source.trust;
          case 'language':
            return source.language;
          case 'synced':
            return source.last_synced_at;
          default:
            return source.name;
        }
      }),
    [filtered, sortKey, sortDirection],
  );

  const stats = useMemo(
    () => ({
      total: sources.length,
      active: sources.filter((source) => source.enabled).length,
      disabled: sources.filter((source) => !source.enabled).length,
      rss: sources.filter((source) => source.kind === 'rss').length,
      collected: sources.reduce((sum, source) => sum + source.items_collected, 0),
    }),
    [sources],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createAdminSource({ name, kind: sourceKind, url, trust });
      setName('');
      setUrl('');
      setAddOpen(false);
      pushToast('success', 'Источник добавлен.');
      await load();
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось добавить источник.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(source: AdminSource) {
    setBusyId(source.id);
    try {
      await toggleAdminSource(source.id, !source.enabled);
      setSources((previous) =>
        previous.map((item) =>
          item.id === source.id ? { ...item, enabled: !item.enabled } : item,
        ),
      );
      pushToast('success', source.enabled ? 'Источник выключен.' : 'Источник включён.');
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось изменить источник.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(source: AdminSource) {
    if (!window.confirm(`Удалить источник «${source.name}»?`)) {
      return;
    }
    setBusyId(source.id);
    try {
      await deleteAdminSource(source.id);
      setSources((previous) => previous.filter((item) => item.id !== source.id));
      pushToast('success', 'Источник удалён.');
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось удалить источник.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!keyword.trim()) {
      return;
    }
    setKeywordSubmitting(true);
    try {
      const created = await createAdminKeyword(keyword.trim());
      setKeywords((previous) => [created, ...previous]);
      setKeyword('');
      pushToast('success', 'Стоп-слово добавлено.');
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось добавить стоп-слово.'));
    } finally {
      setKeywordSubmitting(false);
    }
  }

  async function handleImportSources(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setImportingSources(true);
    try {
      const rows = parseSourceFile(await file.text(), file.name);
      if (!rows.length) {
        throw new Error('В файле не найдено источников.');
      }
      let added = 0;
      const failures: string[] = [];
      for (const row of rows.slice(0, 500)) {
        try {
          await createAdminSource(row);
          added += 1;
        } catch (caught) {
          failures.push(`${row.url}: ${caught instanceof Error ? caught.message : 'ошибка'}`);
        }
      }
      await load();
      if (!added) {
        pushToast('error', failures[0] ?? 'Не удалось добавить источники.');
      } else if (failures.length) {
        pushToast(
          'info',
          `Добавлено ${added} из ${rows.length}. Ошибок: ${failures.length}. ${failures[0]}`,
        );
      } else {
        pushToast('success', `Добавлено источников: ${added}.`);
      }
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось прочитать файл.'));
    } finally {
      setImportingSources(false);
    }
  }

  async function handleImportKeywords(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setImportingKeywords(true);
    try {
      const words = [...new Set(parseKeywordFile(await file.text(), file.name))];
      if (!words.length) {
        throw new Error('В файле не найдено стоп-слов.');
      }
      const existing = new Set(keywords.map((item) => item.word.toLowerCase()));
      let added = 0;
      const failures: string[] = [];
      for (const word of words.slice(0, 1000)) {
        if (existing.has(word.toLowerCase())) {
          continue;
        }
        try {
          await createAdminKeyword(word);
          added += 1;
        } catch (caught) {
          failures.push(`${word}: ${caught instanceof Error ? caught.message : 'ошибка'}`);
        }
      }
      await load();
      if (!added && failures.length) {
        pushToast('error', failures[0]);
      } else if (failures.length) {
        pushToast(
          'info',
          `Добавлено стоп-слов ${added} из ${words.length}. Ошибок: ${failures.length}. ${failures[0]}`,
        );
      } else {
        pushToast('success', `Добавлено стоп-слов: ${added}.`);
      }
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось прочитать файл.'));
    } finally {
      setImportingKeywords(false);
    }
  }

  async function handleDeleteKeyword(item: AdminKeyword) {
    try {
      await deleteAdminKeyword(item.id);
      setKeywords((previous) => previous.filter((entry) => entry.id !== item.id));
      pushToast('success', 'Стоп-слово удалено.');
    } catch (caught) {
      pushToast('error', errorMessage(caught, 'Не удалось удалить стоп-слово.'));
    }
  }

  return (
    <>
      <header className={cx(styles, "admin-head")}>
        <div>
          <span className={cx(styles, "admin-eyebrow")}>
            <RssIcon />
            Коннекторы данных
          </span>
          <h1 className={cx(styles, "admin-title")}>Источники сбора данных и парсинг</h1>
          <p className={cx(styles, "admin-sub")}>
            Конфигурация коннекторов, интервалов синхронизации и статусов парсинга.
          </p>
        </div>
        <div className={cx(styles, "admin-actions")}>
          <button className={cx(styles, "admin-button")} type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
          <button
            className={cx(styles, "admin-button admin-button--primary")}
            type="button"
            onClick={() => setAddOpen((value) => !value)}
          >
            {addOpen ? 'Скрыть форму' : '+ Добавить источник'}
          </button>
        </div>
      </header>

      {error && (
        <div className={cx(styles, "admin-error")} role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}

      <div className={cx(styles, "admin-stats")}>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Всего источников
            <RssIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{stats.total}</strong>
          <span className={cx(styles, "admin-stat-hint")}>
            {stats.rss} RSS · собрано {stats.collected.toLocaleString('ru-RU')} материалов
          </span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Активны
            <CheckCircleIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{stats.active}</strong>
          <span className={cx(styles, "admin-stat-hint")}>Участвуют в сборе</span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Приостановлены
            <AlertCircleIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{stats.disabled}</strong>
          <span className={cx(styles, "admin-stat-hint")}>Исключены из выборки</span>
        </article>
        <article className={cx(styles, "admin-stat")}>
          <span className={cx(styles, "admin-stat-label")}>
            Стоп-слов
            <KeyIcon />
          </span>
          <strong className={cx(styles, "admin-stat-value")}>{keywords.length}</strong>
          <span className={cx(styles, "admin-stat-hint")}>Фильтры ключевых слов</span>
        </article>
      </div>

      <FormatGuide
        className={cx(styles, "admin-mt-12")}
        title="Форматы импорта"
        subtitle="Источники и стоп-слова можно загрузить из JSON, CSV или TXT."
        formats={(['json', 'csv', 'txt'] as const).map((format) => ({
          id: format,
          label: format.toUpperCase(),
          example: IMPORT_EXAMPLES[importTarget][format],
        }))}
        value={importFormat}
        onChange={(value) => setImportFormat(value as ImportFormat)}
        targets={[
          { id: 'sources', label: 'Источники' },
          { id: 'keywords', label: 'Стоп-слова' },
        ]}
        target={importTarget}
        onTargetChange={(value) => setImportTarget(value as ImportTarget)}
        note="Файл выбирается кнопкой «Импорт из файла» в форме источника или стоп-слова. Для источников обязателен URL, название и тип можно не указывать."
      />

      {addOpen && (
        <form className={cx(styles, "admin-form")} onSubmit={handleCreate}>
          <label className={cx(styles, "admin-field")}>
            <span>Название</span>
            <input
              className={cx(styles, "admin-input")}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={cx(styles, "admin-field")}>
            <span>Тип коннектора</span>
            <select
              className={cx(styles, "admin-select")}
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value)}
            >
              <option value="rss">RSS</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <label className={cx(styles, "admin-field")}>
            <span>URL</span>
            <input
              className={cx(styles, "admin-input")}
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className={cx(styles, "admin-field")}>
            <span>Доверие</span>
            <select
              className={cx(styles, "admin-select")}
              value={trust}
              onChange={(event) => setTrust(event.target.value)}
            >
              <option value="reprint">Перепечатка</option>
              <option value="primary">Первичный</option>
              <option value="unknown">Неизвестно</option>
            </select>
          </label>
          <div className={cx(styles, "admin-form-actions")}>
            <label className={cx(styles, "admin-button")} title="JSON, CSV или TXT">
              <UploadIcon />
              {importingSources ? 'Импортируем…' : 'Импорт из файла'}
              <input
                accept=".json,.csv,.txt,text/plain,application/json,text/csv"
                className={cx(styles, "admin-hidden")}
                disabled={importingSources}
                type="file"
                onChange={(event) => void handleImportSources(event)}
              />
            </label>
            <button
              className={cx(styles, "admin-button admin-button--primary")}
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Добавляем…' : 'Добавить'}
            </button>
          </div>
        </form>
      )}

      <section className={cx(styles, "admin-card")}>
        <div className={cx(styles, "admin-filters")}>
          <div className={cx(styles, "admin-search")}>
            <SearchIcon />
            <input
              className={cx(styles, "admin-input")}
              placeholder="Поиск по названию или домену"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className={cx(styles, "admin-select")}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">Все типы</option>
            <option value="rss">RSS</option>
            <option value="html">HTML</option>
          </select>
          <select
            className={cx(styles, "admin-select")}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Все статусы</option>
            <option value="enabled">Активные</option>
            <option value="disabled">Приостановленные</option>
          </select>
        </div>

        <div className={cx(styles, "admin-table-wrap admin-mt-14")}>
          <table className={cx(styles, "admin-table")}>
            <thead>
              <tr>
                <SortHeader
                  label="Источник"
                  active={sortKey === 'name'}
                  direction={sortDirection}
                  onClick={() => toggleSort('name')}
                />
                <SortHeader
                  label="Тип"
                  active={sortKey === 'kind'}
                  direction={sortDirection}
                  onClick={() => toggleSort('kind')}
                />
                <SortHeader
                  label="Доверие"
                  active={sortKey === 'trust'}
                  direction={sortDirection}
                  onClick={() => toggleSort('trust')}
                />
                <SortHeader
                  label="Язык"
                  active={sortKey === 'language'}
                  direction={sortDirection}
                  onClick={() => toggleSort('language')}
                />
                <SortHeader
                  label="Синхронизация"
                  active={sortKey === 'synced'}
                  direction={sortDirection}
                  onClick={() => toggleSort('synced')}
                />
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((source) => (
                <tr key={source.id}>
                  <td>
                    <div className={cx(styles, "admin-user-cell")}>
                      <span className={cx(styles, "admin-avatar")}>{initials(source.name)}</span>
                      <span>
                        <a
                          className={cx(styles, "admin-cell-strong")}
                          href={source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {source.name}
                        </a>
                        <span className={cx(styles, "admin-cell-sub")}>{source.url}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={cx(styles, "admin-badge admin-badge--blue")}>
                      {KIND_LABELS[source.kind] ?? source.kind}
                    </span>
                  </td>
                  <td>{TRUST_LABELS[source.trust] ?? source.trust}</td>
                  <td>{source.language}</td>
                  <td>
                    {source.last_synced_at ? (
                      <span className={cx(styles, "admin-cell-strong")}>
                        {formatDateTime(source.last_synced_at)}
                      </span>
                    ) : (
                      <span className={cx(styles, "admin-cell-sub")}>Ещё не было</span>
                    )}
                    {source.last_error && (
                      <span className={cx(styles, "admin-cell-sub")} title={source.last_error}>
                        ошибка · {source.items_collected} собрано
                      </span>
                    )}
                  </td>
                  <td>
                    <div className={cx(styles, "admin-row-actions")}>
                      <button
                        aria-checked={source.enabled}
                        aria-label={
                          source.enabled
                            ? `Отключить ${source.name}`
                            : `Включить ${source.name}`
                        }
                        className={cx(styles, `admin-toggle${
                          source.enabled ? ' admin-toggle--on' : ''
                        }`)}
                        disabled={busyId === source.id}
                        role="switch"
                        title={source.enabled ? 'Активен' : 'Приостановлен'}
                        type="button"
                        onClick={() => void handleToggle(source)}
                      >
                        <span className={cx(styles, "admin-toggle-thumb")} />
                      </button>
                      <button
                        aria-label={`Удалить ${source.name}`}
                        className={cx(styles, "admin-button admin-button--danger admin-button--small")}
                        disabled={busyId === source.id}
                        type="button"
                        onClick={() => void handleDelete(source)}
                      >
                        <DeleteIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && (
            <p className={cx(styles, "admin-empty")}>Источники не найдены.</p>
          )}
          {loading && <p className={cx(styles, "admin-empty")}>Загружаем источники…</p>}
        </div>
        <p className={cx(styles, "admin-note admin-mt-10")}>
          Показано {filtered.length} из {sources.length}. Последнее обновление:{' '}
          {formatDateTime(updatedAt)}
        </p>
      </section>

      <section className={cx(styles, "admin-card")}>
        <div className={cx(styles, "admin-card-head")}>
          <div>
            <h2 className={cx(styles, "admin-card-title")}>Правила фильтрации стоп-слов</h2>
            <p className={cx(styles, "admin-card-sub")}>
              Предотвращает перегрузку LLM-конвейера нерелевантными публикациями.
            </p>
          </div>
          <span className={cx(styles, "admin-badge admin-badge--green")}>
            Активно {keywords.length}
          </span>
        </div>

        <form className={cx(styles, "admin-form admin-mb-12")} onSubmit={handleAddKeyword}>
          <label className={cx(styles, "admin-field")}>
            <span>Новое стоп-слово</span>
            <input
              className={cx(styles, "admin-input")}
              placeholder="Например, вакансия"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
          <div className={cx(styles, "admin-form-actions")}>
            <label className={cx(styles, "admin-button")} title="JSON, CSV или TXT">
              <UploadIcon />
              {importingKeywords ? 'Импортируем…' : 'Импорт из файла'}
              <input
                accept=".json,.csv,.txt,text/plain,application/json,text/csv"
                className={cx(styles, "admin-hidden")}
                disabled={importingKeywords}
                type="file"
                onChange={(event) => void handleImportKeywords(event)}
              />
            </label>
            <button
              className={cx(styles, "admin-button admin-button--primary")}
              type="submit"
              disabled={keywordSubmitting || !keyword.trim()}
            >
              Добавить
            </button>
          </div>
        </form>

        <div className={cx(styles, "admin-chips")}>
          {keywords.map((item) => (
            <span className={cx(styles, "admin-chip")} key={item.id}>
              {item.word}
              <button
                aria-label={`Удалить ${item.word}`}
                type="button"
                onClick={() => void handleDeleteKeyword(item)}
              >
                ×
              </button>
            </span>
          ))}
          {keywords.length === 0 && <span className={cx(styles, "admin-note")}>Стоп-слов пока нет.</span>}
        </div>
      </section>
    </>
  );
}
