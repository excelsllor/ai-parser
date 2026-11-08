import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  createRun,
  downloadArtifact,
  cancelRun,
  deleteRun,
  fetchArtifact,
  getChecks,
  getRunDetail,
  listRuns,
  listSources,
  rerunRun,
  runVersionChain,
  sendTestEmail,
} from '@api/runs';
import type { CheckResult, RunDetail, RunSummary, Source } from '@api/runs';
import WorkspaceLayout from '@components/workspace/WorkspaceLayout';
import SnakeLoader from '@components/ui/SnakeLoader';
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DeleteIcon,
  DescriptionIcon,
  DownloadIcon,
  EyeIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  RefreshIcon,
  RuleIcon,
  ScheduleIcon,
  SearchIcon,
  StopIcon,
  SendIcon,
  ShieldHeartIcon,
  SparklesIcon,
  TableIcon,
  TuneIcon,
} from '@components/ui/icons';

import './RunPage.css';

type TabId = 'digest' | 'post' | 'email' | 'journal' | 'checks';

const TABS: Array<{ id: TabId; label: string; icon: typeof DescriptionIcon }> = [
  { id: 'digest', label: 'Дайджест', icon: DescriptionIcon },
  { id: 'post', label: 'Пост', icon: SendIcon },
  { id: 'email', label: 'Предпросмотр письма', icon: MailIcon },
  { id: 'journal', label: 'Журнал обработки', icon: TableIcon },
  { id: 'checks', label: 'Обязательные проверки', icon: RuleIcon },
];

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

const CHECK_LABELS: Record<string, string> = {
  digest_format: 'Структура дайджеста',
  digest_limit_4000: 'Лимит дайджеста',
  post_limit_2000: 'Лимит поста',
  events_limit_5: 'Лимит событий',
  no_em_dash: 'Без длинного тире',
  sources_present: 'Источники указаны',
  journal_present: 'Журнал обработки',
  sources_valid: 'Валидность источников',
  claims_checked: 'Проверка утверждений',
  events_limit: 'Количество событий',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatEstimate(seconds: number): string {
  if (seconds <= 0) {
    return '—';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `~${minutes} мин ${rest.toString().padStart(2, '0')} с`;
}

function missingArtifact(status: string, name: string): string {
  if (status === 'cancelled') {
    return `Запуск отменён — ${name} не сформирован.`;
  }
  if (status === 'failed') {
    return `Запуск завершился с ошибкой — ${name} не сформирован.`;
  }
  return `Артефакт ${name} ещё не сформирован. Дождитесь завершения запуска.`;
}

function statusClass(status: string): string {
  return status in RUN_STATUS_LABELS ? status : 'queued';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function journalStatusClass(status: string): string {
  if (status.includes('включ')) {
    return 'included';
  }
  if (status.includes('объедин')) {
    return 'merged';
  }
  if (status.includes('исключ')) {
    return 'excluded';
  }
  return 'other';
}

function severity(score: number | undefined): { label: string; className: string } | null {
  if (score === undefined) {
    return null;
  }
  if (score >= 3.5) {
    return { label: 'Критический уровень', className: 'critical' };
  }
  if (score >= 2.8) {
    return { label: 'Высокий уровень', className: 'high' };
  }
  return { label: 'Средний уровень', className: 'medium' };
}

interface DigestSection {
  title: string;
  paragraphs: string[];
}

function parseDigest(text: string): { intro: string[]; sections: DigestSection[] } {
  const intro: string[] = [];
  const sections: DigestSection[] = [];
  let current: DigestSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), paragraphs: [] };
      sections.push(current);
      continue;
    }

    if (line.startsWith('# ')) {
      intro.push(line.slice(2).trim());
      continue;
    }

    if (current) {
      current.paragraphs.push(line);
    } else {
      intro.push(line);
    }
  }

  return { intro, sections };
}

interface PostItem {
  number: string;
  title: string;
  summary: string;
  sources: string[];
}

interface ParsedPost {
  title: string;
  period: string;
  items: PostItem[];
}

function parsePost(text: string): ParsedPost {
  const items: PostItem[] = [];
  let title = '';
  let period = '';
  let current: PostItem | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const itemMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (itemMatch) {
      current = {
        number: itemMatch[1],
        title: itemMatch[2],
        summary: '',
        sources: [],
      };
      items.push(current);
      continue;
    }

    if (!current) {
      if (line.startsWith('Период:')) {
        period = line.replace(/^Период:\s*/, '');
      } else if (!title) {
        title = line;
      }
      continue;
    }

    const sourcesMatch = line.match(/^Источники:\s*(.*)$/);
    if (sourcesMatch) {
      current.sources = sourcesMatch[1].match(/https?:\/\/\S+/g) ?? [];
      continue;
    }

    current.summary += `${current.summary ? ' ' : ''}${line}`;
  }

  return {
    title: title || 'Дайджест по кибербезопасности',
    period,
    items,
  };
}

