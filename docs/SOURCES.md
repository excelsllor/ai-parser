# Источники задания

В реестр добавлены все 28 источников из Приложения 1. Основной способ — RSS;
для сайтов без стабильной ленты используется HTML, для UserGate — sitemap + JSON API.

## RSS (21)

| Источник | RSS |
|---|---|
| SecurityLab | `https://www.securitylab.ru/_services/export/rss/news/` |
| Хакер | `https://xakep.ru/feed/` |
| ComNews | `https://www.comnews.ru/rss` |
| Коммерсантъ | `https://www.kommersant.ru/RSS/news.xml` |
| ТАСС | `https://tass.ru/rss/v2.xml` |
| РИА Новости | `https://ria.ru/export/rss2/archive/index.xml` |
| IT-World | `https://www.it-world.ru/rss/` |
| SecurityMedia | `https://securitymedia.org/rss/` |
| Инфобезопасность | `https://infobezopasnost.ru/blog/news/rss/` |
| Газета.Ru | `https://www.gazeta.ru/export/rss/first.xml` |
| Аргументы и факты | `https://aif.ru/rss/techno.php` |
| CNews Safe | `https://safe.cnews.ru/inc/rss/news.xml` |
| Habr InfoSecurity | `https://habr.com/ru/rss/hubs/infosecurity/all/?fl=ru` |
| RB.RU | `https://rb.ru/feeds/news_ex/` |
| 3DNews | `https://3dnews.ru/news/rss/` |
| Компьютерра | `https://www.computerra.ru/tag/security/feed/` |
| ITWeek | `https://www.itweek.ru/rss/index.php` |
| iXBT | `https://www.ixbt.com/export/news.rss` |
| Российская газета | `https://rg.ru/xml/index.xml` |
| Известия | `https://iz.ru/xml/rss/all.xml` |
| Лаборатория Касперского | `https://www.kaspersky.ru/blog/feed/` |

## HTML / sitemap (7)

| Источник | Способ |
|---|---|
| InfoWatch | HTML, sitemap |
| ICT.Moscow | HTML, раздел «Информационная безопасность» |
| Overclockers | HTML, лента новостей |
| Positive Technologies | HTML, новости |
| Солар | HTML, новости компании |
| UserGate | sitemap + JSON API страницы |
| ИнфоТеКС | HTML, пресс-центр |

## Ограничения

- **ТАСС**: RSS отдаёт только короткие описания, страницы статей закрыты
  JavaScript-челленджем ServicePipe. Такие материалы помечаются как
  «недостаточно данных», а не пересказываются по обрывку.
- **Positive Technologies**: сертификат подписан Russian Trusted Root CA,
  которого нет в стандартном хранилище контейнера. Источник фиксируется в
  журнале как недоступный, пока CA не добавлен в доверенные.
- Остальные 26 источников в live-прогоне дали материалы с текстом >= 120 символов.
