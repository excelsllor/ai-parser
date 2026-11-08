import { useEffect, useMemo, useState } from 'react';

import {
  getAudit,
  getDebugServices,
  getLlmCalls,
} from '@api/admin';
import type { AuditEntry, DebugServices, LlmCall } from '@api/admin';
import { listRuns } from '@api/runs';
import type { RunSummary } from '@api/runs';
import {
  AlertCircleIcon,
  BoltIcon,
  BotIcon,
  CheckCircleIcon,
  DownloadIcon,
  ListNumberedIcon,
  RefreshIcon,
  ScheduleIcon,
} from '@components/ui/icons';

import { downloadFile, formatDateTime, formatTime } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_LABELS: Record<string, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершено',
  failed: 'Ошибка',
  cancelled: 'Отменено',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  running: '#f59e0b',
  queued: '#3b82f6',
  failed: '#ef4444',
  cancelled: '#94a3b8',
};

export default function AdminOverviewPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [services, setServices] = useState<DebugServices | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [runList, callList, auditList, serviceInfo] = await Promise.all([
        listRuns(50),
        getLlmCalls(),
        getAudit(10),
        getDebugServices(),
      ]);
      setRuns(runList);
      setCalls(callList);
      setAudit(auditList);
      setServices(serviceInfo);
      setUpdatedAt(new Date().toISOString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить метрики.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const metrics = useMemo(() => {
    const since = (updatedAt ? new Date(updatedAt).getTime() : 0) - DAY_MS;
    const recent = runs.filter((run) => new Date(run.created_at).getTime() >= since);
    const completed = recent.filter((run) => run.status === 'completed');
    const failed = recent.filter((run) => run.status === 'failed');
    const tokens = calls.reduce(
      (sum, call) => sum + call.input_tokens + call.output_tokens,
      0,
    );
    const cost = calls.reduce((sum, call) => sum + call.cost, 0);
    const durations = completed
      .filter((run) => run.finished_at)
      .map(
        (run) =>
          (new Date(run.finished_at as string).getTime() -
            new Date(run.created_at).getTime()) /
          1000,
      )
      .filter((value) => value >= 0);
    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null;
    const successRate =
      completed.length + failed.length > 0
        ? Math.round((completed.length / (completed.length + failed.length)) * 100)
        : null;

    return { recent, completed, failed, tokens, cost, avgDuration, successRate };
  }, [runs, calls, updatedAt]);

  const chart = useMemo(() => {
    if (!updatedAt) {
      return [];
    }
    const now = new Date(updatedAt);
    const buckets: Array<{ label: string; count: number }> = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const start = new Date(now);
      start.setHours(now.getHours() - offset, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const count = runs.filter((run) => {
        const created = new Date(run.created_at).getTime();
        return created >= start.getTime() && created < end.getTime();
      }).length;
      buckets.push({
        label: `${String(start.getHours()).padStart(2, '0')}:00`,
        count,
      });
    }
    return buckets;
  }, [runs, updatedAt]);

  const distribution = useMemo(() => {
    const total = runs.length || 1;
    return ['completed', 'running', 'queued', 'failed', 'cancelled'].map((status) => {
      const count = runs.filter((run) => run.status === status).length;
      return {
        status,
        count,
        percent: Math.round((count / total) * 100),
      };
    });
  }, [runs]);

  const maxChart = Math.max(1, ...chart.map((item) => item.count));
  const registryAlive =
    services?.registry.filter((service) => service.alive).length ?? 0;
  const registryTotal = services?.registry.length ?? 0;

  function exportReport() {
    downloadFile(
      'admin-overview.json',
      JSON.stringify({ runs, calls, services }, null, 2),
      'application/json',
    );
  }

  return (
    <>
      <header className="admin-head">
        <div>
          <span className="admin-eyebrow">
            <span className="admin-live-dot" />
            Ковейер активен · обновлено {formatTime(updatedAt)}
          </span>
          <h1 className="admin-title">Обзор платформы и телеметрия</h1>
          <p className="admin-sub">
            Метрики сбора, фильтрации и генерации за последние 24 часа. Данные из
            запусков, LLM-вызовов и журнала аудита.
          </p>
        </div>
        <div className="admin-actions">
          <button className="admin-button" type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
          <button className="admin-button admin-button--primary" type="button" onClick={exportReport}>
            <DownloadIcon />
            Экспорт отчёта
          </button>
        </div>
      </header>

      {error && (
        <div className="admin-error" role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}

      {loading && runs.length === 0 ? (
        <p className="admin-empty">Загружаем метрики…</p>
      ) : (
        <>
          <div className="admin-stats">
            <article className="admin-stat">
              <span className="admin-stat-label">
                Запусков за 24ч
                <ListNumberedIcon />
              </span>
              <strong className="admin-stat-value">{metrics.recent.length}</strong>
              <span className="admin-stat-hint">
                {metrics.completed.length} завершено · {metrics.failed.length} с ошибкой
              </span>
            </article>
            <article className="admin-stat">
              <span className="admin-stat-label">
                Успешность
                <CheckCircleIcon />
              </span>
              <strong className="admin-stat-value">
                {metrics.successRate === null ? '—' : `${metrics.successRate}%`}
              </strong>
              <span className="admin-stat-hint">Доля успешных запусков</span>
            </article>
            <article className="admin-stat">
              <span className="admin-stat-label">
                Расход токенов
                <BotIcon />
              </span>
              <strong className="admin-stat-value">
                {metrics.tokens.toLocaleString('ru-RU')}
              </strong>
              <span className="admin-stat-hint">
                Стоимость ${metrics.cost.toFixed(4)}
              </span>
            </article>
            <article className="admin-stat">
              <span className="admin-stat-label">
                Среднее время
                <ScheduleIcon />
              </span>
              <strong className="admin-stat-value">
                {metrics.avgDuration === null ? '—' : metrics.avgDuration}
                {metrics.avgDuration !== null && <small> сек</small>}
              </strong>
              <span className="admin-stat-hint">Полный цикл пайплайна</span>
            </article>
          </div>

          <div className="admin-grid">
            <section className="admin-card">
              <div className="admin-card-head">
                <div>
                  <h2 className="admin-card-title">Пропускная способность</h2>
                  <p className="admin-card-sub">Запусков по часам за последние 12 часов</p>
                </div>
                <span className="admin-badge admin-badge--blue">
                  <BoltIcon />
                  {runs.length} всего
                </span>
              </div>
              <div className="admin-chart">
                {chart.map((item) => (
                  <div className="admin-chart-col" key={item.label}>
                    <div
                      className="admin-chart-bar"
                      style={{ height: `${Math.max(2, (item.count / maxChart) * 100)}%` }}
                      title={`${item.label} — ${item.count}`}
                    />
                    <span className="admin-chart-label">{item.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <div>
                  <h2 className="admin-card-title">Статусы запусков</h2>
                  <p className="admin-card-sub">Распределение по последним {runs.length} запускам</p>
                </div>
              </div>
              {distribution.map((item) => (
                <div className="admin-dist-row" key={item.status}>
                  <span className="admin-dist-name">{STATUS_LABELS[item.status]}</span>
                  <span className="admin-dist-bar">
                    <span
                      className="admin-dist-fill"
                      style={{
                        width: `${item.percent}%`,
                        background: STATUS_COLORS[item.status],
                      }}
                    />
                  </span>
                  <span className="admin-dist-value">{item.count}</span>
                </div>
              ))}
            </section>
          </div>

          <div className="admin-grid">
            <section className="admin-card">
              <div className="admin-card-head">
                <div>
                  <h2 className="admin-card-title">Журнал системных событий</h2>
                  <p className="admin-card-sub">Последние действия в платформе</p>
                </div>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>Событие</th>
                      <th>Актор</th>
                      <th>Ресурс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id}>
                        <td className="admin-mono">{formatTime(entry.created_at)}</td>
                        <td>
                          <span className="admin-badge admin-badge--blue">{entry.action}</span>
                        </td>
                        <td>{entry.actor_username || '—'}</td>
                        <td className="admin-mono">{entry.resource}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {audit.length === 0 && <p className="admin-empty">Событий пока нет.</p>}
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head">
                <div>
                  <h2 className="admin-card-title">Состояние контура</h2>
                  <p className="admin-card-sub">Сервисы и зависимости</p>
                </div>
                <span className="admin-badge admin-badge--green">
                  {registryAlive}/{registryTotal} alive
                </span>
              </div>
              <div className="admin-kv">
                <div className="admin-kv-item">
                  <span>PostgreSQL</span>
                  <strong>{services?.database.ok ? 'OK' : 'Ошибка'}</strong>
                </div>
                <div className="admin-kv-item">
                  <span>Redis</span>
                  <strong>
                    {services?.redis.ok
                      ? `${services.redis.latency_ms ?? 0} мс`
                      : 'Ошибка'}
                  </strong>
                </div>
                <div className="admin-kv-item">
                  <span>Kafka</span>
                  <strong>{services?.kafka.ok ? 'OK' : 'Ошибка'}</strong>
                </div>
                <div className="admin-kv-item">
                  <span>LLM</span>
                  <strong>{services?.llm.ok ? 'OK' : 'Недоступен'}</strong>
                </div>
              </div>
              <p className="admin-note" style={{ marginTop: 12 }}>
                Окружение {services?.env ?? '—'} · версия {services?.version ?? '—'} ·{' '}
                {formatDateTime(updatedAt)}
              </p>
            </section>
          </div>


        </>
      )}
    </>
  );
}
