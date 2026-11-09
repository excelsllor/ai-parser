import { useEffect, useMemo, useState } from 'react';

import {
  getAudit,
  getDebugServices,
  getHealthHistory,
  getLlmCalls,
} from '@api/admin';
import type { AuditEntry, DebugServices, HealthSnapshot, LlmCall } from '@api/admin';
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
} from '@components/ui';
import { cx } from '@utils/cx';

import adminStyles from '@components/admin/Admin.module.css';

const styles = adminStyles;

import { downloadFile, formatDateTime, formatTime, formatUptime } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_LABELS: Record<string, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершено',
  failed: 'Ошибка',
  cancelled: 'Отменено',
};

function barHeightClass(count: number, max: number): string {
  const percent = Math.round((count / max) * 20) * 5;
  return `admin-bar-h-${Math.min(100, Math.max(5, percent))}`;
}

function distWidthClass(percent: number): string {
  return `admin-dist-w-${Math.min(100, Math.max(0, Math.round(percent / 5) * 5))}`;
}

function statusClass(status: string): string {
  return ['completed', 'running', 'queued', 'failed', 'cancelled'].includes(status)
    ? status
    : 'queued';
}

export default function AdminOverviewPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [services, setServices] = useState<DebugServices | null>(null);
  const [history, setHistory] = useState<HealthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [runList, callList, auditList, serviceInfo, healthHistory] = await Promise.all([
        listRuns(50),
        getLlmCalls(),
        getAudit(10),
        getDebugServices(),
        getHealthHistory(20),
      ]);
      setRuns(runList);
      setCalls(callList);
      setAudit(auditList);
      setServices(serviceInfo);
      setHistory(healthHistory);
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
      <header className={cx(styles, "admin-head")}>
        <div>
          <span className={cx(styles, "admin-eyebrow")}>
            <span className={cx(styles, "admin-live-dot")} />
            Ковейер активен · обновлено {formatTime(updatedAt)}
          </span>
          <h1 className={cx(styles, "admin-title")}>Обзор платформы и телеметрия</h1>
          <p className={cx(styles, "admin-sub")}>
            Метрики сбора, фильтрации и генерации за последние 24 часа. Данные из
            запусков, LLM-вызовов и журнала аудита.
          </p>
        </div>
        <div className={cx(styles, "admin-actions")}>
          <button className={cx(styles, "admin-button")} type="button" onClick={() => void load()}>
            <RefreshIcon />
            Обновить
          </button>
          <button className={cx(styles, "admin-button admin-button--primary")} type="button" onClick={exportReport}>
            <DownloadIcon />
            Экспорт отчёта
          </button>
        </div>
      </header>

      {error && (
        <div className={cx(styles, "admin-error")} role="alert">
          <AlertCircleIcon />
          <span>{error}</span>
        </div>
      )}

      {loading && runs.length === 0 ? (
        <p className={cx(styles, "admin-empty")}>Загружаем метрики…</p>
      ) : (
        <>
          <div className={cx(styles, "admin-stats")}>
            <article className={cx(styles, "admin-stat")}>
              <span className={cx(styles, "admin-stat-label")}>
                Запусков за 24ч
                <ListNumberedIcon />
              </span>
              <strong className={cx(styles, "admin-stat-value")}>{metrics.recent.length}</strong>
              <span className={cx(styles, "admin-stat-hint")}>
                {metrics.completed.length} завершено · {metrics.failed.length} с ошибкой
              </span>
            </article>
            <article className={cx(styles, "admin-stat")}>
              <span className={cx(styles, "admin-stat-label")}>
                Успешность
                <CheckCircleIcon />
              </span>
              <strong className={cx(styles, "admin-stat-value")}>
                {metrics.successRate === null ? '—' : `${metrics.successRate}%`}
              </strong>
              <span className={cx(styles, "admin-stat-hint")}>Доля успешных запусков</span>
            </article>
            <article className={cx(styles, "admin-stat")}>
              <span className={cx(styles, "admin-stat-label")}>
                Расход токенов
                <BotIcon />
              </span>
              <strong className={cx(styles, "admin-stat-value")}>
                {metrics.tokens.toLocaleString('ru-RU')}
              </strong>
              <span className={cx(styles, "admin-stat-hint")}>
                Стоимость ${metrics.cost.toFixed(4)}
              </span>
            </article>
            <article className={cx(styles, "admin-stat")}>
              <span className={cx(styles, "admin-stat-label")}>
                Среднее время
                <ScheduleIcon />
              </span>
              <strong className={cx(styles, "admin-stat-value")}>
                {metrics.avgDuration === null ? '—' : metrics.avgDuration}
                {metrics.avgDuration !== null && <small> сек</small>}
              </strong>
              <span className={cx(styles, "admin-stat-hint")}>Полный цикл пайплайна</span>
            </article>
          </div>

          <div className={cx(styles, "admin-grid")}>
            <section className={cx(styles, "admin-card")}>
              <div className={cx(styles, "admin-card-head")}>
                <div>
                  <h2 className={cx(styles, "admin-card-title")}>Пропускная способность</h2>
                  <p className={cx(styles, "admin-card-sub")}>Запусков по часам за последние 12 часов</p>
                </div>
                <span className={cx(styles, "admin-badge admin-badge--blue")}>
                  <BoltIcon />
                  {runs.length} всего
                </span>
              </div>
              <div className={cx(styles, "admin-chart")}>
                {chart.map((item) => (
                  <div className={cx(styles, "admin-chart-col")} key={item.label}>
                    <div
                      className={cx(styles, `admin-chart-bar ${barHeightClass(item.count, maxChart)}`)}
                      title={`${item.label} — ${item.count}`}
                    />
                    <span className={cx(styles, "admin-chart-label")}>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className={cx(styles, "admin-card")}>
              <div className={cx(styles, "admin-card-head")}>
                <div>
                  <h2 className={cx(styles, "admin-card-title")}>Статусы запусков</h2>
                  <p className={cx(styles, "admin-card-sub")}>Распределение по последним {runs.length} запускам</p>
                </div>
              </div>
              {distribution.map((item) => (
                <div className={cx(styles, "admin-dist-row")} key={item.status}>
                  <span className={cx(styles, "admin-dist-name")}>{STATUS_LABELS[item.status]}</span>
                  <span className={cx(styles, "admin-dist-bar")}>
                    <span
                      className={cx(styles, `admin-dist-fill admin-dist-fill--${statusClass(item.status)} ${distWidthClass(item.percent)}`)}
                    />
                  </span>
                  <span className={cx(styles, "admin-dist-value")}>{item.count}</span>
                </div>
              ))}
            </section>
          </div>

          <div className={cx(styles, "admin-grid")}>
            <section className={cx(styles, "admin-card")}>
              <div className={cx(styles, "admin-card-head")}>
                <div>
                  <h2 className={cx(styles, "admin-card-title")}>Журнал системных событий</h2>
                  <p className={cx(styles, "admin-card-sub")}>Последние действия в платформе</p>
                </div>
              </div>
              <div className={cx(styles, "admin-table-wrap")}>
                <table className={cx(styles, "admin-table")}>
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
                        <td className={cx(styles, "admin-mono")}>{formatTime(entry.created_at)}</td>
                        <td>
                          <span className={cx(styles, "admin-badge admin-badge--blue")}>{entry.action}</span>
                        </td>
                        <td>{entry.actor_username || '—'}</td>
                        <td className={cx(styles, "admin-mono")}>{entry.resource}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {audit.length === 0 && <p className={cx(styles, "admin-empty")}>Событий пока нет.</p>}
              </div>
            </section>

            <section className={cx(styles, "admin-card")}>
              <div className={cx(styles, "admin-card-head")}>
                <div>
                  <h2 className={cx(styles, "admin-card-title")}>Состояние контура</h2>
                  <p className={cx(styles, "admin-card-sub")}>Сервисы и зависимости</p>
                </div>
                <span className={cx(styles, "admin-badge admin-badge--green")}>
                  {registryAlive}/{registryTotal} alive
                </span>
              </div>
              <div className={cx(styles, "admin-kv")}>
                <div className={cx(styles, "admin-kv-item")}>
                  <span>PostgreSQL</span>
                  <strong>{services?.database.ok ? 'OK' : 'Ошибка'}</strong>
                </div>
                <div className={cx(styles, "admin-kv-item")}>
                  <span>Redis</span>
                  <strong>
                    {services?.redis.ok
                      ? `${services.redis.latency_ms ?? 0} мс`
                      : 'Ошибка'}
                  </strong>
                </div>
                <div className={cx(styles, "admin-kv-item")}>
                  <span>Kafka</span>
                  <strong>{services?.kafka.ok ? 'OK' : 'Ошибка'}</strong>
                </div>
                <div className={cx(styles, "admin-kv-item")}>
                  <span>LLM</span>
                  <strong>{services?.llm.ok ? 'OK' : 'Недоступен'}</strong>
                </div>
              </div>
              <p className={cx(styles, "admin-note admin-mt-12")}>
                Окружение {services?.env ?? '—'} · версия {services?.version ?? '—'} ·{' '}
                {formatDateTime(updatedAt)}
              </p>
            </section>
          </div>

          <section className={cx(styles, "admin-card")}>
            <div className={cx(styles, "admin-card-head")}>
              <div>
                <h2 className={cx(styles, "admin-card-title")}>Реестр компонентов кластера</h2>
                <p className={cx(styles, "admin-card-sub")}>Heartbeat из общего registry-файла</p>
              </div>
              <span className={cx(styles, "admin-badge admin-badge--green")}>
                <CheckCircleIcon />
                {registryAlive}/{registryTotal} healthy
              </span>
            </div>
            <div className={cx(styles, "admin-service-grid")}>
              {(services?.registry ?? []).map((service) => (
                <article className={cx(styles, "admin-service")} key={service.name}>
                  <div className={cx(styles, "admin-service-head")}>
                    <span className={cx(styles, "admin-service-name")}>{service.name}</span>
                    <span
                      className={cx(styles, `admin-badge ${
                        service.alive ? 'admin-badge--green' : 'admin-badge--red'
                      }`)}
                    >
                      {service.alive ? 'Healthy' : 'Down'}
                    </span>
                  </div>
                  <span className={cx(styles, "admin-service-meta")}>
                    PID {service.pid} · uptime {formatUptime(service.started)}
                  </span>
                  <span className={cx(styles, "admin-service-meta admin-mono")}>
                    last_seen {formatDateTime(new Date(service.last_seen * 1000).toISOString())}
                  </span>
                </article>
              ))}
              {registryTotal === 0 && (
                <p className={cx(styles, "admin-empty")}>Реестр сервисов пуст.</p>
              )}
            </div>
          </section>

          <div className={cx(styles, "admin-grid")}>
            <section className={cx(styles, "admin-card")}>
              <div className={cx(styles, "admin-card-head")}>
                <div>
                  <h2 className={cx(styles, "admin-card-title")}>Инфраструктурные зависимости</h2>
                  <p className={cx(styles, "admin-card-sub")}>Проверка подключений на момент запроса</p>
                </div>
              </div>
              <div className={cx(styles, "admin-table-wrap")}>
                <table className={cx(styles, "admin-table")}>
                  <thead>
                    <tr>
                      <th>Компонент</th>
                      <th>Детали</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={cx(styles, "admin-cell-strong")}>PostgreSQL</td>
                      <td>Основное хранилище</td>
                      <td>
                        <span
                          className={cx(styles, `admin-badge ${
                            services?.database.ok ? 'admin-badge--green' : 'admin-badge--red'
                          }`)}
                        >
                          {services?.database.ok ? 'OK' : 'Ошибка'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className={cx(styles, "admin-cell-strong")}>Redis</td>
                      <td>Кэш и блокировки</td>
                      <td>
                        <span
                          className={cx(styles, `admin-badge ${
                            services?.redis.ok ? 'admin-badge--green' : 'admin-badge--red'
                          }`)}
                        >
                          {services?.redis.ok
                            ? `${services.redis.latency_ms ?? 0} мс`
                            : 'Ошибка'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className={cx(styles, "admin-cell-strong")}>Kafka</td>
                      <td className={cx(styles, "admin-mono")}>{services?.kafka.brokers ?? '—'}</td>
                      <td>
                        <span
                          className={cx(styles, `admin-badge ${
                            services?.kafka.ok ? 'admin-badge--green' : 'admin-badge--red'
                          }`)}
                        >
                          {services?.kafka.ok ? 'OK' : 'Ошибка'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className={cx(styles, "admin-cell-strong")}>LLM</td>
                      <td className={cx(styles, "admin-mono")}>{services?.llm.base_url ?? '—'}</td>
                      <td>
                        <span
                          className={cx(styles, `admin-badge ${
                            services?.llm.ok ? 'admin-badge--green' : 'admin-badge--amber'
                          }`)}
                        >
                          {services?.llm.ok ? 'OK' : 'Недоступен'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className={cx(styles, "admin-card")}>
              <div className={cx(styles, "admin-card-head")}>
                <div>
                  <h2 className={cx(styles, "admin-card-title")}>История проверок</h2>
                  <p className={cx(styles, "admin-card-sub")}>Снимки каждые 60 секунд, 7 дней</p>
                </div>
                <span className={cx(styles, "admin-badge")}>
                  <ScheduleIcon />
                  {history.length}
                </span>
              </div>
              <div className={cx(styles, "admin-table-wrap")}>
                <table className={cx(styles, "admin-table")}>
                  <thead>
                    <tr>
                      <th>Проверка</th>
                      <th>PG</th>
                      <th>Redis</th>
                      <th>Kafka</th>
                      <th>LLM</th>
                      <th>Сервисы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 10).map((snapshot) => (
                      <tr key={snapshot.id}>
                        <td className={cx(styles, "admin-mono")}>{formatDateTime(snapshot.checked_at)}</td>
                        <td>{snapshot.database_ok ? 'OK' : 'Ошибка'}</td>
                        <td>{snapshot.redis_ok ? 'OK' : 'Ошибка'}</td>
                        <td>{snapshot.kafka_ok ? 'OK' : 'Ошибка'}</td>
                        <td>{snapshot.llm_ok ? 'OK' : 'Недоступен'}</td>
                        <td>
                          {snapshot.registry_alive}/{snapshot.registry_total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {history.length === 0 && (
                  <p className={cx(styles, "admin-empty")}>История появится после первого снимка.</p>
                )}
              </div>
            </section>
          </div>


        </>
      )}
    </>
  );
}
