export interface IntelAlertConfig {
  watchlistOnly?: boolean;
  maxItems?: number;
  includeSources?: string[];
  excludeSources?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  minKeywordOverlap?: number;
  minTitleLength?: number;
  minSentiment?: number;
  maxSentiment?: number;
  includeEntities?: string[];
  excludeEntities?: string[];
  minEntityOverlap?: number;
  useContent?: boolean;
  minScore?: number;
  keywordWeight?: number;
  entityWeight?: number;
  sentimentWeight?: number;
  showScore?: boolean;
}

export interface IntelAlertItem {
  title: string;
  source: string;
  url?: string;
  content?: string;
}

export function filterIntelAlerts(
  items: IntelAlertItem[],
  config: IntelAlertConfig,
  watchlistTitles: string[]
): string[] {
  return rankIntelAlerts(items, config, watchlistTitles).map((item) => item.text);
}

function normalizeConfig(config: IntelAlertConfig) {
  return {
    watchlistOnly: config.watchlistOnly ?? true,
    maxItems: config.maxItems ?? 10,
    includeSources: config.includeSources ?? [],
    excludeSources: config.excludeSources ?? [],
    includeKeywords: config.includeKeywords ?? [],
    excludeKeywords: config.excludeKeywords ?? [],
    minKeywordOverlap: config.minKeywordOverlap ?? 1,
    minTitleLength: config.minTitleLength ?? 8,
    minSentiment: config.minSentiment ?? null,
    maxSentiment: config.maxSentiment ?? null,
    includeEntities: config.includeEntities ?? [],
    excludeEntities: config.excludeEntities ?? [],
    minEntityOverlap: config.minEntityOverlap ?? 1,
    useContent: config.useContent ?? true,
    minScore: config.minScore ?? 0,
    keywordWeight: config.keywordWeight ?? 1,
    entityWeight: config.entityWeight ?? 1,
    sentimentWeight: config.sentimentWeight ?? 1,
    showScore: config.showScore ?? false,
  };
}

function keywordOverlap(a: string, b: string): number {
  const tokens = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 4);
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  let count = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      count += 1;
    }
  }
  return count;
}

function containsAny(text: string, keywords: string[]): boolean {
  const lowered = text.toLowerCase();
  return keywords.some((word) => lowered.includes(word.toLowerCase()));
}

function buildText(item: IntelAlertItem, useContent: boolean): string {
  if (useContent && item.content) {
    return `${item.title}\n${item.content}`;
  }
  return item.title;
}

function extractEntities(text: string): string[] {
  const words = text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const entities: string[] = [];
  for (const word of words) {
    if (word.length < 3) continue;
    if (word === word.toUpperCase()) {
      entities.push(word);
      continue;
    }
    if (word[0] === word[0].toUpperCase()) {
      entities.push(word);
    }
  }
  return Array.from(new Set(entities));
}

function overlapCount(a: string[], b: string[]): number {
  const setB = new Set(b.map((item) => item.toLowerCase()));
  let count = 0;
  for (const item of a) {
    if (setB.has(item.toLowerCase())) {
      count += 1;
    }
  }
  return count;
}

const POSITIVE = new Set([
  'beat', 'beats', 'surge', 'surges', 'rally', 'rallies', 'win', 'wins', 'strong',
  'growth', 'record', 'up', 'upgrade', 'boom', 'positive', 'bullish', 'soar',
]);
const NEGATIVE = new Set([
  'miss', 'misses', 'fall', 'falls', 'drop', 'drops', 'crash', 'crashes', 'loss',
  'weak', 'decline', 'down', 'downgrade', 'bust', 'negative', 'bearish', 'plunge',
]);

function scoreSentiment(text: string): number {
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (POSITIVE.has(token)) score += 1;
    if (NEGATIVE.has(token)) score -= 1;
  }
  if (tokens.length === 0) return 0;
  return score / Math.min(tokens.length, 50);
}

export function rankIntelAlerts(
  items: IntelAlertItem[],
  config: IntelAlertConfig,
  watchlistTitles: string[]
): Array<{ text: string; score: number }> {
  const settings = normalizeConfig(config);
  const ranked: Array<{ text: string; score: number }> = [];

  for (const intel of items) {
    const text = buildText(intel, settings.useContent);

    if (settings.minTitleLength > 0 && intel.title.length < settings.minTitleLength) {
      continue;
    }
    if (settings.includeSources.length > 0 && !settings.includeSources.includes(intel.source)) {
      continue;
    }
    if (settings.excludeSources.length > 0 && settings.excludeSources.includes(intel.source)) {
      continue;
    }
    if (settings.includeKeywords.length > 0 && !containsAny(text, settings.includeKeywords)) {
      continue;
    }
    if (settings.excludeKeywords.length > 0 && containsAny(text, settings.excludeKeywords)) {
      continue;
    }

    let keywordScore = 0;
    if (settings.watchlistOnly && watchlistTitles.length > 0) {
      const maxOverlap = Math.max(
        0,
        ...watchlistTitles.map((title) => keywordOverlap(text, title))
      );
      if (maxOverlap < settings.minKeywordOverlap) {
        continue;
      }
      keywordScore += maxOverlap;
    } else if (settings.includeKeywords.length > 0) {
      keywordScore += overlapCount(extractEntities(text), settings.includeKeywords);
    }

    let entityScore = 0;
    if (settings.includeEntities.length > 0) {
      const entities = extractEntities(text);
      const count = overlapCount(entities, settings.includeEntities);
      if (count < settings.minEntityOverlap) {
        continue;
      }
      entityScore += count;
    }
    if (settings.excludeEntities.length > 0) {
      const entities = extractEntities(text);
      const count = overlapCount(entities, settings.excludeEntities);
      if (count > 0) {
        continue;
      }
    }

    const sentiment = scoreSentiment(text);
    if (settings.minSentiment !== null && sentiment < settings.minSentiment) {
      continue;
    }
    if (settings.maxSentiment !== null && sentiment > settings.maxSentiment) {
      continue;
    }

    const score =
      keywordScore * settings.keywordWeight +
      entityScore * settings.entityWeight +
      sentiment * settings.sentimentWeight;

    if (score < settings.minScore) {
      continue;
    }

    const link = intel.url ? `\n${intel.url}` : '';
    const scoreSuffix = settings.showScore ? ` [score: ${score.toFixed(2)}]` : '';
    ranked.push({
      text: `• ${intel.title} (${intel.source})${scoreSuffix}${link}`,
      score,
    });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, settings.maxItems);
}
