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
  listSources,
  rerunRun,
  runVersionChain,
  sendRunToTelegram,
  sendTestEmail,
} from '@api/runs';
import type {
  CheckResult,
  RunDetail,
  RunInfo,
  RunStage,
  RunSummary,
  Source,
} from '@api/runs';
import { LoaderGame, WorkspaceLayout } from '@components';
import useRunsFeed from '@hooks/useRunsFeed';
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
  LinkifiedText,
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
  UploadIcon,
} from '@components/ui';

import { cx } from '@utils/cx';
import { hostOf, parseDigest, parsePost } from '@utils/runPresentation';
import { useTabIndicator } from '@utils/useTabIndicator';

import runStyles from './RunPage.module.css';
import workspaceStyles from '@components/workspace/workspace.module.css';

const styles = { ...workspaceStyles, ...runStyles };

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

const GENERATION_STAGES = [
  { key: 'collect', label: 'Сбор источников', weight: 20 },
  { key: 'normalize', label: 'Нормализация материалов', weight: 15 },
  { key: 'analyze', label: 'Анализ и оценка событий', weight: 35 },
  { key: 'critic', label: 'Проверка фактов', weight: 15 },
  { key: 'report', label: 'Формирование дайджеста', weight: 15 },
] as const;

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

function formatRemaining(seconds: number | null): string {
  if (seconds === null) {
    return '~1–2 мин';
  }
  if (seconds <= 1) {
    return 'меньше секунды';
  }
  if (seconds < 60) {
    return `~${seconds} с`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `~${minutes} мин ${rest.toString().padStart(2, '0')} с`;
}

function generationProgress(
  run: RunInfo | undefined,
  stages: RunStage[],
): { percent: number; label: string; step: number; remaining: number | null } {
  if (!run) {
    return { percent: 0, label: 'Подготовка…', step: 0, remaining: null };
  }
  if (run.status === 'completed') {
    return { percent: 100, label: 'Готово', step: GENERATION_STAGES.length, remaining: 0 };
  }
  if (run.status === 'queued') {
    return { percent: 0, label: 'Ожидание в очереди', step: 0, remaining: null };
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    return { percent: 0, label: 'Обработка остановлена', step: 0, remaining: null };
  }

  const byKey = new Map(stages.map((stage) => [stage.stage, stage]));
  let percent = 0;
  let step = 0;
  let label: string = GENERATION_STAGES[0].label;

  for (let index = 0; index < GENERATION_STAGES.length; index += 1) {
    const definition = GENERATION_STAGES[index];
    const stage = byKey.get(definition.key);
    step = index + 1;

    if (stage?.status === 'completed') {
      percent += definition.weight;
      continue;
    }

    label = stage?.message?.trim() || definition.label;
    if (stage?.status === 'running') {
      percent += Math.round(definition.weight * 0.45);
    }
    break;
  }

  if (step === GENERATION_STAGES.length && percent >= 100) {
    label = 'Завершаем обработку…';
    percent = 99;
  }

  const startedAt = run.started_at ? new Date(run.started_at).getTime() : null;
  const elapsed =
    startedAt && Number.isFinite(startedAt)
      ? Math.max(0, (Date.now() - startedAt) / 1000)
      : null;
  const remaining =
    elapsed !== null && percent > 5
      ? Math.max(0, Math.round((elapsed * (100 - percent)) / percent))
      : null;

  return { percent: Math.min(99, percent), label, step, remaining };
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get('tab') ?? 'digest') as TabId;
  const tab: TabId = TABS.some((item) => item.id === activeTab)
    ? activeTab
    : 'digest';
  const { containerRef: tabListRef, indicator } = useTabIndicator<HTMLDivElement>(tab);

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const {
    runs,
    loading: loadingRuns,
    loadingMore,
    hasMore,
    loadMore,
    removeRun,
    renameRunLocally,
  } = useRunsFeed();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [journalFilter, setJournalFilter] = useState('');
  const [reactions, setReactions] = useState<Record<string, boolean>>({});

  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [loadingArtifacts, setLoadingArtifacts] = useState<Record<string, boolean>>({});

  const [regenOpen, setRegenOpen] = useState(false);
  const [regenSources, setRegenSources] = useState<Source[]>([]);
  const [regenSelected, setRegenSelected] = useState<Set<string>>(new Set());
  const [regenFiles, setRegenFiles] = useState<File[]>([]);
  const [regenControlTime, setRegenControlTime] = useState('');
  const [regenInterval, setRegenInterval] = useState(24);
  const [regenLimit, setRegenLimit] = useState(5);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenLoadingSources, setRegenLoadingSources] = useState(false);
  const [regenSubmitting, setRegenSubmitting] = useState(false);

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
    if (!regenOpen) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
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
      return ['email.html', 'email.md', 'email_subject.txt'];
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
  const versionNav = (
    <span className={cx(styles, "rp-versions")}>
      <button
        className={cx(styles, "rp-version-button")}
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
        className={cx(styles, "rp-version-button")}
        type="button"
        aria-label="Следующая версия"
        disabled={versionIndex >= versions.length - 1}
        onClick={() => navigate(`/runs/${versions[versionIndex + 1]}`)}
      >
        <ChevronRightIcon />
      </button>
    </span>
  );
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
  const generation = generationProgress(run, detail?.stages ?? []);
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

  function toggleReaction(emoji: string) {
    setReactions((current) => ({ ...current, [emoji]: !current[emoji] }));
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
    setRegenSelected(new Set());
    setRegenFiles([]);
    setRegenControlTime(toDateTimeLocal(detail?.run?.control_time));
    setRegenInterval(detail?.run.interval_hours ?? 24);
    setRegenLimit(detail?.run.max_items ?? 5);
    setRegenLoadingSources(true);

    try {
      const sources = await listSources();
      setRegenSources(sources);
      const runSourceIds = new Set(detail?.run.source_ids ?? []);
      setRegenSelected(
        new Set(
          sources
            .filter((source) => source.enabled && runSourceIds.has(source.id))
            .map((source) => source.id),
        ),
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
    if (run.mode !== 'file' && regenSelected.size === 0) {
      setRegenError('Выберите хотя бы один источник мониторинга.');
      return;
    }

    const controlTime = new Date(regenControlTime);
    if (run.mode !== 'file' && Number.isNaN(controlTime.getTime())) {
      setRegenError('Укажите корректное контрольное время.');
      return;
    }

    setRegenSubmitting(true);
    setRegenError(null);
    try {
      const next =
        run.mode === 'file'
          ? regenFiles.length > 0
            ? await createRun({
                mode: 'file',
                sources: [],
                files: regenFiles,
                controlTime: Number.isNaN(controlTime.getTime())
                  ? run.control_time
                  : controlTime.toISOString(),
                intervalHours: regenInterval,
                maxItems: regenLimit,
                parentRunId: run.id,
              })
            : await rerunRun(run.id)
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
      removeRun(run.id);
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

  async function handleSendTelegram() {
    if (!id) {
      return;
    }
    setTelegramSending(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await sendRunToTelegram(id);
      setNotice(
        result.message_id
          ? `Пост отправлен в Telegram (message_id ${result.message_id}).`
          : 'Пост отправлен в Telegram.',
      );
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Не удалось отправить пост в Telegram.',
      );
    } finally {
      setTelegramSending(false);
    }
  }

  if (loading) {
    return (
      <WorkspaceLayout
        runs={runs}
        loadingRuns={loadingRuns}
        loadingMoreRuns={loadingMore}
        hasMoreRuns={hasMore}
        onLoadMoreRuns={loadMore}
        onSelectRun={(next) => navigate(`/runs/${next.id}`)}
        onDeleteRun={handleDeleteRun}
        onRenameRun={renameRunLocally}
        onNewQuery={() => navigate('/')}
      >
        <section className={cx(styles, "ws-card rp-loading")}>Загружаем запуск…</section>
      </WorkspaceLayout>
    );
  }

  if (error || !run) {
    return (
      <WorkspaceLayout
        runs={runs}
        loadingRuns={loadingRuns}
        loadingMoreRuns={loadingMore}
        hasMoreRuns={hasMore}
        onLoadMoreRuns={loadMore}
        onSelectRun={(next) => navigate(`/runs/${next.id}`)}
        onDeleteRun={handleDeleteRun}
        onRenameRun={renameRunLocally}
        onNewQuery={() => navigate('/')}
      >
        <section className={cx(styles, "ws-card")}>
          <div className={cx(styles, "ws-alert ws-alert--error")} role="alert">
            <AlertCircleIcon />
            <span>{error ?? 'Запуск не найден.'}</span>
          </div>
          <button className={cx(styles, "rp-secondary-button")} type="button" onClick={() => navigate('/')}>
            Вернуться к созданию запроса
          </button>
        </section>
      </WorkspaceLayout>
    );
  }

  const canRegenerate =
    !regenSubmitting &&
    !regenLoadingSources &&
    (run.mode === 'file' ||
      (regenSelected.size > 0 &&
        regenControlTime.trim() !== '' &&
        !Number.isNaN(new Date(regenControlTime).getTime())));

  return (
    <WorkspaceLayout
      runs={runs}
      loadingRuns={loadingRuns}
      loadingMoreRuns={loadingMore}
      hasMoreRuns={hasMore}
      onLoadMoreRuns={loadMore}
      activeRunId={run.id}
      onSelectRun={(next) => navigate(`/runs/${next.id}`)}
      onDeleteRun={handleDeleteRun}
      onRenameRun={renameRunLocally}
      onNewQuery={() => navigate('/')}
    >
      <section className={cx(styles, "ws-card rp-params")}>
        <div className={cx(styles, "rp-params-head")}>
          <div className={cx(styles, "rp-params-title")}>
            <span className={cx(styles, "rp-params-icon")}>
              <SparklesIcon />
            </span>
            <span className={cx(styles, "rp-params-name")}>Параметры текущей выборки</span>
            <span
              className={cx(styles, `ws-status ws-status--${statusClass(run.status)}`)}
              aria-label="Статус сессии"
            >
              {RUN_STATUS_LABELS[run.status] ?? run.status}
            </span>
          </div>
          <div className={cx(styles, "rp-params-actions")}>
            {isGenerating ? (
              <button
                className={cx(styles, "rp-danger-button")}
                type="button"
                onClick={handleCancelRun}
                disabled={cancelling}
              >
                <StopIcon />
                {cancelling ? 'Отменяем…' : 'Отменить'}
              </button>
            ) : (
              <button
                className={cx(styles, "rp-primary-button")}
                type="button"
                onClick={openRegenModal}
                disabled={regenLoadingSources}
              >
                <RefreshIcon />
                Перегенерировать
              </button>
            )}
            <button
              className={cx(styles, "rp-danger-button")}
              type="button"
              onClick={() => handleDeleteRun(run)}
            >
              <DeleteIcon />
              Удалить
            </button>
          </div>
        </div>

        <div className={cx(styles, "rp-chips")}>
          <span className={cx(styles, "rp-chip rp-chip--mono")}>{formatDate(run.control_time)}</span>
          <span className={cx(styles, "rp-chip")}>{run.interval_hours} часов</span>
          <span className={cx(styles, "rp-chip")}>Лимит: {run.max_items} событий</span>
          <span className={cx(styles, "rp-chip")}>{sourceCount} источников</span>
          <span className={cx(styles, "rp-chip rp-chip--green")}>Анти-инъекции: Вкл</span>
          <span className={cx(styles, "rp-chip rp-chip--blue")}>Дедупликация: Вкл</span>
          <span className={cx(styles, "rp-chip")}>Без оценок</span>
        </div>

        <div className={cx(styles, "rp-stats")}>
          <div className={cx(styles, "rp-stat")}>
            <span className={cx(styles, "rp-stat-label")}>Период выборки</span>
            <strong>{formatShortDate(run.period_start)} — {formatShortDate(run.period_end)}</strong>
            <span className={cx(styles, "rp-stat-hint")}>Окно {run.interval_hours} часов</span>
          </div>
          <div className={cx(styles, "rp-stat")}>
            <span className={cx(styles, "rp-stat-label")}>Материалы</span>
            <strong>{readNumber(stats, 'items') ?? detail?.journal.length ?? 0} публикаций</strong>
            <span className={cx(styles, "rp-stat-hint")}>{detail?.journal.length ?? 0} строк журнала</span>
          </div>
          <div className={cx(styles, "rp-stat rp-stat--blue")}>
            <span className={cx(styles, "rp-stat-label")}>Отобрано событий</span>
            <strong>{detail?.events.length ?? 0} событий</strong>
            <span className={cx(styles, "rp-stat-hint")}>Финальный дайджест</span>
          </div>
          <div className={cx(styles, "rp-stat rp-stat--green")}>
            <span className={cx(styles, "rp-stat-label")}>Проверки</span>
            <strong>{passedChecks} из {checks.length}</strong>
            <span className={cx(styles, "rp-stat-hint")}>Регламентные проверки</span>
          </div>
          <div className={cx(styles, "rp-stat rp-stat--blue")}>
            <span className={cx(styles, "rp-stat-label")}>Дедупликация</span>
            <strong>{mergedCount} объединено</strong>
            <span className={cx(styles, "rp-stat-hint")}>Семантические кластеры</span>
          </div>
          <div className={cx(styles, "rp-stat rp-stat--green")}>
            <span className={cx(styles, "rp-stat-label")}>Время обработки</span>
            <strong>{readNumber(stats, 'duration_secs') ?? '—'} с</strong>
            <span className={cx(styles, "rp-stat-hint")}>Полный цикл пайплайна</span>
          </div>
        </div>
      </section>

      {isGenerating ? (
        <section className={cx(styles, "ws-card rp-generating")}>
          <div className={cx(styles, "rp-progress")}>
            <div className={cx(styles, "rp-progress-head")}>
              <span>{generation.label}</span>
              <strong>{generation.percent}%</strong>
            </div>
            <div
              className={cx(styles, "rp-progress-track")}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={generation.percent}
            >
              <span style={{ width: `${generation.percent}%` }} />
            </div>
            <div className={cx(styles, "rp-progress-meta")}>
              <span>
                {generation.step > 0
                  ? `Шаг ${generation.step} из ${GENERATION_STAGES.length}`
                  : 'Ожидание'}
              </span>
              <span>Осталось {formatRemaining(generation.remaining)}</span>
            </div>
          </div>
          <div className={cx(styles, "rp-generating-loader")}>
            <LoaderGame message="Формируем дайджест…" hint={generationHint} />
          </div>
          {actionError && (
            <div className={cx(styles, "ws-alert ws-alert--error rp-generating-alert")} role="alert">
              <AlertCircleIcon />
              <span>{actionError}</span>
            </div>
          )}
          {versions.length > 0 && (
            <div className={cx(styles, "rp-generating-footer")}>{versionNav}</div>
          )}
        </section>
      ) : (
        <section className={cx(styles, "ws-card rp-results")}>
        <div className={cx(styles, "rp-tabs")}>
          <div className={cx(styles, "rp-tab-list")} ref={tabListRef} role="tablist">
            <span
              aria-hidden="true"
              className={cx(styles, "rp-tab-indicator")}
              style={{
                width: indicator.width,
                opacity: indicator.visible ? 1 : 0,
                transform: `translateX(${indicator.left}px)`,
              }}
            />
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={cx(styles, `rp-tab${tab === item.id ? ' rp-tab--active' : ''}`)}
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  data-tab-active={tab === item.id}
                  onClick={() => selectTab(item.id)}
                >
                  <Icon />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className={cx(styles, "rp-tab-actions")}>
            {tab === 'digest' && (
              <>
                <button
                  className={cx(styles, "rp-icon-button")}
                  type="button"
                  title="Скопировать Markdown"
                  onClick={() => handleCopy(digestText, 'Markdown')}
                >
                  <CopyIcon />
                </button>
                <button
                  className={cx(styles, "rp-secondary-button rp-secondary-button--small")}
                  type="button"
                  onClick={() => handleDownload('journal.csv')}
                >
                  <TableIcon />
                  journal.csv
                </button>
                <button
                  className={cx(styles, "rp-primary-button rp-primary-button--small")}
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
                  className={cx(styles, "rp-icon-button")}
                  type="button"
                  title="Скопировать пост"
                  onClick={() => handleCopy(postText, 'Пост')}
                >
                  <CopyIcon />
                </button>
                <button
                  className={cx(styles, "rp-primary-button rp-primary-button--small")}
                  type="button"
                  onClick={() => handleDownload('post.md')}
                >
                  <DownloadIcon />
                  post.md
                </button>
                <button
                  className={cx(styles, "rp-secondary-button rp-secondary-button--small")}
                  type="button"
                  onClick={handleSendTelegram}
                  disabled={telegramSending}
                >
                  <SendIcon />
                  {telegramSending ? 'Отправляем…' : 'В Telegram'}
                </button>
              </>
            )}
            {tab === 'email' && (
              <>
                <button
                  className={cx(styles, "rp-secondary-button rp-secondary-button--small")}
                  type="button"
                  onClick={() => handleDownload('email.md')}
                >
                  <DownloadIcon />
                  email.md
                </button>
                <button
                  className={cx(styles, "rp-secondary-button rp-secondary-button--small")}
                  type="button"
                  onClick={() => handleDownload('email.html')}
                >
                  <DownloadIcon />
                  email.html
                </button>
                <button
                  className={cx(styles, "rp-primary-button rp-primary-button--small")}
                  type="button"
                  onClick={handleSendEmail}
                  disabled={sending}
                >
                  <SendIcon />
                  {sending ? 'Отправляем…' : 'Отправить на тестовый адрес'}
                </button>
              </>
            )}
          </div>
        </div>

        {(actionError || notice) && (
          <div className={cx(styles, `ws-alert ${actionError ? 'ws-alert--error' : 'ws-alert--info'}`)} role="status">
            {actionError ? <AlertCircleIcon /> : <InfoIcon />}
            <span>{actionError ?? notice}</span>
          </div>
        )}

        <div className={cx(styles, "rp-content")}>
          {tab === 'digest' && (
            digestPending ? (
              <LoaderGame message="Формируем дайджест…" hint={generationHint} />
            ) : (
              <div className={cx(styles, "rp-digest")}>
                {headerForDigest(parsedDigest.intro)}
                {!digestText && (
                  <p className={cx(styles, "rp-muted")}>{missingArtifact(run.status, 'digest.md')}</p>
                )}
                {parsedDigest.sections.map((section, index) => {
                  const event = detail?.events[index];
                  const level = severity(event?.score);
                  const imageUrl =
                    typeof event?.attributes?.image_url === 'string'
                      ? event.attributes.image_url
                      : null;
                  return (
                    <article className={cx(styles, "rp-article")} key={`${section.title}-${index}`}>
                      <div className={cx(styles, "rp-article-head")}>
                        <div className={cx(styles, "rp-article-tags")}>
                          {level && <span className={cx(styles, `rp-level rp-level--${level.className}`)}>{level.label}</span>}
                          <span className={cx(styles, "rp-article-index")}>Событие {index + 1}</span>
                        </div>
                        {event && (
                          <span className={cx(styles, "rp-article-key")}>{event.event_key}</span>
                        )}
                      </div>
                      <h3>{section.title}</h3>
                      {run?.policies?.include_images && imageUrl && (
                        <img
                          className={cx(styles, "rp-article-image")}
                          src={imageUrl}
                          alt=""
                          loading="lazy"
                        />
                      )}
                      <div className={cx(styles, "rp-article-body")}>
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
                              className={cx(styles, isSources ? 'rp-article-sources' : undefined)}
                              key={`${section.title}-${paragraphIndex}`}
                            >
                              {label && <strong>{label}:</strong>}
                              <LinkifiedText text={rest} />
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
              <LoaderGame message="Готовим пост…" hint={generationHint} />
            ) : (
              <div className={cx(styles, "rp-post")}>
              {!postText && (
                <p className={cx(styles, "rp-muted")}>{missingArtifact(run.status, 'post.md')}</p>
              )}
              {postText && (
                <>
                  <div className={cx(styles, "rp-tg-shell")}>
                    <article className={cx(styles, "rp-tg-card")}>
                      <header className={cx(styles, "rp-tg-head")}>
                        <div className={cx(styles, "rp-tg-avatar")}>CT</div>
                        <div className={cx(styles, "rp-tg-channel")}>
                          <span className={cx(styles, "rp-tg-name")}>
                            CyberBug AI
                            <span className={cx(styles, "rp-tg-verified")}>
                              <CheckIcon />
                            </span>
                          </span>
                          <span className={cx(styles, "rp-tg-sub")}>канал · ИБ-дайджест</span>
                        </div>
                        <span className={cx(styles, "rp-tg-time")}>{formatShortDate(run.control_time)}</span>
                      </header>

                      <div className={cx(styles, "rp-tg-body")}>
                        <h3 className={cx(styles, "rp-tg-title")}>
                          <ShieldHeartIcon className={cx(styles, "rp-tg-shield")} />
                          {parsedPost.title}
                        </h3>
                        {parsedPost.period && (
                          <p className={cx(styles, "rp-tg-period")}>
                            <em>Период: {parsedPost.period}</em>
                          </p>
                        )}
                        <p className={cx(styles, "rp-tg-lead")}>
                          <em>
                            Краткая сводка критических угроз и изменений инфраструктуры
                            за прошедшие сутки:
                          </em>
                        </p>

                        {parsedPost.items.map((item) => (
                          <section className={cx(styles, "rp-tg-item")} key={`${item.number}-${item.title}`}>
                            <p className={cx(styles, "rp-tg-item-title")}>
                              <strong>
                                {item.number}. {item.title}
                              </strong>
                            </p>
                            {item.summary && <p className={cx(styles, "rp-tg-summary")}>{item.summary}</p>}
                            {item.sources.length > 0 && (
                              <p className={cx(styles, "rp-tg-sources")}>
                                <span className={cx(styles, "rp-tg-sources-label")}>Источники: </span>
                                {item.sources.map((source, index) => (
                                  <span key={source}>
                                    <a
                                      className={cx(styles, "rp-tg-source")}
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
                          <p className={cx(styles, "rp-muted")}>Не удалось разобрать структуру поста.</p>
                        )}
                      </div>

                      <footer className={cx(styles, "rp-tg-footer")}>
                        <div className={cx(styles, "rp-tg-footer-row")}>
                          <span className={cx(styles, "rp-tg-views")}>
                            <EyeIcon />
                            {tgMeta.views.toLocaleString('ru-RU')}
                          </span>
                          <span className={cx(styles, "rp-tg-date")}>{formatDate(run.created_at)}</span>
                        </div>
                        <div className={cx(styles, "rp-tg-reactions")}>
                          {tgMeta.reactions.map((reaction) => {
                            const active = Boolean(reactions[reaction.emoji]);
                            return (
                              <button
                                className={cx(styles, `rp-tg-reaction${active ? ' rp-tg-reaction--active' : ''}`)}
                                key={reaction.emoji}
                                type="button"
                                aria-pressed={active}
                                onClick={() => toggleReaction(reaction.emoji)}
                              >
                                <span>{reaction.emoji}</span>
                                {reaction.count + (active ? 1 : 0)}
                              </button>
                            );
                          })}
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
              <LoaderGame message="Готовим письмо…" hint={generationHint} />
            ) : (
            <div className={cx(styles, "rp-email")}>
              <div className={cx(styles, "rp-email-meta")}>
                <label>
                  Тема письма
                  <span>{emailSubject || 'Загружаем тему…'}</span>
                </label>
                <label>
                  Период
                  <span>{formatShortDate(run.period_start)} — {formatShortDate(run.period_end)}</span>
                </label>
              </div>

              {!emailHtml && (
                <p className={cx(styles, "rp-muted")}>{missingArtifact(run.status, 'email.html')}</p>
              )}
              {emailHtml && (
                <div className={cx(styles, "rp-email-canvas")}>
                  <div className={cx(styles, "rp-email-browser")}>
                    <span className={cx(styles, "rp-browser-dot rp-browser-dot--red")} />
                    <span className={cx(styles, "rp-browser-dot rp-browser-dot--yellow")} />
                    <span className={cx(styles, "rp-browser-dot rp-browser-dot--green")} />
                    <span>HTML Rendering Preview · UTF-8</span>
                  </div>
                  <iframe
                    className={cx(styles, "rp-email-frame")}
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
            <div className={cx(styles, "rp-journal")}>
              <div className={cx(styles, "rp-journal-toolbar")}>
                <div className={cx(styles, "rp-search")}>
                  <SearchIcon />
                  <input
                    value={journalFilter}
                    onChange={(event) => setJournalFilter(event.target.value)}
                    placeholder="Фильтр по URL, группе, статусу или причине"
                    aria-label="Фильтр журнала"
                  />
                </div>
                <span className={cx(styles, "rp-muted")}>
                  Показано {filteredJournal.length} из {detail?.journal.length ?? 0} материалов
                </span>
              </div>

              <div className={cx(styles, "rp-journal-table-wrap")}>
                <table className={cx(styles, "rp-journal-table")}>
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
                          <span className={cx(styles, "rp-journal-source")}>{hostOf(row.external_id)}</span>
                          <span className={cx(styles, "rp-journal-url")}>{row.external_id}</span>
                        </td>
                        <td>
                          <span className={cx(styles, "rp-journal-group")}>{row.group_key ?? '—'}</span>
                        </td>
                        <td>
                          <span className={cx(styles, `rp-journal-status rp-journal-status--${journalStatusClass(row.status)}`)}>
                            {row.status}
                          </span>
                        </td>
                        <td>
                          <span className={cx(styles, "rp-journal-reason")}>{row.reason}</span>
                          {row.error && <span className={cx(styles, "rp-journal-error")}>{row.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredJournal.length === 0 && (
                  <p className={cx(styles, "rp-muted rp-journal-empty")}>Ничего не найдено.</p>
                )}
              </div>
            </div>
          )}

          {tab === 'checks' && (
            <div className={cx(styles, "rp-checks")}>
              <div className={cx(styles, "rp-checks-head")}>
                <div>
                  <h2>Регламентные проверки</h2>
                  <p>Все алгоритмические критерии формирования подтверждены.</p>
                </div>
                <span className={cx(styles, "rp-checks-summary")}>
                  {passedChecks} из {checks.length} пройдено
                </span>
              </div>

              {checks.length === 0 && (
                <p className={cx(styles, "rp-muted")}>Проверки ещё не сформированы.</p>
              )}

              <div className={cx(styles, "rp-checks-grid")}>
                {checks.map((check, index) => (
                  <article className={cx(styles, "rp-check")} key={check.id}>
                    <div className={cx(styles, "rp-check-head")}>
                      <span>{CHECK_LABELS[check.scenario] ?? check.scenario}</span>
                      <span className={cx(styles, `rp-check-badge rp-check-badge--${check.passed ? 'passed' : 'failed'}`)}>
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

        <div className={cx(styles, "rp-footer")}>
          {versionNav}
          <span className={cx(styles, "rp-footer-dot")} />
          <span>{formatDate(run.created_at)}</span>
          <span className={cx(styles, "rp-footer-dot")} />
          <span>{run.model}</span>
          <span className={cx(styles, "rp-footer-spacer")} />
          <button className={cx(styles, "rp-link")} type="button" onClick={() => selectTab('journal')}>
            Открыть журнал
          </button>
        </div>
        </section>
      )}

      {regenOpen && (
        <div
          className={cx(styles, "rp-modal-backdrop")}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRegenOpen(false);
            }
          }}
        >
          <form
            className={cx(styles, "rp-modal")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="regen-title"
            onSubmit={handleRegenerate}
          >
            <header className={cx(styles, "rp-modal-head")}>
              <div className={cx(styles, "rp-modal-head-title")}>
                <span className={cx(styles, "rp-modal-icon")}>
                  <TuneIcon />
                </span>
                <div>
                  <h2 id="regen-title">Параметры выборки и генерации</h2>
                  <p>Тонкая настройка парсинга, фильтрации и суммаризации дайджеста</p>
                </div>
              </div>
              <button
                className={cx(styles, "rp-modal-close")}
                type="button"
                aria-label="Закрыть окно"
                onClick={() => setRegenOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>

            <div className={cx(styles, "rp-modal-body")}>
              {regenError && (
                <div className={cx(styles, "ws-alert ws-alert--error")} role="alert">
                  <AlertCircleIcon />
                  <span>{regenError}</span>
                </div>
              )}

              <label className={cx(styles, "rp-modal-field")}>
                <span className={cx(styles, "rp-modal-label")}>Контрольное время среза *</span>
                <div className={cx(styles, "rp-modal-input-wrap")}>
                  <ScheduleIcon />
                  <input
                    type="datetime-local"
                    value={regenControlTime}
                    onChange={(event) => setRegenControlTime(event.target.value)}
                    required
                  />
                  <span className={cx(styles, "rp-modal-tz")}>
                    <LockIcon />
                    Пояс SOC
                  </span>
                </div>
              </label>

              <div className={cx(styles, "rp-modal-field")}>
                <div className={cx(styles, "rp-modal-field-head")}>
                  <span className={cx(styles, "rp-modal-label")}>Временное окно отсечки</span>
                  <span>Глубина ретроспективного анализа</span>
                </div>
                <div className={cx(styles, "ws-pills")}>
                  {[12, 24, 48].map((hours) => (
                    <button
                      className={cx(styles, `ws-pill${
                        regenInterval === hours ? ' ws-pill--active' : ''
                      }`)}
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

              <div className={cx(styles, "rp-modal-field")}>
                <div className={cx(styles, "rp-modal-field-head")}>
                  <span className={cx(styles, "rp-modal-label")}>Лимит отобранных событий</span>
                </div>
                <div className={cx(styles, "ws-pills")}>
                  {[3, 5, 7, 10].map((value) => (
                    <button
                      className={cx(styles, `ws-pill${
                        regenLimit === value ? ' ws-pill--active' : ''
                      }`)}
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

              {detail?.run.mode !== 'file' && (
                <div className={cx(styles, "rp-modal-field")}>
                  <div className={cx(styles, "rp-modal-field-head")}>
                    <span className={cx(styles, "rp-modal-label")}>Источники мониторинга</span>
                    <span>
                      Выбрано: {regenSelected.size} из {regenSources.length}
                    </span>
                  </div>
                  {regenLoadingSources ? (
                    <p className={cx(styles, "rp-muted")}>Загружаем источники…</p>
                  ) : (
                    <div className={cx(styles, "ws-sources rp-modal-source-list")}>
                      {regenSources.map((source) => {
                        const selected = regenSelected.has(source.id);
                        return (
                          <button
                            className={cx(styles, `ws-source${
                              selected ? ' ws-source--selected' : ''
                            }`)}
                            key={source.id}
                            type="button"
                            title={source.url}
                            onClick={() => toggleRegenSource(source.id)}
                          >
                            <span className={cx(styles, "ws-source-dot")} />
                            <span>{source.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className={cx(styles, "rp-modal-source-actions")}>
                    <button
                      className={cx(styles, "ws-link-button")}
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
                      className={cx(styles, "ws-link-button ws-link-button--muted")}
                      type="button"
                      onClick={() => setRegenSelected(new Set())}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>
              )}

              {detail?.run.mode === 'file' && (
                <div className={cx(styles, "rp-modal-field")}>
                  <div className={cx(styles, "rp-modal-field-head")}>
                    <span className={cx(styles, "rp-modal-label")}>Файлы датасета</span>
                    <span>
                      {regenFiles.length > 0
                        ? `Выбрано: ${regenFiles.length}`
                        : 'Оставьте пусто, чтобы взять файлы текущей сессии'}
                    </span>
                  </div>
                  <label className={cx(styles, "ws-file-picker")}>
                    <input
                      type="file"
                      multiple
                      accept=".json,.jsonl,.ndjson,.csv,.zip,.txt,.md,.html"
                      onChange={(event) =>
                        setRegenFiles(Array.from(event.target.files ?? []))
                      }
                    />
                    <UploadIcon />
                    <span>
                      <strong>Выбрать файлы</strong>
                      <small>JSON, JSONL, CSV, TXT или ZIP</small>
                    </span>
                  </label>
                  {regenFiles.length > 0 && (
                    <div className={cx(styles, "ws-file-list")}>
                      {regenFiles.map((file) => (
                        <span
                          className={cx(styles, "ws-file-item")}
                          key={`${file.name}-${file.size}`}
                        >
                          <span>{file.name}</span>
                          <small>{Math.ceil(file.size / 1024)} КБ</small>
                          <button
                            type="button"
                            aria-label={`Убрать ${file.name}`}
                            onClick={() =>
                              setRegenFiles((previous) =>
                                previous.filter((item) => item !== file),
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className={cx(styles, "rp-modal-note")}>
                    Если файлы не выбраны, будет создан новый запуск с файлами текущей
                    сессии.
                  </p>
                </div>
              )}
            </div>

            <footer className={cx(styles, "rp-modal-footer")}>
              <span className={cx(styles, "rp-modal-estimate")}>
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
              <div className={cx(styles, "rp-modal-actions")}>
                <button
                  className={cx(styles, "rp-secondary-button")}
                  type="button"
                  onClick={() => setRegenOpen(false)}
                >
                  Отмена
                </button>
                <button
                  className={cx(styles, "rp-primary-button")}
                  type="submit"
                  disabled={!canRegenerate}
                  title={
                    run.mode !== 'file' && regenSelected.size === 0
                      ? 'Выберите хотя бы один источник'
                      : undefined
                  }
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
    <div className={cx(styles, "rp-digest-intro")}>
      <h2>{intro[0]}</h2>
      {intro.slice(1).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
