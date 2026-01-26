import { listRecentIntel } from '../intel/store.js';
import { listUnresolvedPredictions } from '../memory/predictions.js';
import { listCalibrationSummaries } from '../memory/calibration.js';

export function buildBriefing(limit = 10): string {
  const intel = listRecentIntel(limit);
  const unresolved = listUnresolvedPredictions(10);
  const calibration = listCalibrationSummaries();

  const lines: string[] = [];
  lines.push('Daily Briefing');
  lines.push('─'.repeat(40));
  lines.push(`Open predictions: ${unresolved.length}`);

  if (calibration.length > 0) {
    lines.push('Calibration:');
    for (const summary of calibration.slice(0, 5)) {
      const acc =
        summary.accuracy === null ? '-' : `${(summary.accuracy * 100).toFixed(1)}%`;
      const brier =
        summary.avgBrier === null ? '-' : summary.avgBrier.toFixed(4);
      lines.push(
        `- ${summary.domain}: acc=${acc}, brier=${brier}, resolved=${summary.resolvedPredictions}`
      );
    }
  }

  if (intel.length === 0) {
    lines.push('No intel yet. Run /intel to fetch RSS.');
    return lines.join('\n');
  }

  lines.push('Intel:');
  for (const item of intel) {
    lines.push(`- ${item.title} (${item.source})`);
  }

  return lines.join('\n');
}
