import type { BijazConfig } from './config.js';
import type { Market, PolymarketMarketClient } from '../execution/polymarket/markets.js';
import { listCalibrationSummaries } from '../memory/calibration.js';
import { listRecentIntel, searchIntel, type StoredIntel } from '../intel/store.js';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { isIP } from 'node:net';

export interface ToolExecutorContext {
  config: BijazConfig;
  marketClient: PolymarketMarketClient;
}

export type ToolResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolExecutorContext
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'market_search': {
        const query = String(toolInput.query ?? '');
        const limit = Math.min(Number(toolInput.limit ?? 5), 20);
        const markets = await ctx.marketClient.searchMarkets(query, limit);
        return { success: true, data: formatMarketsForTool(markets) };
      }

      case 'market_get': {
        const marketId = String(toolInput.market_id ?? '');
        const market = await ctx.marketClient.getMarket(marketId);
        return { success: true, data: formatMarketForTool(market) };
      }

      case 'intel_search': {
        const query = String(toolInput.query ?? '');
        const limit = Number(toolInput.limit ?? 5);
        const fromDays = Number(toolInput.from_days ?? 14);
        const items = searchIntel({ query, limit, fromDays });
        return { success: true, data: formatIntelForTool(items) };
      }

      case 'intel_recent': {
        const limit = Number(toolInput.limit ?? 10);
        const items = listRecentIntel(limit);
        return { success: true, data: formatIntelForTool(items) };
      }

      case 'calibration_stats': {
        const domain = toolInput.domain ? String(toolInput.domain) : undefined;
        const summaries = listCalibrationSummaries();
        const filtered = domain
          ? summaries.filter((summary) => summary.domain === domain)
          : summaries;
        return { success: true, data: filtered };
      }

      case 'twitter_search': {
        const query = String(toolInput.query ?? '').trim();
        const limit = Math.min(Math.max(Number(toolInput.limit ?? 10), 1), 50);
        if (!query) {
          return { success: false, error: 'Missing query' };
        }

        // Try Twitter API v2 first
        const twitterResult = await searchTwitterDirect(query, limit, ctx);
        if (twitterResult.success) {
          return twitterResult;
        }

        // Fallback to SerpAPI
        const serpResult = await searchTwitterViaSerpApi(query, limit);
        if (serpResult.success) {
          return serpResult;
        }

        // Both failed
        return {
          success: false,
          error: `Twitter search failed: ${twitterResult.error}. SerpAPI fallback: ${serpResult.error}`,
        };
      }

      case 'web_search': {
        const query = String(toolInput.query ?? '').trim();
        const limit = Math.min(Math.max(Number(toolInput.limit ?? 5), 1), 10);
        if (!query) {
          return { success: false, error: 'Missing query' };
        }

        const serpResult = await searchWebViaSerpApi(query, limit);
        if (serpResult.success) {
          return serpResult;
        }

        const braveResult = await searchWebViaBrave(query, limit);
        if (braveResult.success) {
          return braveResult;
        }

        return {
          success: false,
          error: `Web search failed: SerpAPI: ${serpResult.error}. Brave: ${braveResult.error}`,
        };
      }

      case 'web_fetch': {
        const url = String(toolInput.url ?? '').trim();
        const maxChars = Math.min(Math.max(Number(toolInput.max_chars ?? 10000), 100), 50000);
        if (!url) {
          return { success: false, error: 'Missing URL' };
        }
        if (!isSafeUrl(url)) {
          return { success: false, error: 'URL is not allowed' };
        }
        return fetchAndExtract(url, maxChars);
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

function normalizePrice(market: Market, outcome: 'Yes' | 'No'): number | null {
  const fromMap =
    market.prices?.[outcome] ??
    market.prices?.[outcome.toUpperCase()] ??
    undefined;
  if (typeof fromMap === 'number') {
    return fromMap;
  }
  if (Array.isArray(market.prices)) {
    const index = outcome === 'Yes' ? 0 : 1;
    const value = market.prices[index];
    return typeof value === 'number' ? value : null;
  }
  return null;
}

function formatMarketsForTool(markets: Market[]): object[] {
  return markets.map((market) => ({
    id: market.id,
    question: market.question,
    outcomes: market.outcomes,
    yes_price: normalizePrice(market, 'Yes'),
    no_price: normalizePrice(market, 'No'),
    volume: market.volume ?? null,
    category: market.category ?? null,
  }));
}

function formatMarketForTool(market: Market): object {
  return {
    id: market.id,
    question: market.question,
    outcomes: market.outcomes,
    yes_price: normalizePrice(market, 'Yes'),
    no_price: normalizePrice(market, 'No'),
    volume: market.volume ?? null,
    liquidity: market.liquidity ?? null,
    category: market.category ?? null,
    end_date: market.endDate ?? null,
    resolved: market.resolved ?? false,
  };
}

function formatIntelForTool(items: StoredIntel[]): object[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    timestamp: item.timestamp,
    url: item.url,
    summary: item.content?.slice(0, 500) ?? null,
  }));
}

/**
 * Search Twitter directly via Twitter API v2
 */
