import { METRICS, selectEntries, formatValue, toCSV, sourceLabel } from './leaderboard.mjs';

const $ = selector => document.querySelector(selector);
const root = new URL(document.body.dataset.root, window.location.href);
let toastTimer;

function notify(message) {
  const toast = $('.toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

const menuButton = $('.mobile-menu');
function closeMenu() {
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton?.setAttribute('aria-label', 'Open navigation');
  $('.site-header')?.classList.remove('menu-open');
}
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  $('.site-header').classList.toggle('menu-open', open);
});
$('#primary-nav')?.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    menuButton.click();
    menuButton.focus();
  }
});

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const element = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(element.textContent);
      notify('Copied to clipboard');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      notify('Text selected. Use your keyboard to copy.');
    }
  });
});

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function brandImage(slug, className) {
  if (!slug || !/^[a-z]+$/.test(slug)) return null;
  const image = el('img', className);
  image.src = new URL(`assets/brands/${slug}.svg`, root).href;
  image.alt = '';
  image.width = 20;
  image.height = 20;
  return image;
}

function downloadCSV(entries) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', toCSV(entries)], { type: 'text/csv;charset=utf-8' }));
  const anchor = el('a');
  anchor.href = url;
  anchor.download = 'vex-bench-results.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showConfiguration(entry) {
  let dialog = $('#configuration-dialog');
  if (!dialog) {
    dialog = el('dialog', 'configuration-dialog');
    dialog.id = 'configuration-dialog';
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      // The dialog itself is the padded card, so only clicks outside its rect close it.
      if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
      }
    });
  }
  dialog.replaceChildren();
  dialog.setAttribute('aria-labelledby', 'configuration-title');
  const close = el('button', 'dialog-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close configuration');
  close.addEventListener('click', () => dialog.close());
  const eyebrow = el('div', 'eyebrow', 'EVALUATION CONFIGURATION');
  const title = el('h2', '', entry.model.name);
  title.id = 'configuration-title';
  const description = el('p', 'dialog-subtitle', entry.harness.name);
  const details = el('dl', 'configuration-details');
  const fields = [
    ['Dataset', `VEX-Bench ${entry.dataset_version}`],
    ['Submitter', sourceLabel(entry)],
    ['Submission date', entry.submission_date ?? 'Not recorded'],
    ['Model developer', entry.model.provider ?? 'Not recorded'],
    ['Model access', entry.access_provider ?? 'Not recorded'],
    ['Harness version', entry.harness.version ?? 'Not recorded in source experiment'],
    ['Protocol', entry.protocol ?? 'Not recorded'],
    ['Runs', entry.run_ids.map(id => id.replace(/^run_/, '')).join(', ')],
    ['Per-task limit', entry.settings.timeout_seconds == null ? 'Not recorded' : `${entry.settings.timeout_seconds / 60} minutes`],
    ['Prompt fingerprint', entry.settings.prompt_hash ?? 'Not recorded'],
    ['Answer completion', `${formatValue(entry.metrics.completion_rate?.mean, 'score')}%`],
  ];
  if (entry.source.kind !== 'paper') fields.push(['Trajectory record', entry.harness.id === 'cursor' ? 'Final output only; full interaction trace unavailable' : 'Original logs retained with the submission']);
  for (const [label, value] of fields) details.append(el('dt', '', label), el('dd', '', value));
  const note = el('p', 'small-note', entry.cost_basis ?? 'Cost estimates are unavailable. Token usage is shown where recorded.');
  const source = el('p', 'small-note', entry.source.kind === 'paper' ? 'Imported from the paper’s recorded evaluation outputs.' : `Computed from ${sourceLabel(entry)} outputs using the existing VEX-Bench evaluator. Protocol equivalence with the paper runs has not been established.`);
  const scores = el('section', 'configuration-scores');
  scores.append(el('h3', '', 'All metrics'));
  const scoreList = el('dl', 'configuration-details');
  for (const metric of METRICS) {
    const values = entry.metrics[metric.key];
    const unit = metric.format === 'score' ? '%' : '';
    const mean = values?.mean == null ? '—' : `${formatValue(values.mean, metric.format)}${unit}`;
    const variation = values?.mean != null && values?.std != null ? ` ± ${formatValue(values.std, metric.format, true)}${unit}` : '';
    scoreList.append(el('dt', '', metric.name), el('dd', '', mean + variation));
  }
  scores.append(scoreList);
  dialog.append(close, eyebrow, title, description, scores, details, note, source);
  dialog.showModal();
}

