import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

import type { BijazConfig } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  model: string;
}

export interface LlmClient {
  complete(messages: ChatMessage[], options?: { temperature?: number }): Promise<LlmResponse>;
}

export function createLlmClient(config: BijazConfig): LlmClient {
  switch (config.agent.provider) {
    case 'anthropic':
      return new AnthropicClient(config);
    case 'openai':
      return new OpenAiClient(config);
    case 'local':
      return new LocalClient(config);
    default:
      return new AnthropicClient(config);
  }
}

class AnthropicClient implements LlmClient {
  private client: Anthropic;
  private model: string;

  constructor(config: BijazConfig) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
    this.model = config.agent.model;
  }

  async complete(messages: ChatMessage[], options?: { temperature?: number }): Promise<LlmResponse> {
    const system = messages.find((msg) => msg.role === 'system')?.content ?? '';
    const converted = messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: options?.temperature ?? 0.2,
      system,
      messages: converted,
    });

    const text = response.content
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();

    return { content: text, model: this.model };
  }
}

class OpenAiClient implements LlmClient {
  private model: string;
  private baseUrl: string;

  constructor(config: BijazConfig) {
    this.model = config.agent.model;
    this.baseUrl = config.agent.apiBaseUrl ?? 'https://api.openai.com';
  }

  async complete(messages: ChatMessage[], options?: { temperature?: number }): Promise<LlmResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: options?.temperature ?? 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    return { content: text, model: this.model };
  }
}

class LocalClient implements LlmClient {
  private model: string;
  private baseUrl: string;

  constructor(config: BijazConfig) {
    this.model = config.agent.model;
    this.baseUrl = config.agent.apiBaseUrl ?? 'http://localhost:11434';
  }

  async complete(messages: ChatMessage[], options?: { temperature?: number }): Promise<LlmResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: options?.temperature ?? 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local model request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    return { content: text, model: this.model };
  }
}
