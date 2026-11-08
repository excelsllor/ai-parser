import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

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
  KeyIcon,
  RefreshIcon,
  RssIcon,
  SearchIcon,
} from '@components/ui/icons';

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

export default function AdminSourcesPage() {
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [keywords, setKeywords] = useState<AdminKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить источники.');
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
    setError(null);
    try {
      await createAdminSource({ name, kind: sourceKind, url, trust });
      setName('');
      setUrl('');
      setAddOpen(false);
      setNotice('Источник добавлен.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось добавить источник.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(source: AdminSource) {
    setBusyId(source.id);
    setError(null);
    try {
      await toggleAdminSource(source.id, !source.enabled);
      setSources((previous) =>
        previous.map((item) =>
          item.id === source.id ? { ...item, enabled: !item.enabled } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось изменить источник.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(source: AdminSource) {
    if (!window.confirm(`Удалить источник «${source.name}»?`)) {
      return;
    }
    setBusyId(source.id);
    setError(null);
    try {
      await deleteAdminSource(source.id);
      setSources((previous) => previous.filter((item) => item.id !== source.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить источник.');
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
    setError(null);
    try {
      const created = await createAdminKeyword(keyword.trim());
      setKeywords((previous) => [created, ...previous]);
      setKeyword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось добавить стоп-слово.');
    } finally {
      setKeywordSubmitting(false);
    }
  }

  async function handleDeleteKeyword(item: AdminKeyword) {
    setError(null);
    try {
      await deleteAdminKeyword(item.id);
      setKeywords((previous) => previous.filter((entry) => entry.id !== item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось удалить стоп-слово.');
    }
  }

  return (
    <>
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">
            <RssIcon />
            Коннекторы данных
          </span>
          <h1 className="admin-title">Источники сбора данных и парсинг</h1>
          <p className="admin-sub">
            Конфигурация коннекторов, интервалов синхронизации и статусов парсинга.
          </p>
        </div>
        <div className="admin-actions">
          <button className="admin-button" type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
          <button
            className="admin-button admin-button--primary"
            type="button"
            onClick={() => setAddOpen((value) => !value)}
          >
            {addOpen ? 'Скрыть форму' : '+ Добавить источник'}
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-error" role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="admin-notice" role="status">
          <CheckCircleIcon />
          <span>{notice}</span>
        </div>
      )}

      <div className="admin-stats">
        <article className="admin-stat">
          <span className="admin-stat-label">
            Всего источников
            <RssIcon />
          </span>
          <strong className="admin-stat-value">{stats.total}</strong>
          <span className="admin-stat-hint">
            {stats.rss} RSS · собрано {stats.collected.toLocaleString('ru-RU')} материалов
          </span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Активны
            <CheckCircleIcon />
          </span>
          <strong className="admin-stat-value">{stats.active}</strong>
          <span className="admin-stat-hint">Участвуют в сборе</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Приостановлены
            <AlertCircleIcon />
          </span>
          <strong className="admin-stat-value">{stats.disabled}</strong>
          <span className="admin-stat-hint">Исключены из выборки</span>
        </article>
        <article className="admin-stat">
          <span className="admin-stat-label">
            Стоп-слов
            <KeyIcon />
          </span>
          <strong className="admin-stat-value">{keywords.length}</strong>
          <span className="admin-stat-hint">Фильтры ключевых слов</span>
        </article>
      </div>

      {addOpen && (
        <form className="admin-form" onSubmit={handleCreate}>
          <label className="admin-field">
            <span>Название</span>
            <input
              className="admin-input"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Тип коннектора</span>
            <select
              className="admin-select"
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value)}
            >
              <option value="rss">RSS</option>
              <option value="html">HTML</option>
            </select>
          </label>
          <label className="admin-field">
            <span>URL</span>
            <input
              className="admin-input"
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Доверие</span>
            <select
              className="admin-select"
              value={trust}
              onChange={(event) => setTrust(event.target.value)}
            >
              <option value="reprint">Перепечатка</option>
              <option value="primary">Первичный</option>
              <option value="unknown">Неизвестно</option>
            </select>
          </label>
          <div className="admin-form-actions">
            <button
              className="admin-button admin-button--primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Добавляем…' : 'Добавить'}
            </button>
          </div>
        </form>
      )}

      <section className="admin-card">
        <div className="admin-filters">
          <div className="admin-search">
            <SearchIcon />
            <input
              className="admin-input"
              placeholder="Поиск по названию или домену"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="admin-select"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">Все типы</option>
            <option value="rss">RSS</option>
            <option value="html">HTML</option>
          </select>
          <select
            className="admin-select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Все статусы</option>
            <option value="enabled">Активные</option>
            <option value="disabled">Приостановленные</option>
          </select>
        </div>

        <div className="admin-table-wrap admin-mt-14">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Источник</th>
                <th>Тип</th>
                <th>Доверие</th>
                <th>Язык</th>
                <th>Синхронизация</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((source) => (
                <tr key={source.id}>
                  <td>
                    <div className="admin-user-cell">
                      <span className="admin-avatar">{initials(source.name)}</span>
                      <span>
                        <a
                          className="admin-cell-strong"
                          href={source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {source.name}
                        </a>
                        <span className="admin-cell-sub">{source.url}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-badge admin-badge--blue">
                      {KIND_LABELS[source.kind] ?? source.kind}
                    </span>
                  </td>
                  <td>{TRUST_LABELS[source.trust] ?? source.trust}</td>
                  <td>{source.language}</td>
                  <td>
                    {source.last_synced_at ? (
                      <span className="admin-cell-strong">
                        {formatDateTime(source.last_synced_at)}
                      </span>
                    ) : (
                      <span className="admin-cell-sub">Ещё не было</span>
                    )}
                    {source.last_error && (
                      <span className="admin-cell-sub" title={source.last_error}>
                        ошибка · {source.items_collected} собрано
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        aria-checked={source.enabled}
                        aria-label={
                          source.enabled
                            ? `Отключить ${source.name}`
                            : `Включить ${source.name}`
                        }
                        className={`admin-toggle${
                          source.enabled ? ' admin-toggle--on' : ''
                        }`}
                        disabled={busyId === source.id}
                        role="switch"
                        title={source.enabled ? 'Активен' : 'Приостановлен'}
                        type="button"
                        onClick={() => void handleToggle(source)}
                      >
                        <span className="admin-toggle-thumb" />
                      </button>
                      <button
                        aria-label={`Удалить ${source.name}`}
                        className="admin-button admin-button--danger admin-button--small"
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
            <p className="admin-empty">Источники не найдены.</p>
          )}
          {loading && <p className="admin-empty">Загружаем источники…</p>}
        </div>
        <p className="admin-note admin-mt-10">
          Показано {filtered.length} из {sources.length}. Последнее обновление:{' '}
          {formatDateTime(updatedAt)}
        </p>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Правила фильтрации стоп-слов</h2>
            <p className="admin-card-sub">
              Предотвращает перегрузку LLM-конвейера нерелевантными публикациями.
            </p>
          </div>
          <span className="admin-badge admin-badge--green">
            Активно {keywords.length}
          </span>
        </div>

        <form className="admin-form admin-mb-12" onSubmit={handleAddKeyword}>
          <label className="admin-field">
            <span>Новое стоп-слово</span>
            <input
              className="admin-input"
              placeholder="Например, вакансия"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
          <div className="admin-form-actions">
            <button
              className="admin-button admin-button--primary"
              type="submit"
              disabled={keywordSubmitting || !keyword.trim()}
            >
              Добавить
            </button>
          </div>
        </form>

        <div className="admin-chips">
          {keywords.map((item) => (
            <span className="admin-chip" key={item.id}>
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
          {keywords.length === 0 && <span className="admin-note">Стоп-слов пока нет.</span>}
        </div>
      </section>
    </>
  );
}
