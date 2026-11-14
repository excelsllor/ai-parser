import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  downloadSharedArchive,
  fetchSharedArtifact,
  getSharedRun,
} from '@api/runs';
import type { CheckResult, RunDetail } from '@api/runs';
import { AppHeader } from '@components';
import {
  AlertCircleIcon,
  CheckIcon,
  DescriptionIcon,
  DownloadIcon,
  LinkifiedText,
  EyeIcon,
  MailIcon,
  SendIcon,
  TableIcon,
} from '@components/ui';
import { cx } from '@utils/cx';
import { hostOf, parseDigest, parsePost } from '@utils/runPresentation';
import { useTabIndicator } from '@utils/useTabIndicator';

import runStyles from '@pages/workspace/RunPage.module.css';
import workspaceStyles from '@components/workspace/workspace.module.css';

const styles = { ...workspaceStyles, ...runStyles };

type TabId = 'digest' | 'post' | 'email' | 'journal' | 'checks';

const TABS: Array<{ id: TabId; label: string; icon: typeof DescriptionIcon }> = [
  { id: 'digest', label: 'Дайджест', icon: DescriptionIcon },
  { id: 'post', label: 'Пост', icon: SendIcon },
  { id: 'email', label: 'Письмо', icon: MailIcon },
  { id: 'journal', label: 'Журнал', icon: TableIcon },
  { id: 'checks', label: 'Проверки', icon: CheckIcon },
];