async function initLeaderboard() {
  const form = $('#filters');
  if (!form) return;
  form.addEventListener('submit', event => event.preventDefault());
  // The build embeds the generated summary so restoring a filtered URL doesn't
  // briefly show the default rows while waiting for another network request.
  const embedded = $('#leaderboard-data');
  const data = embedded ? JSON.parse(embedded.textContent) : await (async () => {
    const response = await fetch(new URL('data/leaderboard.json', root));
    if (!response.ok) throw new Error(`Result data returned HTTP ${response.status}`);
    return response.json();
  })();
  const params = new URLSearchParams(location.search);
  const defaultMetric = $('#leaderboard-table').dataset.defaultMetric;
  const defaults = { version: $('#dataset-version').value, harness: '', submitter: '', query: '', metric: defaultMetric, direction: METRICS.find(m => m.key === defaultMetric).direction, showStd: false };
  const state = { ...defaults };
  if (data.benchmarks.some(b => b.version === params.get('version'))) state.version = params.get('version');
  if (data.entries.some(e => e.harness.id === params.get('harness'))) state.harness = params.get('harness');
  else if (params.get('harness')) {
    state.harness = data.entries.find(e => e.harness.source_id === params.get('harness'))?.harness.id ?? '';
  }
  if (data.entries.some(e => e.submitter.id === params.get('submitter'))) state.submitter = params.get('submitter');
  // Preserve links to the two original submission groups.
  if (!state.submitter && params.get('source') === 'paper') state.submitter = 'original-paper';
  if (!state.submitter && params.get('source') === 'external') {
    const external = [...new Set(data.entries.filter(e => e.source.kind !== 'paper').map(e => e.submitter.id))];
    if (external.length === 1) state.submitter = external[0];
  }
  if (METRICS.some(m => m.key === params.get('metric'))) {
    state.metric = params.get('metric');
    state.direction = METRICS.find(m => m.key === state.metric).direction;
  }
  if (['asc', 'desc'].includes(params.get('direction'))) state.direction = params.get('direction');
  state.query = params.get('q') || '';
  state.showStd = params.get('sd') === '1';
  $('#dataset-version').value = state.version;
  $('#harness-filter').value = state.harness;
  $('#submitter-filter').value = state.submitter;
  $('#model-search').value = state.query;
  $('#show-std').checked = state.showStd;
  const arrowPrototype = $('.model-button .icon')?.cloneNode(true);
  let visible = [];

  function syncURL() {
    const query = new URLSearchParams();
    if (state.version !== defaults.version) query.set('version', state.version);
    if (state.harness) query.set('harness', state.harness);
    if (state.submitter) query.set('submitter', state.submitter);
    if (state.query) query.set('q', state.query);
    if (state.metric !== defaults.metric) query.set('metric', state.metric);
    const naturalDirection = METRICS.find(m => m.key === state.metric).direction;
    if (state.direction !== naturalDirection) query.set('direction', state.direction);
    if (state.showStd) query.set('sd', '1');
    const url = `${location.pathname}${query.size ? `?${query}` : ''}${location.hash}`;
    history.replaceState(null, '', url);
  }

  function render() {
    visible = selectEntries(data.entries, state);
    const fragment = document.createDocumentFragment();
    visible.forEach((entry, index) => {
      const row = el('tr');
      row.dataset.id = entry.id;
      row.append(el('td', 'rank-cell', String(index + 1).padStart(2, '0')));
      const modelCell = el('th', 'model-cell');
      modelCell.scope = 'row';
      const modelButton = el('button', 'model-button');
      modelButton.type = 'button';
      modelButton.dataset.entry = entry.id;
      modelButton.setAttribute('aria-label', `View configuration for ${entry.model.name} (${sourceLabel(entry)})`);
      modelButton.append(el('span', '', entry.model.name));
      if (arrowPrototype) modelButton.append(arrowPrototype.cloneNode(true));
      const identity = el('div', 'model-identity');
      const modelLogo = brandImage(entry.model.icon, 'model-brand-icon');
      if (modelLogo) identity.append(modelLogo);
      const modelText = el('div');
      const secondary = el('span', 'model-secondary');
      secondary.append(el('span', '', `By ${sourceLabel(entry)}`), el('span', '', `Submitted ${entry.submission_date ?? '—'}`));
      modelText.append(modelButton);
      if (entry.access_provider) modelText.append(el('span', 'model-access', `via ${entry.access_provider}`));
      modelText.append(secondary);
      const mobileHarness = el('span', 'mobile-harness');
      const mobileHarnessLogo = brandImage(entry.harness.icon, 'harness-brand-icon');
      if (mobileHarnessLogo) mobileHarness.append(mobileHarnessLogo);
      mobileHarness.append(el('span', '', entry.harness.name));
      modelText.append(mobileHarness);
      identity.append(modelText);
      modelCell.append(identity);
      row.append(modelCell);
      const harnessCell = el('td', 'harness-cell');
      const harnessIdentity = el('span', 'harness-identity');
      const harnessLogo = brandImage(entry.harness.icon, 'harness-brand-icon');
      if (harnessLogo) harnessIdentity.append(harnessLogo);
      harnessIdentity.append(el('span', '', entry.harness.name));
      harnessCell.append(harnessIdentity);
      row.append(harnessCell);
      const submissionCell = el('td', 'submission-cell');
      submissionCell.append(el('span', 'submitter-name', sourceLabel(entry)));
      const submissionDate = el('span', 'submission-date');
      if (entry.submission_date) {
        const date = el('time', '', entry.submission_date);
        date.dateTime = entry.submission_date;
        submissionDate.append(date);
      } else {
        submissionDate.textContent = '—';
        submissionDate.title = 'Submission date not recorded';
      }
      submissionCell.append(submissionDate);
      row.append(submissionCell);
      METRICS.forEach(metric => {
        const values = entry.metrics[metric.key];
        const selected = state.metric === metric.key;
        const groupStart = ['status_accuracy', 'justification_accuracy', 'tokens_per_case'].includes(metric.key);
        const cell = el('td', `metric-cell${selected ? ' sorted-cell' : ''}${groupStart ? ' group-start' : ''}`);
        cell.append(el('span', 'metric-value', formatValue(values?.mean, metric.format)));
        if (state.showStd) cell.append(el('span', 'metric-std', `± ${formatValue(values?.std, metric.format, true)}`));
        if (selected && metric.format === 'score' && values?.mean != null) {
          const bar = el('span', 'cell-score-bar');
          bar.style.width = `${Math.max(0, Math.min(100, values.mean * 100))}%`;
          bar.setAttribute('aria-hidden', 'true');
          cell.append(bar);
        }
        row.append(cell);
      });
      fragment.append(row);
    });
    $('#results-body').replaceChildren(fragment);
    document.querySelectorAll('[data-metric]').forEach(header => {
      const selected = header.dataset.metric === state.metric;
      header.setAttribute('aria-sort', selected ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      header.classList.toggle('active-sort', selected);
      header.querySelector('.sort-arrow').textContent = selected ? (state.direction === 'asc' ? '↑' : '↓') : '↕';
    });
    $('#mobile-metric').value = state.metric;
    const directionButton = $('#mobile-sort-direction');
    directionButton.textContent = state.direction === 'desc' ? '↓' : '↑';
    const directionLabel = state.direction === 'desc' ? 'Sort ascending' : 'Sort descending';
    directionButton.setAttribute('aria-label', directionLabel);
    directionButton.title = directionLabel;
    $('#empty-state').hidden = visible.length > 0;
    const total = data.entries.filter(e => e.dataset_version === state.version).length;
    document.querySelectorAll('[data-dataset-download]').forEach(link => {
      link.href = new URL(`data/tasks-${encodeURIComponent(state.version)}.jsonl`, root).href;
    });
    $('#results-count').textContent = `Showing ${visible.length} of ${total} configurations`;
    $('#total-configurations').textContent = `${total} configurations`;
    const runCounts = [...new Set(visible.map(e => e.run_ids.length))];
    $('#runs-note').textContent = runCounts.length === 1 ? `${runCounts[0]} runs per configuration` : 'Independent evaluation runs';
    $('#export-csv').disabled = visible.length === 0;
    syncURL();
    $('#leaderboard-table').dataset.initialized = 'true';
  }

  $('#model-search').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('#harness-filter').addEventListener('change', event => { state.harness = event.target.value; render(); });
  $('#submitter-filter').addEventListener('change', event => { state.submitter = event.target.value; render(); });
  $('#dataset-version').addEventListener('change', event => { state.version = event.target.value; render(); });
  $('#show-std').addEventListener('change', event => { state.showStd = event.target.checked; render(); });
  $('#mobile-metric').addEventListener('change', event => {
    state.metric = event.target.value;
    state.direction = METRICS.find(metric => metric.key === state.metric).direction;
    render();
  });
  $('#mobile-sort-direction').addEventListener('click', () => {
    state.direction = state.direction === 'desc' ? 'asc' : 'desc';
    render();
  });
  document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
    const metric = METRICS.find(m => m.key === button.dataset.sort);
    state.direction = state.metric === metric.key ? (state.direction === 'desc' ? 'asc' : 'desc') : metric.direction;
    state.metric = metric.key;
    render();
  }));
  $('#results-body').addEventListener('click', event => {
    const button = event.target.closest('[data-entry]');
    if (button) showConfiguration(data.entries.find(entry => entry.id === button.dataset.entry));
  });
  $('#clear-filters').addEventListener('click', () => {
    state.query = ''; state.harness = ''; state.submitter = '';
    $('#model-search').value = ''; $('#harness-filter').value = ''; $('#submitter-filter').value = '';
    render();
    $('#model-search').focus();
  });
  $('#export-csv').addEventListener('click', () => downloadCSV(visible));
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, select, [contenteditable="true"]') && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      $('#model-search').focus();
    }
  });
  render();
  $('.mobile-ranking').hidden = false;
}

initLeaderboard().catch(error => {
  console.error('Leaderboard enhancement failed:', error);
  if ($('#results-error')) $('#results-error').hidden = false;
});