async function searchTwitterDirect(
  query: string,
  limit: number,
  ctx: ToolExecutorContext
): Promise<ToolResult> {
  const bearer =
    ctx.config.intel?.sources?.twitter?.bearerToken ?? process.env.TWITTER_BEARER;
  if (!bearer) {
    return { success: false, error: 'Twitter bearer token not configured' };
  }

  try {
    const baseUrl =
      ctx.config.intel?.sources?.twitter?.baseUrl ?? 'https://api.twitter.com/2';
    const url = new URL(`${baseUrl}/tweets/search/recent`);
    url.searchParams.set('query', `${query} -is:retweet lang:en`);
    url.searchParams.set('max_results', String(Math.max(10, limit)));
    url.searchParams.set('tweet.fields', 'created_at,author_id,public_metrics');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username,name');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${bearer}` },
    });

    if (!response.ok) {
      return { success: false, error: `Twitter API: ${response.status}` };
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        text: string;
        created_at?: string;
        author_id?: string;
        public_metrics?: {
          like_count: number;
          retweet_count: number;
          reply_count: number;
        };
      }>;
      includes?: {
        users?: Array<{ id: string; username: string; name: string }>;
      };
    };

    const users = new Map(
      (data.includes?.users ?? []).map((u) => [u.id, u])
    );

    const tweets = (data.data ?? []).map((tweet) => {
      const text = (tweet.text ?? '').replace(/\s+/g, ' ').trim();
      return {
        id: tweet.id,
        text,
        author: users.get(tweet.author_id ?? '')?.username ?? 'unknown',
        likes: tweet.public_metrics?.like_count ?? 0,
        retweets: tweet.public_metrics?.retweet_count ?? 0,
        url: `https://twitter.com/i/status/${tweet.id}`,
        timestamp: tweet.created_at ?? null,
      };
    });

    return { success: true, data: tweets };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Search Twitter via SerpAPI (fallback)
 */
async function searchTwitterViaSerpApi(
  query: string,
  limit: number
): Promise<ToolResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { success: false, error: 'SerpAPI key not configured' };
  }

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'twitter');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      return { success: false, error: `SerpAPI: ${response.status}` };
    }

    const data = (await response.json()) as {
      tweets?: Array<{
        text?: string;
        user?: { screen_name?: string };
        created_at?: string;
        likes?: number;
        retweets?: number;
        link?: string;
      }>;
    };

    const tweets = (data.tweets ?? []).slice(0, limit).map((tweet) => ({
      text: (tweet.text ?? '').replace(/\s+/g, ' ').trim(),
      author: tweet.user?.screen_name ?? 'unknown',
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      url: tweet.link ?? null,
      timestamp: tweet.created_at ?? null,
    }));

    return { success: true, data: tweets };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

async function searchWebViaSerpApi(
  query: string,
  limit: number
): Promise<ToolResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return { success: false, error: 'SerpAPI key not configured' };
  }

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('num', String(limit));
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      return { success: false, error: `SerpAPI: ${response.status}` };
    }

    const data = (await response.json()) as {
      organic_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
        source?: string;
      }>;
    };

    const results = (data.organic_results ?? []).slice(0, limit).map((item) => ({
      title: item.title ?? '',
      url: item.link ?? '',
      snippet: item.snippet ?? '',
      date: item.date ?? null,
      source: item.source ?? null,
    }));

    return { success: true, data: { query, provider: 'serpapi', results } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

async function searchWebViaBrave(
  query: string,
  limit: number
): Promise<ToolResult> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Brave API key not configured' };
  }

  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      return { success: false, error: `Brave: ${response.status}` };
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title?: string;
          url?: string;
          description?: string;
          age?: string;
        }>;
      };
    };

    const results = (data.web?.results ?? []).slice(0, limit).map((item) => ({
      title: item.title ?? '',
      url: item.url ?? '',
      snippet: item.description ?? '',
      date: item.age ?? null,
    }));

    return { success: true, data: { query, provider: 'brave', results } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return false;
  }
  if (hostname === 'metadata.google.internal') {
    return false;
  }

  const ipType = isIP(hostname);
  if (ipType === 0) {
    return true;
  }

  if (ipType === 4) {
    const parts = hostname.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return false;
    }
    const [a, b] = parts;
    if (a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && typeof b === 'number' && b >= 16 && b <= 31) return false;
    return true;
  }

  if (ipType === 6) {
    const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '');
    if (normalized === '::1') return false;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
    if (normalized.startsWith('fe80')) return false;
  }

  return true;
}

async function fetchAndExtract(url: string, maxChars: number): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bijaz/1.0; +https://github.com/bijaz)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      return { success: false, error: `Fetch failed: ${response.status}` };
    }

    const maxBytes = 2_000_000;
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      return { success: false, error: 'Response too large' };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return { success: false, error: 'Response too large' };
    }

    const body = new TextDecoder().decode(buffer);

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      const truncated = body.length > maxChars;
      return {
        success: true,
        data: {
          url,
          title: null,
          content: body.slice(0, maxChars),
          truncated,
        },
      };
    }

    const dom = new JSDOM(body, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      const text = dom.window.document.body?.textContent ?? '';
      const cleaned = text.replace(/\s+/g, ' ').trim();
      return {
        success: true,
        data: {
          url,
          title: dom.window.document.title ?? null,
          content: cleaned.slice(0, maxChars),
          truncated: cleaned.length > maxChars,
        },
      };
    }

    const content = article.textContent.replace(/\s+/g, ' ').trim();
    return {
      success: true,
      data: {
        url,
        title: article.title ?? null,
        byline: article.byline ?? null,
        content: content.slice(0, maxChars),
        truncated: content.length > maxChars,
        length: article.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
