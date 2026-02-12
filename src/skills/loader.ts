/**
 * Skill Loader
 *
 * Minimal plugin system inspired by OpenClaw skills:
 * - A "skill" is a directory containing `skill.json` and an ESM entry module.
 * - The entry module exports `register(registry)` which can add tools.
 *
 * This is intentionally conservative: no auto-install from network here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AgentToolRegistry } from '../agent/tools/registry.js';

export interface SkillManifest {
  name: string;
  description?: string;
  version?: string;
  entry: string; // relative path within the skill folder
  enabled?: boolean;
}

export function discoverSkillDirs(paths: string[]): string[] {
  const out: string[] = [];
  for (const root of paths) {
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        out.push(join(root, ent.name));
      }
    } catch {
      continue;
    }
  }
  return out;
}

export function readSkillManifest(skillDir: string): SkillManifest | null {
  try {
    const raw = readFileSync(join(skillDir, 'skill.json'), 'utf8');
    const parsed = JSON.parse(raw) as SkillManifest;
    if (!parsed?.name || !parsed.entry) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadSkillsIntoRegistry(params: {
  registry: AgentToolRegistry;
  roots: string[];
}): Promise<{ loaded: string[]; skipped: string[] }> {
  const loaded: string[] = [];
  const skipped: string[] = [];

  const dirs = discoverSkillDirs(params.roots);
  for (const dir of dirs) {
    const manifest = readSkillManifest(dir);
    if (!manifest) {
      skipped.push(dir);
      continue;
    }
    if (manifest.enabled === false) {
      skipped.push(manifest.name);
      continue;
    }
    const entry = resolve(dir, manifest.entry);
    try {
      const mod = (await import(pathToFileURL(entry).href)) as {
        register?: (registry: AgentToolRegistry) => void | Promise<void>;
      };
      if (typeof mod.register !== 'function') {
        skipped.push(manifest.name);
        continue;
      }
      await mod.register(params.registry);
      loaded.push(manifest.name);
    } catch {
      skipped.push(manifest.name);
      continue;
    }
  }

  return { loaded, skipped };
}