const STATUS_LABELS: Record<string, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  completed: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function SharedRunPage() {
  const { token = '' } = useParams();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [tab, setTab] = useState<TabId>('digest');
  const { containerRef: tabListRef, indicator } = useTabIndicator<HTMLDivElement>(tab);
  const [digest, setDigest] = useState('');
  const [post, setPost] = useState('');
  const [emailHtml, setEmailHtml] = useState('');
  const [reactions, setReactions] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getSharedRun(token);
        if (!active) {
          return;
        }
        setDetail(result);
        const [digestText, postText, emailText, checksText] = await Promise.all([
          fetchSharedArtifact(token, 'digest.md').catch(() => ''),
          fetchSharedArtifact(token, 'post.md').catch(() => ''),
          fetchSharedArtifact(token, 'email.html').catch(() => ''),
          fetchSharedArtifact(token, 'check_results.json').catch(() => '[]'),
        ]);
        if (!active) {
          return;
        }
        setDigest(digestText);
        setPost(postText);
        setEmailHtml(emailText);
        try {
          const parsed = JSON.parse(checksText) as CheckResult[];
          setChecks(Array.isArray(parsed) ? parsed : []);
        } catch {
          setChecks([]);
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Не удалось открыть публичную сессию.',
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
  }, [token]);

  async function downloadEmailMarkdown() {
    try {
      const text = await fetchSharedArtifact(token, 'email.md');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'email.md';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Download is best-effort; ZIP still contains the artifact.
    }
  }

  const parsedDigest = useMemo(() => parseDigest(digest), [digest]);
  const parsedPost = useMemo(() => parsePost(post), [post]);
  const run = detail?.run;

  function severity(score: number | undefined) {
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

  return (
    <div className={cx(styles, 'ws-page')}>
      <AppHeader badge="Публичная ссылка" />
      <main className={cx(styles, 'ws-main')}>
        <section className={cx(styles, 'ws-card rp-results')}>
          <div className={cx(styles, 'rp-tabs')}>
            <div className={cx(styles, 'rp-tab-list')} ref={tabListRef} role="tablist">
              <span
                aria-hidden="true"
                className={cx(styles, 'rp-tab-indicator')}
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
                    onClick={() => setTab(item.id)}
                  >
                    <Icon />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className={cx(styles, 'rp-tab-actions')}>
              {tab === 'email' && (
                <button
                  className={cx(styles, 'rp-secondary-button rp-secondary-button--small')}
                  type="button"
                  onClick={() => void downloadEmailMarkdown()}
                >
                  <DownloadIcon />
                  email.md
                </button>
              )}
              <button
                className={cx(styles, 'rp-primary-button rp-primary-button--small')}
                type="button"
                onClick={() => void downloadSharedArchive(token)}
              >
                <DownloadIcon />
                Скачать ZIP
              </button>
            </div>
          </div>

          {error && (
            <div className={cx(styles, 'rp-content')}>
              <div className={cx(styles, 'ws-alert ws-alert--error')} role="alert">
                <AlertCircleIcon />
                <span>{error}</span>
              </div>
              <p className={cx(styles, 'rp-muted')}>
                <Link to="/login">Войти в CyberBug</Link>
              </p>
            </div>
          )}

          {!error && loading && (
            <p className={cx(styles, 'rp-content rp-muted')}>Загружаем дайджест…</p>
          )}

          {!error && !loading && run && (
            <>
              <div className={cx(styles, 'rp-public-meta')}>
                <span className={cx(styles, 'rp-muted')}>
                  {run.title || `Запуск ${run.id.slice(0, 8)}`} · {dateFormatter.format(new Date(run.control_time))}
                </span>
                <span className={cx(styles, `ws-status ws-status--${run.status}`)}>
                  {STATUS_LABELS[run.status] ?? run.status}
                </span>
              </div>

              <div className={cx(styles, 'rp-content')}>
                {tab === 'digest' && (
                  <div className={cx(styles, 'rp-digest')}>
                    {parsedDigest.intro.length > 0 && (
                      <div className={cx(styles, 'rp-digest-intro')}>
                        <h2>{parsedDigest.intro[0]}</h2>
                        {parsedDigest.intro.slice(1).map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    )}
                    {parsedDigest.sections.map((section, index) => {
                      const event = detail?.events[index];
                      const level = severity(event?.score);
                      return (
                        <article className={cx(styles, 'rp-article')} key={`${section.title}-${index}`}>
                          <div className={cx(styles, 'rp-article-head')}>
                            <div className={cx(styles, 'rp-article-tags')}>
                              {level && (
                                <span className={cx(styles, `rp-level rp-level--${level.className}`)}>
                                  {level.label}
                                </span>
                              )}
                            </div>
                          </div>
                          <h3>{section.title}</h3>
                          <div className={cx(styles, 'rp-article-body')}>
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
                    {parsedDigest.sections.length === 0 && (
                      <p className={cx(styles, 'rp-muted')}>Дайджест ещё не сформирован.</p>
                    )}
                  </div>
                )}

                {tab === 'post' && (
                  <div className={cx(styles, 'rp-tg-shell')}>
                    <article className={cx(styles, 'rp-tg-card')}>
                      <header className={cx(styles, 'rp-tg-head')}>
                        <div className={cx(styles, 'rp-tg-avatar')}>CT</div>
                        <div className={cx(styles, 'rp-tg-channel')}>
                          <span className={cx(styles, 'rp-tg-name')}>
                            CyberBug AI
                            <span className={cx(styles, 'rp-tg-verified')}>
                              <CheckIcon />
                            </span>
                          </span>
                          <span className={cx(styles, 'rp-tg-sub')}>канал · ИБ-дайджест</span>
                        </div>
                      </header>
                      <div className={cx(styles, 'rp-tg-body')}>
                        <h3 className={cx(styles, 'rp-tg-title')}>{parsedPost.title}</h3>
                        {parsedPost.period && (
                          <p className={cx(styles, 'rp-tg-period')}>
                            <em>Период: {parsedPost.period}</em>
                          </p>
                        )}
                        {parsedPost.items.map((item) => (
                          <section className={cx(styles, 'rp-tg-item')} key={item.number}>
                            <p className={cx(styles, 'rp-tg-item-title')}>
                              <strong>
                                {item.number}. {item.title}
                              </strong>
                            </p>
                            {item.summary && (
                              <p className={cx(styles, 'rp-tg-summary')}>{item.summary}</p>
                            )}
                            {item.sources.length > 0 && (
                              <p className={cx(styles, 'rp-tg-sources')}>
                                <span className={cx(styles, 'rp-tg-sources-label')}>Источники: </span>
                                {item.sources.map((source, index) => (
                                  <span key={source.url}>
                                    <a
                                      className={cx(styles, 'rp-tg-source')}
                                      href={source.url}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      {source.name}
                                    </a>
                                    {index < item.sources.length - 1 ? ', ' : ''}
                                  </span>
                                ))}
                              </p>
                            )}
                          </section>
                        ))}
                      </div>
                      <footer className={cx(styles, 'rp-tg-footer')}>
                        <div className={cx(styles, 'rp-tg-footer-row')}>
                          <span className={cx(styles, 'rp-tg-views')}>
                            <EyeIcon />
                            {Math.max(1, parsedPost.items.length * 137)}
                          </span>
                        </div>
                        <div className={cx(styles, 'rp-tg-reactions')}>
                          {['👍', '🔥', '💯', '👀'].map((emoji) => {
                            const active = Boolean(reactions[emoji]);
                            return (
                              <button
                                className={cx(styles, `rp-tg-reaction${active ? ' rp-tg-reaction--active' : ''}`)}
                                key={emoji}
                                type="button"
                                aria-pressed={active}
                                onClick={() =>
                                  setReactions((current) => ({
                                    ...current,
                                    [emoji]: !current[emoji],
                                  }))
                                }
                              >
                                <span>{emoji}</span>
                                {active ? 1 : 0}
                              </button>
                            );
                          })}
                        </div>
                      </footer>
                    </article>
                  </div>
                )}

                {tab === 'email' && (
                  <iframe
                    className={cx(styles, 'rp-email-frame')}
                    title="Письмо"
                    sandbox=""
                    srcDoc={emailHtml}
                  />
                )}

                {tab === 'journal' && (
                  <div className={cx(styles, 'rp-journal-table-wrap')}>
                    <table className={cx(styles, 'rp-journal-table')}>
                      <thead>
                        <tr>
                          <th>Материал</th>
                          <th>Статус</th>
                          <th>Причина</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail?.journal ?? []).map((row) => (
                          <tr key={row.id}>
                            <td>
                              <span className={cx(styles, 'rp-journal-source')}>
                                {hostOf(row.external_id)}
                              </span>
                            </td>
                            <td>
                              <span className={cx(styles, 'rp-journal-status')}>
                                {row.status}
                              </span>
                            </td>
                            <td>{row.reason || row.error || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === 'checks' && (
                  <div className={cx(styles, 'rp-checks-grid')}>
                    {checks.map((check) => (
                      <article className={cx(styles, 'rp-check')} key={check.id ?? check.scenario}>
                        <div className={cx(styles, 'rp-check-head')}>
                          <strong>{check.scenario}</strong>
                          <span className={cx(styles, `rp-check-badge rp-check-badge--${check.passed ? 'passed' : 'failed'}`)}>
                            {check.passed ? 'OK' : 'Ошибка'}
                          </span>
                        </div>
                        <p className={cx(styles, 'rp-muted')}>{check.note}</p>
                      </article>
                    ))}
                    {checks.length === 0 && (
                      <p className={cx(styles, 'rp-muted')}>Проверки ещё не сформированы.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
