import fetch from 'node-fetch';

import type { BijazConfig } from '../../core/config.js';

export interface Market {
  id: string;
  question: string;
  outcomes: string[];
  prices: Record<string, number>;
  volume?: number;
  liquidity?: number;
  endDate?: string;
  category?: string;
  resolved?: boolean;
  resolution?: string;
}

export class PolymarketMarketClient {
  private gammaUrl: string;

  constructor(config: BijazConfig) {
    this.gammaUrl = config.polymarket.api.gamma.replace(/\/$/, '');
  }

  async listMarkets(limit = 20): Promise<Market[]> {
    const url = new URL(`${this.gammaUrl}/markets`);
    url.searchParams.set('limit', String(limit));
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch markets: ${response.status}`);
    }
    const data = (await response.json()) as any;
    const list = Array.isArray(data) ? data : data.markets ?? [];
    return list.map((raw: any) => this.normalizeMarket(raw));
  }

  async searchMarkets(query: string, limit = 10): Promise<Market[]> {
    const url = new URL(`${this.gammaUrl}/markets`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('search', query);
    const response = await fetch(url.toString());
    if (!response.ok) {
      // Fallback: fetch all and filter client-side
      const all = await this.listMarkets(100);
      const queryLower = query.toLowerCase();
      return all
        .filter((m) => m.question.toLowerCase().includes(queryLower))
        .slice(0, limit);
    }
    const data = (await response.json()) as any;
    const list = Array.isArray(data) ? data : data.markets ?? [];
    return list.map((raw: any) => this.normalizeMarket(raw));
  }

  async getMarket(marketId: string): Promise<Market> {
    const url = new URL(`${this.gammaUrl}/markets/${marketId}`);
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch market ${marketId}: ${response.status}`);
    }
    const data = (await response.json()) as any;
    return this.normalizeMarket(data);
  }

  private normalizeMarket(raw: any): Market {
    const outcomes =
      raw.outcomes ??
      raw.outcomesArray ??
      (typeof raw.outcomes === 'string' ? JSON.parse(raw.outcomes) : []);
    const prices =
      raw.prices ??
      raw.outcomePrices ??
      (typeof raw.prices === 'string' ? JSON.parse(raw.prices) : {});

    return {
      id: String(raw.id ?? raw.marketId ?? ''),
      question: String(raw.question ?? raw.title ?? raw.marketTitle ?? ''),
      outcomes: Array.isArray(outcomes) ? outcomes : [],
      prices: prices ?? {},
      volume: raw.volume ?? raw.volume24h ?? raw.volumeUsd,
      liquidity: raw.liquidity ?? raw.liquidityUsd,
      endDate: raw.endDate ?? raw.end_date ?? raw.closeTime,
      category: raw.category ?? raw.groupSlug,
      resolved: raw.resolved ?? raw.isResolved ?? false,
      resolution: raw.resolution ?? raw.resolvedOutcome ?? raw.outcome ?? undefined,
    };
  }
}