function seededRandom(seed: string): () => number {
  let state = 0;
  for (const char of seed) {
    state = (state * 31 + char.charCodeAt(0)) >>> 0;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function readNumber(
  source: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = source?.[key];
  return typeof value === 'number' ? value : null;
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get('tab') ?? 'digest') as TabId;
  const tab: TabId = TABS.some((item) => item.id === activeTab)
    ? activeTab
    : 'digest';

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [journalFilter, setJournalFilter] = useState('');

  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [loadingArtifacts, setLoadingArtifacts] = useState<Record<string, boolean>>({});

  const [regenOpen, setRegenOpen] = useState(false);
  const [regenSources, setRegenSources] = useState<Source[]>([]);
  const [regenSelected, setRegenSelected] = useState<Set<string>>(new Set());
  const [regenControlTime, setRegenControlTime] = useState('');
  const [regenInterval, setRegenInterval] = useState(24);
  const [regenLimit, setRegenLimit] = useState(5);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenLoadingSources, setRegenLoadingSources] = useState(false);
  const [regenSubmitting, setRegenSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const loadRuns = () => {
      void listRuns(60)
        .then((next) => {
          if (active) {
            setRuns(next);
          }
        })
        .catch(() => undefined);
    };

    loadRuns();
    const timer = window.setInterval(loadRuns, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!regenOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setRegenOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [regenOpen]);

  useEffect(() => {
    if (!id) {
      return;
    }

    let active = true;

    void (async () => {
      setLoading(true);
      setError(null);
      setDetail(null);
      setChecks([]);
      setArtifacts({});

      try {
        const [runDetail, checkList] = await Promise.all([
          getRunDetail(id),
          getChecks(id).catch(() => [] as CheckResult[]),
        ]);

        if (active) {
          setDetail(runDetail);
          setChecks(checkList);
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Не удалось загрузить запуск.',
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  const runStatus = detail?.run.status;

  useEffect(() => {
    if (!id || !runStatus || ['completed', 'failed', 'cancelled'].includes(runStatus)) {
      return;
    }

    let active = true;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await getRunDetail(id);
          if (!active) {
            return;
          }
          setDetail(next);

          if (['completed', 'failed', 'cancelled'].includes(next.run.status)) {
            window.clearInterval(timer);
            const checkList = await getChecks(id).catch(() => [] as CheckResult[]);
            if (active) {
              setChecks(checkList);
            }
          }
        } catch {
          // Keep the last known state; the user can refresh manually.
        }
      })();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [id, runStatus]);

  const artifactNames = useMemo(() => {
    if (tab === 'digest') {
      return ['digest.md'];
    }
    if (tab === 'post') {
      return ['post.md'];
    }
    if (tab === 'email') {
      return ['email.html', 'email_subject.txt'];
    }
    return [];
  }, [tab]);

  useEffect(() => {
    if (!id || !detail) {
      return;
    }

    for (const name of artifactNames) {
      const exists = detail.artifacts.some((artifact) => artifact.name === name);
      if (!exists || artifacts[name] !== undefined || loadingArtifacts[name]) {
        continue;
      }

      void (async () => {
        setLoadingArtifacts((previous) => ({ ...previous, [name]: true }));
        try {
          const text = await fetchArtifact(id, name);
          setArtifacts((previous) => ({ ...previous, [name]: text }));
        } catch (caught) {
          setActionError(
            caught instanceof Error ? caught.message : `Не удалось загрузить ${name}.`,
          );
        } finally {
          setLoadingArtifacts((previous) => ({ ...previous, [name]: false }));
        }
      })();
    }
  }, [artifactNames, artifacts, detail, id, loadingArtifacts]);

  const digestText = artifacts['digest.md'] ?? '';
  const postText = artifacts['post.md'] ?? '';
  const emailHtml = artifacts['email.html'] ?? '';
  const emailSubject = (artifacts['email_subject.txt'] ?? '').trim();

  const parsedDigest = useMemo(() => parseDigest(digestText), [digestText]);
  const parsedPost = useMemo(() => parsePost(postText), [postText]);
  const run = detail?.run;
  const isGenerating = !run || ['queued', 'running'].includes(run.status);
  const versions = useMemo(
    () => (id ? runVersionChain(id, runs) : []),
    [id, runs],
  );
  const versionIndex = id ? versions.indexOf(id) : -1;
  const digestPending =
    isGenerating || (loadingArtifacts['digest.md'] === true && !digestText);
  const postPending =
    isGenerating || (loadingArtifacts['post.md'] === true && !postText);
  const emailPending =
    isGenerating || (loadingArtifacts['email.html'] === true && !emailHtml);
  const generationHint =
    run?.status === 'queued'
      ? 'Запрос в очереди. Запуск начнётся сразу после освобождения пайплайна.'
      : 'Собираем источники, проверяем факты и формируем текст. Обычно занимает 1–2 минуты.';
  const tgMeta = useMemo(() => {
    const random = seededRandom(run?.id ?? 'digest-post');
    const randomInt = (min: number, max: number) =>
      Math.floor(random() * (max - min + 1)) + min;
    const reactions = ['👍', '🔥', '💯', '👀'].map((emoji) => ({
      emoji,
      count: randomInt(1, 28),
    }));
    return {
      views: randomInt(350, 2400),
      reactions,
    };
  }, [run?.id]);
  const stats = (run?.stats ?? {}) as Record<string, unknown>;
  const passedChecks = checks.filter((check) => check.passed).length;
  const mergedCount = (detail?.journal ?? []).filter((row) =>
    row.status.includes('объедин'),
  ).length;

  const sourceCount = useMemo(() => {
    const hosts = new Set<string>();
    for (const row of detail?.journal ?? []) {
      hosts.add(hostOf(row.external_id));
    }
    return hosts.size;
  }, [detail?.journal]);

  const filteredJournal = useMemo(() => {
    const needle = journalFilter.trim().toLowerCase();
    const rows = detail?.journal ?? [];
    if (!needle) {
      return rows;
    }
    return rows.filter((row) =>
      [row.external_id, row.group_key ?? '', row.status, row.reason]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [detail?.journal, journalFilter]);

  function selectTab(next: TabId) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params);
    setActionError(null);
    setNotice(null);
  }

  async function handleCopy(text: string, label: string) {
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} скопирован.`);
    } catch {
      setActionError('Не удалось скопировать текст в буфер обмена.');
    }
  }

  async function handleDownload(name: string) {
    if (!id) {
      return;
    }
    setActionError(null);
    try {
      await downloadArtifact(id, name);
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : `Не удалось скачать ${name}.`,
      );
    }
  }

  async function handleCancelRun() {
    if (!id) {
      return;
    }
    setCancelling(true);
    setActionError(null);
    try {
      await cancelRun(id);
      setDetail(await getRunDetail(id));
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Не удалось отменить запуск.',
      );
    } finally {
      setCancelling(false);
    }
  }

  async function openRegenModal() {
    setRegenError(null);
    setRegenOpen(true);
    setRegenControlTime(toDateTimeLocal(detail?.run?.control_time));
    setRegenInterval(detail?.run.interval_hours ?? 24);
    setRegenLimit(detail?.run.max_items ?? 5);
    setRegenLoadingSources(true);

    try {
      const sources = await listSources();
      setRegenSources(sources);
      setRegenSelected(
        new Set(sources.filter((source) => source.enabled).map((source) => source.id)),
      );
    } catch (caught) {
      setRegenError(
        caught instanceof Error ? caught.message : 'Не удалось загрузить источники.',
      );
    } finally {
      setRegenLoadingSources(false);
    }
  }

  function toggleRegenSource(sourceId: string) {
    setRegenSelected((previous) => {
      const next = new Set(previous);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  }

  async function handleRegenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const run = detail?.run;
    if (!run) {
      return;
    }
    if (regenSelected.size === 0) {
      setRegenError('Выберите хотя бы один источник мониторинга.');
      return;
    }

    const controlTime = new Date(regenControlTime);
    if (Number.isNaN(controlTime.getTime())) {
      setRegenError('Укажите корректное контрольное время.');
      return;
    }

    setRegenSubmitting(true);
    setRegenError(null);
    try {
      const next =
        run.mode === 'file'
          ? await rerunRun(run.id)
          : await createRun({
              mode: 'live',
              sources: [...regenSelected],
              controlTime: controlTime.toISOString(),
              intervalHours: regenInterval,
              maxItems: regenLimit,
              parentRunId: run.id,
            });

      setRegenOpen(false);
      navigate(`/runs/${next.id}`);
    } catch (caught) {
      setRegenError(
        caught instanceof Error
          ? caught.message
          : 'Не удалось перегенерировать дайджест.',
      );
    } finally {
      setRegenSubmitting(false);
    }
  }

  async function handleDeleteRun(run: RunSummary) {
    if (!window.confirm(`Удалить сессию ${run.id.slice(0, 8)}?`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteRun(run.id);
      setRuns((previous) => previous.filter((item) => item.id !== run.id));
      if (run.id === id) {
        navigate('/');
      }
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Не удалось удалить сессию.',
      );
    }
  }

  async function handleSendEmail() {
    if (!id) {
      return;
    }
    setSending(true);
    setActionError(null);
    try {
      await sendTestEmail(id);
      setNotice('Письмо отправлено на тестовый адрес из конфигурации.');
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Не удалось отправить письмо.',
      );
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <WorkspaceLayout
        runs={runs.slice(0, 6)}
        onSelectRun={(next) => navigate(`/runs/${next.id}`)}
        onDeleteRun={handleDeleteRun}
        onNewQuery={() => navigate('/')}
      >
        <section className="ws-card rp-loading">Загружаем запуск…</section>
      </WorkspaceLayout>
    );
  }

  if (error || !run) {
    return (
      <WorkspaceLayout
        runs={runs.slice(0, 6)}
        onSelectRun={(next) => navigate(`/runs/${next.id}`)}
        onDeleteRun={handleDeleteRun}
        onNewQuery={() => navigate('/')}
      >
        <section className="ws-card">
          <div className="ws-alert ws-alert--error" role="alert">
            <AlertCircleIcon />
            <span>{error ?? 'Запуск не найден.'}</span>
          </div>
          <button className="rp-secondary-button" type="button" onClick={() => navigate('/')}>
            Вернуться к созданию запроса
          </button>
        </section>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout
      runs={runs.slice(0, 6)}
      activeRunId={run.id}
      onSelectRun={(next) => navigate(`/runs/${next.id}`)}
      onDeleteRun={handleDeleteRun}
      onNewQuery={() => navigate('/')}
    >
      <section className="ws-card rp-params">
        <div className="rp-params-head">
          <div className="rp-params-title">
            <span className="rp-params-icon">
              <SparklesIcon />
            </span>
            <span className="rp-params-name">Параметры текущей выборки</span>
            <span className={`ws-status ws-status--${statusClass(run.status)}`}>
              {RUN_STATUS_LABELS[run.status] ?? run.status}
            </span>
          </div>
          <div className="rp-params-actions">
            {isGenerating ? (
              <button
                className="rp-danger-button"
                type="button"
                onClick={handleCancelRun}
                disabled={cancelling}
              >
                <StopIcon />
                {cancelling ? 'Отменяем…' : 'Отменить'}
              </button>
            ) : (
              <button
                className="rp-primary-button"
                type="button"
                onClick={openRegenModal}
                disabled={regenLoadingSources}
              >
                <RefreshIcon />
                Перегенерировать дайджест
              </button>
            )}
            <button
              className="rp-danger-button"
              type="button"
              onClick={() => handleDeleteRun(run)}
            >
              <DeleteIcon />
              Удалить сессию
            </button>
          </div>
        </div>

        <div className="rp-chips">
          <span className="rp-chip rp-chip--mono">{formatDate(run.control_time)}</span>
          <span className="rp-chip">{run.interval_hours} часов</span>
          <span className="rp-chip">Лимит: {run.max_items} событий</span>
          <span className="rp-chip">{sourceCount} источников</span>
          <span className="rp-chip rp-chip--green">Анти-инъекции: Вкл</span>
          <span className="rp-chip rp-chip--blue">Дедупликация: Вкл</span>
          <span className="rp-chip">Без оценок</span>
        </div>

        <div className="rp-stats">
          <div className="rp-stat">
            <span className="rp-stat-label">Период выборки</span>
            <strong>{formatShortDate(run.period_start)} — {formatShortDate(run.period_end)}</strong>
            <span className="rp-stat-hint">Окно {run.interval_hours} часов</span>
          </div>
          <div className="rp-stat">
            <span className="rp-stat-label">Материалы</span>
            <strong>{readNumber(stats, 'items') ?? detail?.journal.length ?? 0} публикаций</strong>
            <span className="rp-stat-hint">{detail?.journal.length ?? 0} строк журнала</span>
          </div>
          <div className="rp-stat rp-stat--blue">
            <span className="rp-stat-label">Отобрано событий</span>
            <strong>{detail?.events.length ?? 0} событий</strong>
            <span className="rp-stat-hint">Финальный дайджест</span>
          </div>
          <div className="rp-stat rp-stat--green">
            <span className="rp-stat-label">Проверки</span>
            <strong>{passedChecks} из {checks.length}</strong>
            <span className="rp-stat-hint">Регламентные проверки</span>
          </div>
          <div className="rp-stat rp-stat--blue">
            <span className="rp-stat-label">Дедупликация</span>
            <strong>{mergedCount} объединено</strong>
            <span className="rp-stat-hint">Семантические кластеры</span>
          </div>
          <div className="rp-stat rp-stat--green">
            <span className="rp-stat-label">Время обработки</span>
            <strong>{readNumber(stats, 'duration_secs') ?? '—'} с</strong>
            <span className="rp-stat-hint">Полный цикл пайплайна</span>
          </div>
        </div>
      </section>

      {isGenerating ? (
        <section className="ws-card rp-generating">
          <SnakeLoader message="Формируем дайджест…" hint={generationHint} />
          {actionError && (
            <div className="ws-alert ws-alert--error" role="alert">
              <AlertCircleIcon />
              <span>{actionError}</span>
            </div>
          )}
        </section>
      ) : (
        <section className="ws-card rp-results">
        <div className="rp-tabs">
          <div className="rp-tab-list" role="tablist">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={`rp-tab${tab === item.id ? ' rp-tab--active' : ''}`}
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => selectTab(item.id)}
                >
                  <Icon />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="rp-tab-actions">
            {tab === 'digest' && (
              <>
                <button
                  className="rp-icon-button"
                  type="button"
                  title="Скопировать Markdown"
                  onClick={() => handleCopy(digestText, 'Markdown')}
                >
                  <CopyIcon />
                </button>
                <button
                  className="rp-secondary-button rp-secondary-button--small"
                  type="button"
                  onClick={() => handleDownload('journal.csv')}
                >
                  <TableIcon />
                  journal.csv
                </button>
                <button
                  className="rp-primary-button rp-primary-button--small"
                  type="button"
                  onClick={() => handleDownload('digest.md')}
                >
                  <DownloadIcon />
                  digest.md
                </button>
              </>
            )}
            {tab === 'post' && (
              <>
                <button
                  className="rp-secondary-button rp-secondary-button--small"
                  type="button"
                  onClick={() => handleCopy(postText, 'Пост')}
                >
                  <CopyIcon />
                  Копировать
                </button>
                <button
                  className="rp-primary-button rp-primary-button--small"
                  type="button"
                  onClick={() => handleDownload('post.md')}
                >
                  <DownloadIcon />
                  post.md
                </button>
              </>
            )}
            {tab === 'email' && (
              <button
                className="rp-secondary-button rp-secondary-button--small"
                type="button"
                onClick={() => handleDownload('email.html')}
              >
                <DownloadIcon />
                email.html
              </button>
            )}
          </div>
        </div>

        {(actionError || notice) && (
          <div className={`ws-alert ${actionError ? 'ws-alert--error' : 'ws-alert--info'}`} role="status">
            {actionError ? <AlertCircleIcon /> : <InfoIcon />}
            <span>{actionError ?? notice}</span>
          </div>
        )}

        <div className="rp-content">
          {tab === 'digest' && (
            digestPending ? (
              <SnakeLoader message="Формируем дайджест…" hint={generationHint} />
            ) : (
              <div className="rp-digest">
                {headerForDigest(parsedDigest.intro)}
                {!digestText && (
                  <p className="rp-muted">{missingArtifact(run.status, 'digest.md')}</p>
                )}
                {parsedDigest.sections.map((section, index) => {
                  const event = detail?.events[index];
                  const level = severity(event?.score);
                  return (
                    <article className="rp-article" key={`${section.title}-${index}`}>
                      <div className="rp-article-head">
                        <div className="rp-article-tags">
                          {level && <span className={`rp-level rp-level--${level.className}`}>{level.label}</span>}
                          <span className="rp-article-index">Событие {index + 1}</span>
                        </div>
                        {event && (
                          <span className="rp-article-key">{event.event_key}</span>
                        )}
                      </div>
                      <h3>{section.title}</h3>
                      <div className="rp-article-body">
                        {section.paragraphs.map((paragraph, paragraphIndex) => {
                          const separator = paragraph.indexOf(':');
                          const label =
                            separator > 0 && separator < 24
                              ? paragraph.slice(0, separator)
                              : null;
                          const rest = label ? paragraph.slice(separator + 1) : paragraph;
                          const isSources = label === 'Источники';
                          return (
                            <p
                              className={isSources ? 'rp-article-sources' : undefined}
                              key={`${section.title}-${paragraphIndex}`}
                            >
                              {label && <strong>{label}:</strong>}
                              {rest}
                            </p>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          )}

          {tab === 'post' && (
            postPending ? (
              <SnakeLoader message="Готовим пост…" hint={generationHint} />
            ) : (
              <div className="rp-post">
              {!postText && (
                <p className="rp-muted">{missingArtifact(run.status, 'post.md')}</p>
              )}
              {postText && (
                <>
                  <div className="rp-tg-shell">
                    <article className="rp-tg-card">
                      <header className="rp-tg-head">
                        <div className="rp-tg-avatar">CT</div>
                        <div className="rp-tg-channel">
                          <span className="rp-tg-name">
                            CyberBug AI
                            <span className="rp-tg-verified">
                              <CheckIcon />
                            </span>
                          </span>
                          <span className="rp-tg-sub">канал · ИБ-дайджест</span>
                        </div>
                        <span className="rp-tg-time">{formatShortDate(run.control_time)}</span>
                      </header>

                      <div className="rp-tg-body">
                        <h3 className="rp-tg-title">
                          <ShieldHeartIcon className="rp-tg-shield" />
                          {parsedPost.title}
                        </h3>
                        {parsedPost.period && (
                          <p className="rp-tg-period">
                            <em>Период: {parsedPost.period}</em>
                          </p>
                        )}
                        <p className="rp-tg-lead">
                          <em>
                            Краткая сводка критических угроз и изменений инфраструктуры
                            за прошедшие сутки:
                          </em>
                        </p>

                        {parsedPost.items.map((item) => (
                          <section className="rp-tg-item" key={`${item.number}-${item.title}`}>
                            <p className="rp-tg-item-title">
                              <strong>
                                {item.number}. {item.title}
                              </strong>
                            </p>
                            {item.summary && <p className="rp-tg-summary">{item.summary}</p>}
                            {item.sources.length > 0 && (
                              <p className="rp-tg-sources">
                                <span className="rp-tg-sources-label">Источники: </span>
                                {item.sources.map((source, index) => (
                                  <span key={source}>
                                    <a
                                      className="rp-tg-source"
                                      href={source}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      {hostOf(source)}
                                    </a>
                                    {index < item.sources.length - 1 ? ', ' : ''}
                                  </span>
                                ))}
                              </p>
                            )}
                          </section>
                        ))}

                        {parsedPost.items.length === 0 && (
                          <p className="rp-muted">Не удалось разобрать структуру поста.</p>
                        )}
                      </div>

                      <footer className="rp-tg-footer">
                        <div className="rp-tg-footer-row">
                          <span className="rp-tg-views">
                            <EyeIcon />
                            {tgMeta.views.toLocaleString('ru-RU')}
                          </span>
                          <span className="rp-tg-date">{formatDate(run.created_at)}</span>
                        </div>
                        <div className="rp-tg-reactions">
                          {tgMeta.reactions.map((reaction) => (
                            <span className="rp-tg-reaction" key={reaction.emoji}>
                              <span>{reaction.emoji}</span>
                              {reaction.count}
                            </span>
                          ))}
                        </div>
                      </footer>
                    </article>
                  </div>
                </>
              )}
            </div>
            )
          )}

          {tab === 'email' && (
            emailPending ? (
              <SnakeLoader message="Готовим письмо…" hint={generationHint} />
            ) : (
            <div className="rp-email">
              <div className="rp-email-meta">
                <label>
                  Тема письма
                  <span>{emailSubject || 'Загружаем тему…'}</span>
                </label>
                <label>
                  Период
                  <span>{formatShortDate(run.period_start)} — {formatShortDate(run.period_end)}</span>
                </label>
                <div className="rp-email-actions">
                  <button
                    className="rp-primary-button rp-primary-button--small"
                    type="button"
                    onClick={handleSendEmail}
                    disabled={sending}
                  >
                    <SendIcon />
                    {sending ? 'Отправляем…' : 'Отправить на тестовый адрес'}
                  </button>
                </div>
              </div>

              {!emailHtml && (
                <p className="rp-muted">{missingArtifact(run.status, 'email.html')}</p>
              )}
              {emailHtml && (
                <div className="rp-email-canvas">
                  <div className="rp-email-browser">
                    <span className="rp-browser-dot rp-browser-dot--red" />
                    <span className="rp-browser-dot rp-browser-dot--yellow" />
                    <span className="rp-browser-dot rp-browser-dot--green" />
                    <span>HTML Rendering Preview · UTF-8</span>
                  </div>
                  <iframe
                    className="rp-email-frame"
                    title="Предпросмотр письма"
                    sandbox=""
                    srcDoc={emailHtml}
                  />
                </div>
              )}
            </div>
            )
          )}

          {tab === 'journal' && (
            <div className="rp-journal">
              <div className="rp-journal-toolbar">
                <div className="rp-search">
                  <SearchIcon />
                  <input
                    value={journalFilter}
                    onChange={(event) => setJournalFilter(event.target.value)}
                    placeholder="Фильтр по URL, группе, статусу или причине"
                    aria-label="Фильтр журнала"
                  />
                </div>
                <span className="rp-muted">
                  Показано {filteredJournal.length} из {detail?.journal.length ?? 0} материалов
                </span>
              </div>

              <div className="rp-journal-table-wrap">
                <table className="rp-journal-table">
                  <thead>
                    <tr>
                      <th>Источник и URL</th>
                      <th>Группа события</th>
                      <th>Статус</th>
                      <th>Причина решения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJournal.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <span className="rp-journal-source">{hostOf(row.external_id)}</span>
                          <span className="rp-journal-url">{row.external_id}</span>
                        </td>
                        <td>
                          <span className="rp-journal-group">{row.group_key ?? '—'}</span>
                        </td>
                        <td>
                          <span className={`rp-journal-status rp-journal-status--${journalStatusClass(row.status)}`}>
                            {row.status}
                          </span>
                        </td>
                        <td>
                          <span className="rp-journal-reason">{row.reason}</span>
                          {row.error && <span className="rp-journal-error">{row.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredJournal.length === 0 && (
                  <p className="rp-muted rp-journal-empty">Ничего не найдено.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'checks' && (
            <div className="rp-checks">
              <div className="rp-checks-head">
                <div>
                  <h2>Регламентные проверки</h2>
                  <p>Все алгоритмические критерии формирования подтверждены.</p>
                </div>
                <span className="rp-checks-summary">
                  {passedChecks} из {checks.length} пройдено
                </span>
              </div>

              {checks.length === 0 && (
                <p className="rp-muted">Проверки ещё не сформированы.</p>
              )}

              <div className="rp-checks-grid">
                {checks.map((check, index) => (
                  <article className="rp-check" key={check.id}>
                    <div className="rp-check-head">
                      <span>{CHECK_LABELS[check.scenario] ?? check.scenario}</span>
                      <span className={`rp-check-badge rp-check-badge--${check.passed ? 'passed' : 'failed'}`}>
                        {check.passed ? 'Пройдена' : 'Ошибка'}
                      </span>
                    </div>
                    <p>{check.note || `Проверка ${index + 1}`}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rp-footer">
          <span className="rp-versions">
            <button
              className="rp-version-button"
              type="button"
              aria-label="Предыдущая версия"
              disabled={versionIndex <= 0}
              onClick={() => navigate(`/runs/${versions[versionIndex - 1]}`)}
            >
              <ChevronLeftIcon />
            </button>
            <span>
              Версия {versionIndex + 1} из {versions.length}
            </span>
            <button
              className="rp-version-button"
              type="button"
              aria-label="Следующая версия"
              disabled={versionIndex >= versions.length - 1}
              onClick={() => navigate(`/runs/${versions[versionIndex + 1]}`)}
            >
              <ChevronRightIcon />
            </button>
          </span>
          <span className="rp-footer-dot" />
          <span>{formatDate(run.created_at)}</span>
          <span className="rp-footer-dot" />
          <span>{run.model}</span>
          <span className="rp-footer-spacer" />
          <button className="rp-link" type="button" onClick={() => selectTab('journal')}>
            Открыть журнал
          </button>
        </div>
        </section>
      )}

      {regenOpen && (
        <div
          className="rp-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRegenOpen(false);
            }
          }}
        >
          <form
            className="rp-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="regen-title"
            onSubmit={handleRegenerate}
          >
            <header className="rp-modal-head">
              <div className="rp-modal-head-title">
                <span className="rp-modal-icon">
                  <TuneIcon />
                </span>
                <div>
                  <h2 id="regen-title">Параметры выборки и генерации</h2>
                  <p>Тонкая настройка парсинга, фильтрации и суммаризации дайджеста</p>
                </div>
              </div>
              <button
                className="rp-modal-close"
                type="button"
                aria-label="Закрыть окно"
                onClick={() => setRegenOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>

            <div className="rp-modal-body">
              {regenError && (
                <div className="ws-alert ws-alert--error" role="alert">
                  <AlertCircleIcon />
                  <span>{regenError}</span>
                </div>
              )}

              <label className="rp-modal-field">
                <span className="rp-modal-label">Контрольное время среза *</span>
                <div className="rp-modal-input-wrap">
                  <ScheduleIcon />
                  <input
                    type="datetime-local"
                    value={regenControlTime}
                    onChange={(event) => setRegenControlTime(event.target.value)}
                    required
                  />
                  <span className="rp-modal-tz">
                    <LockIcon />
                    Пояс SOC
                  </span>
                </div>
              </label>

              <div className="rp-modal-field">
                <div className="rp-modal-field-head">
                  <span className="rp-modal-label">Временное окно отсечки</span>
                  <span>Глубина ретроспективного анализа</span>
                </div>
                <div className="ws-pills">
                  {[12, 24, 48].map((hours) => (
                    <button
                      className={`ws-pill${
                        regenInterval === hours ? ' ws-pill--active' : ''
                      }`}
                      key={hours}
                      type="button"
                      onClick={() => setRegenInterval(hours)}
                    >
                      {regenInterval === hours && <CheckIcon />}
                      {hours} часов
                    </button>
                  ))}
                </div>
              </div>

              <div className="rp-modal-field">
                <div className="rp-modal-field-head">
                  <span className="rp-modal-label">Лимит отобранных событий</span>
                </div>
                <div className="ws-pills">
                  {[3, 5, 7].map((value) => (
                    <button
                      className={`ws-pill${
                        regenLimit === value ? ' ws-pill--active' : ''
                      }`}
                      key={value}
                      type="button"
                      onClick={() => setRegenLimit(value)}
                    >
                      {regenLimit === value && <CheckIcon />}
                      {value} событий
                    </button>
                  ))}
                </div>
              </div>

              <div className="rp-modal-field">
                <div className="rp-modal-field-head">
                  <span className="rp-modal-label">Источники мониторинга</span>
                  <span>
                    Выбрано: {regenSelected.size} из {regenSources.length}
                  </span>
                </div>
                {regenLoadingSources ? (
                  <p className="rp-muted">Загружаем источники…</p>
                ) : (
                  <div className="ws-sources rp-modal-source-list">
                    {regenSources.map((source) => {
                      const selected = regenSelected.has(source.id);
                      return (
                        <button
                          className={`ws-source${
                            selected ? ' ws-source--selected' : ''
                          }`}
                          key={source.id}
                          type="button"
                          title={source.url}
                          onClick={() => toggleRegenSource(source.id)}
                        >
                          <span className="ws-source-dot" />
                          <span>{source.name}</span>
                          <span className="ws-source-badge">{source.trust}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="rp-modal-source-actions">
                  <button
                    className="ws-link-button"
                    type="button"
                    onClick={() =>
                      setRegenSelected(
                        new Set(
                          regenSources
                            .filter((source) => source.enabled)
                            .map((source) => source.id),
                        ),
                      )
                    }
                  >
                    Выбрать все
                  </button>
                  <button
                    className="ws-link-button ws-link-button--muted"
                    type="button"
                    onClick={() => setRegenSelected(new Set())}
                  >
                    Сбросить
                  </button>
                </div>
              </div>

              <div className="rp-modal-field">
                <span className="rp-modal-label">Фильтры нормализации и безопасности</span>
                <div className="ws-policies rp-modal-policies">
                  {[
                    'Склейка дубликатов',
                    'Защита Prompt Injection',
                    'Без оценочных суждений',
                  ].map((label) => (
                    <label className="ws-switch-label" key={label}>
                      <input
                        className="ws-switch-input"
                        type="checkbox"
                        checked
                        disabled
                        readOnly
                      />
                      <span className="ws-switch-track" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <small className="rp-modal-note">Политики применяются автоматически.</small>
              </div>

              {detail?.run.mode === 'file' && (
                <p className="rp-modal-note">
                  Для файлового запуска параметры источников и времени не применяются —
                  будет создан новый запуск с теми же файлами.
                </p>
              )}
            </div>

            <footer className="rp-modal-footer">
              <span className="rp-modal-estimate">
                <ScheduleIcon />
                Оценка генерации:{' '}
                {formatEstimate(
                  regenSelected.size === 0
                    ? 0
                    : Math.round(
                        35 +
                          regenSelected.size * 2.5 +
                          regenLimit * 4 +
                          (regenInterval / 12) * 4,
                      ),
                )}
              </span>
              <div className="rp-modal-actions">
                <button
                  className="rp-secondary-button"
                  type="button"
                  onClick={() => setRegenOpen(false)}
                >
                  Отмена
                </button>
                <button
                  className="rp-primary-button"
                  type="submit"
                  disabled={regenSubmitting || regenLoadingSources}
                >
                  <RefreshIcon />
                  {regenSubmitting ? 'Запускаем…' : 'Сохранить и перегенерировать'}
                </button>
              </div>
            </footer>
          </form>
        </div>
      )}
    </WorkspaceLayout>
  );
}

function headerForDigest(intro: string[]) {
  if (intro.length === 0) {
    return null;
  }

  return (
    <div className="rp-digest-intro">
      <h2>{intro[0]}</h2>
      {intro.slice(1).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
