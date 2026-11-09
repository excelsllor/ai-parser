export interface DigestSection {
  title: string;
  paragraphs: string[];
}

export interface ParsedDigest {
  intro: string[];
  sections: DigestSection[];
}

export function parseDigest(text: string): ParsedDigest {
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

export interface PostItem {
  number: string;
  title: string;
  summary: string;
  sources: string[];
}

export interface ParsedPost {
  title: string;
  period: string;
  items: PostItem[];
}

export function parsePost(text: string): ParsedPost {
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

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
