export const METRICS = [
  { key: 'status_accuracy', name: 'Status accuracy', label: 'Accuracy', group: 'status', direction: 'desc', format: 'score', description: 'Correct affected / not-affected predictions.' },
  { key: 'status_precision', name: 'Status precision', label: 'Precision', group: 'status', direction: 'desc', format: 'score', description: 'Precision for the affected class.' },
  { key: 'status_recall', name: 'Status recall', label: 'Recall', group: 'status', direction: 'desc', format: 'score', description: 'Recall for the affected class.' },
  { key: 'status_f1', name: 'Status F1', label: 'F1', group: 'status', direction: 'desc', format: 'score', description: 'F1 for the affected class. Higher is better.' },
  { key: 'justification_accuracy', name: 'Justification accuracy', label: 'Accuracy', group: 'justification', direction: 'desc', format: 'score', description: 'Correct fine-grained justification labels.' },
  { key: 'justification_macro_f1', name: 'Justification macro-F1', label: 'Macro-F1', group: 'justification', direction: 'desc', format: 'score', description: 'F1 averaged equally across ground-truth classes.' },
  { key: 'justification_weighted_f1', name: 'Justification weighted-F1', label: 'Weighted-F1', group: 'justification', direction: 'desc', format: 'score', description: 'F1 weighted by ground-truth class support.' },
  { key: 'tokens_per_case', name: 'Tokens per case', label: 'Tokens', group: 'resources', direction: 'asc', format: 'tokens', description: 'Mean recorded tokens per case. Lower is better.' },
  { key: 'cost_per_case', name: 'Cost per case', label: 'Cost', group: 'resources', direction: 'asc', format: 'cost', description: 'Mean recorded cost estimate in USD per case. Lower is better.' },
];

export function sourceLabel(entry) {
  return entry.submitter?.name || (entry.source?.kind === 'paper' ? 'Original paper' : entry.source?.organization || 'External');
}

export function selectEntries(entries, state) {
  const query = (state.query || '').trim().toLowerCase();
  return entries.filter(entry =>
    (!state.version || entry.dataset_version === state.version) &&
    (!state.harness || entry.harness.id === state.harness) &&
    (!state.source || entry.source?.kind === state.source) &&
    (!state.submitter || entry.submitter?.id === state.submitter) &&
    (!query || `${entry.model.name} ${entry.model.provider} ${entry.harness.name} ${entry.access_provider || ''} ${sourceLabel(entry)} ${entry.settings?.prompt_hash || ''}`.toLowerCase().includes(query))
  ).sort((a, b) => {
    const av = a.metrics[state.metric]?.mean;
    const bv = b.metrics[state.metric]?.mean;
    if (av == null && bv == null) return a.id.localeCompare(b.id);
    if (av == null) return 1;
    if (bv == null) return -1;
    const result = state.direction === 'asc' ? av - bv : bv - av;
    return result || a.model.name.localeCompare(b.model.name) || a.id.localeCompare(b.id);
  });
}

export function formatValue(value, format, isStd = false) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (format === 'cost') return `${isStd ? '' : '$'}${value.toFixed(3)}`;
  if (format === 'tokens') return `${(value / 1000).toFixed(1)}k`;
  return (value * 100).toFixed(1);
}

export function toCSV(entries) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const header = ['submission_id', 'dataset_version', 'model', 'harness', 'submission_date', 'runs', 'submitter', 'prompt_hash', 'protocol', 'access_provider', ...METRICS.flatMap(m => [m.key, `${m.key}_std`])];
  return [header, ...entries.map(e => [e.id, e.dataset_version, e.model.name, e.harness.name, e.submission_date, e.run_ids.length,
    sourceLabel(e), e.settings?.prompt_hash, e.protocol, e.access_provider,
    ...METRICS.flatMap(m => [e.metrics[m.key]?.mean, e.metrics[m.key]?.std])])].map(row => row.map(quote).join(',')).join('\r\n');
}
