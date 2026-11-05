const byId = id => document.getElementById(id);
const value = id => byId(id).value;
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};
const empty = () => ({
  id: null, name: '', method: 'GET', url: '', query: [], headers: [],
  bodyType: 'none', bodyText: '', form: [], authType: 'none', authUser: '', authSecret: '',
});
const starter = { ...empty(), id: 'example', name: 'Echo request', url: 'https://httpbin.org/anything', query: [['hello', 'world']] };
function readList(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    return Array.isArray(stored) ? stored : fallback;
  } catch { return fallback; }
}
const saveKey = 'mini-insomnia.requests.v1';
const historyKey = 'mini-insomnia.history.v1';
const historyDetailKey = 'mini-insomnia.history-details.v1';
let saved = readList(saveKey, [starter]);
let history = readList(historyKey, []);
const historyDetails = new WeakMap();
let tabDetails = {};
try {
  tabDetails = JSON.parse(sessionStorage.getItem(historyDetailKey)) || {};
  byId('keep-history-details').checked = sessionStorage.getItem(historyDetailKey) !== null;
} catch { /* Storage may be unavailable. */ }
byId('keep-history-details').onchange = event => {
  try {
    if (event.target.checked) sessionStorage.setItem(historyDetailKey, JSON.stringify(tabDetails));
    else {
      sessionStorage.removeItem(historyDetailKey);
      tabDetails = {};
    }
  } catch {
    event.target.checked = !event.target.checked;
    notice('Could not change history storage in this tab.');
  }
};
let selectedHistory = null;
let currentId;
let side = 'saved';
let responseTab = 'preview';
let hasResponse = false;

function addRow(group, [key, val] = ['', '']) {
  const row = element('div', '', 'row');
  for (const [index, content] of [key, val].entries()) {
    const input = element('input', '');
    input.placeholder = index ? 'Value' : 'Key';
    input.setAttribute('aria-label', `${group} ${input.placeholder}`);
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (group === 'env' && index === 1) input.type = 'password';
    input.value = content;
    row.append(input);
  }
  const remove = element('button', '×');
  remove.setAttribute('aria-label', 'Remove row');
  remove.onclick = () => row.remove();
  row.append(remove);
  byId(`${group}-rows`).append(row);
}

const rows = group => [...byId(`${group}-rows`).children]
  .map(row => [...row.querySelectorAll('input')].map(input => input.value))
  .filter(([key, val]) => key || val);

function toggleFields() {
  const type = value('body-type');
  byId('body-text').hidden = !['json', 'raw'].includes(type);
  byId('form-fields').hidden = !['form', 'multipart'].includes(type);
  byId('auth-user-label').hidden = value('auth-type') !== 'basic';
  byId('auth-secret-label').hidden = value('auth-type') === 'none';
  byId('auth-secret-title').textContent = value('auth-type') === 'basic' ? 'Password' : 'Token';
}
function load(request) {
  selectedHistory = null;
  currentId = request.id;
  for (const [key, id] of Object.entries({
    name: 'name', method: 'method', url: 'url', bodyType: 'body-type',
    bodyText: 'body-text', authType: 'auth-type', authUser: 'auth-user', authSecret: 'auth-secret',
  })) byId(id).value = request[key];
  for (const group of ['query', 'headers', 'form']) {
    byId(`${group}-rows`).replaceChildren();
    for (const pair of request[group]) addRow(group, pair);
  }
  toggleFields();
  renderSide();
  notice('');
}
function snapshot() {
  return {
    id: currentId, name: value('name').trim(), method: value('method'), url: value('url').trim(),
    query: rows('query'), headers: rows('headers'), form: rows('form'),
    bodyType: value('body-type'), bodyText: value('body-text'),
    authType: value('auth-type'), authUser: value('auth-user'), authSecret: value('auth-secret'),
  };
}
function renderSide() {
  byId('history-option').hidden = side !== 'history';
  byId('side-title').textContent = side === 'saved' ? 'REQUESTS' : 'RECENT ACTIVITY';
  const list = byId('side-list');
  list.replaceChildren();
  if (side === 'history') {
    for (const record of history) {
      const entry = element('button', `${record.method} · ${record.result} · ${new Date(record.time).toLocaleString()}`, 'history-entry');
      entry.setAttribute('aria-pressed', String(selectedHistory === record));
      entry.onclick = () => {
        const detail = historyDetails.get(record) || (record.id && tabDetails[record.id]);
        load(detail ? { ...detail, id: null } : {
          ...empty(), method: record.method, name: 'History entry',
        });
        showResponse(null);
        selectedHistory = record;
        const tab = detail?.bodyType && detail.bodyType !== 'none' ? 'body' : 'query';
        document.querySelector(`[data-editor="${tab}"]`).click();
        const summary = `${record.method} · ${record.result} · ${new Date(record.time).toLocaleString()}`;
        notice(detail ? summary : `${summary}. This entry contains a summary only. Enable “Keep request details after refresh” before sending to retain future details in this tab.`);
        renderSide();
        list.children[history.indexOf(record)]?.focus();
      };
      list.append(entry);
    }
    if (!history.length) list.append(element('p', 'No requests sent yet.', 'side-note'));
    return;
  }
  for (const request of saved) {
    const row = element('div', '', `side-item${request.id === currentId ? ' selected' : ''}`);
    const open = element('button', '', 'open');
    open.append(element('span', request.method, `verb${request.method === 'GET' ? '' : ' write'}`), request.name);
    open.onclick = () => load(request);
    const remove = element('button', '×');
    remove.setAttribute('aria-label', `Delete ${request.name}`);
    remove.onclick = () => {
      const next = saved.filter(item => item.id !== request.id);
      try { localStorage.setItem(saveKey, JSON.stringify(next)); }
      catch { notice('Browser storage is unavailable.'); return; }
      saved = next;
      if (currentId === request.id) currentId = null;
      renderSide();
    };
    row.append(open, remove);
    list.append(row);
  }
  if (!saved.length) list.append(element('p', 'No saved requests.', 'side-note'));
}
const notice = text => { byId('notice').textContent = text; };

function prepare(request) {
  const variables = new Map(rows('env'));
  const expand = text => text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    if (!variables.has(key)) throw new Error(`Missing environment variable: ${key}`);
    return variables.get(key);
  });
  let url;
  const expandedUrl = expand(request.url);
  try { url = new URL(expandedUrl); }
  catch { throw new Error('Enter a valid absolute URL.'); }
  const expandPairs = pairs => pairs.map(([key, val]) => [expand(key), expand(val)]);
  for (const [key, val] of expandPairs(request.query)) url.searchParams.append(key, val);
  let headers = expandPairs(request.headers);
  let body = null;
  const type = request.bodyType;
  let contentType;
  if (type === 'json' || type === 'raw') {
    body = expand(request.bodyText);
    if (type === 'json') {
      try { JSON.parse(body); }
      catch { throw new Error('Request body contains invalid JSON.'); }
    }
    contentType = type === 'json' ? 'application/json' : 'text/plain; charset=utf-8';
  }
  if (type === 'form') {
    body = new URLSearchParams(expandPairs(request.form)).toString();
    contentType = 'application/x-www-form-urlencoded';
  }
  if (type === 'multipart') {
    const boundary = `mini-insomnia-${crypto.randomUUID()}`;
    body = expandPairs(request.form).map(([key, val]) => {
      const escaped = key.replace(/[\r\n"]/g, char => encodeURIComponent(char));
      return `--${boundary}\r\nContent-Disposition: form-data; name="${escaped}"\r\n\r\n${val}\r\n`;
    }).join('') + `--${boundary}--\r\n`;
    contentType = `multipart/form-data; boundary=${boundary}`;
    headers = headers.filter(([key]) => key.toLowerCase() !== 'content-type');
  }
  if (contentType && !headers.some(([key]) => key.toLowerCase() === 'content-type')) headers.push(['Content-Type', contentType]);
  if (request.authType !== 'none') {
    const secret = expand(request.authSecret);
    if (!secret) throw new Error('Enter an authentication token or password.');
    const credentials = new TextEncoder().encode(`${expand(request.authUser)}:${secret}`);
    const authorization = request.authType === 'bearer'
      ? `Bearer ${secret}`
      : `Basic ${btoa(Array.from(credentials, byte => String.fromCharCode(byte)).join(''))}`;
    headers = headers.filter(([key]) => key.toLowerCase() !== 'authorization');
    headers.push(['Authorization', authorization]);
  }
  return { url: url.href, method: request.method, headers, body };
}

function highlightJson(node, text) {
  const tokens = /"(?:[^"\\]|\\.)*"(\s*:)?|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|\b(?:true|false|null)\b/gi;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    const [token, keySuffix] = match;
    node.append(text.slice(cursor, match.index));
    const kind = token.startsWith('"') ? (keySuffix ? 'key' : 'string')
      : /^-?\d/.test(token) ? 'number' : 'literal';
    node.append(element('span', keySuffix ? token.slice(0, -keySuffix.length) : token, `json-${kind}`));
    if (keySuffix) node.append(keySuffix);
    cursor = match.index + token.length;
  }
  node.append(text.slice(cursor));
}

function showResponse(data) {
  hasResponse = Boolean(data);
  byId('empty').hidden = hasResponse;
  byId('preview').hidden = !hasResponse || responseTab !== 'preview';
  byId('response-headers').hidden = !hasResponse || responseTab !== 'response-headers';
  const metrics = byId('metrics');
  metrics.replaceChildren();
  byId('response-headers').replaceChildren();
  byId('preview').textContent = '';
  if (!data) return;
  metrics.append(element('span', `${data.status} ${data.statusText}`, data.status >= 400 ? 'badge error' : 'badge'),
    element('span', `${data.ms} ms`), element('span', `${data.bytes} B`));
  let body = data.body;
  let isJson = false;
  if (data.binary) body = `Base64 response\n\n${body}`;
  else {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
      isJson = true;
    }
    catch { /* Preserve plain text. */ }
  }
  const preview = byId('preview');
  if (isJson && body.length <= 100000) highlightJson(preview, body);
  else preview.textContent = body || 'Empty response body';
  const headers = byId('response-headers');
  if (!data.headers.length) {
    headers.append(element('p', 'No response headers.'));
    return;
  }
  const table = element('table', '', 'response-table');
  table.setAttribute('aria-label', 'Response headers');
  const heading = table.createTHead().insertRow();
  for (const title of ['Header name', 'Value']) {
    const cell = element('th', title);
    cell.scope = 'col';
    heading.append(cell);
  }
  const rows = table.createTBody();
  for (const [key, val] of data.headers) {
    const name = element('th', key);
    name.scope = 'row';
    rows.insertRow().append(name, element('td', val));
  }
  headers.append(table);
}

byId('request-form').onsubmit = async event => {
  event.preventDefault();
  const draft = snapshot();
  let payload;
  notice('');
  selectedHistory = null;
  showResponse(null);
  try { payload = prepare(draft); }
  catch (error) { notice(error.message); return; }
  const send = byId('send');
  send.disabled = true;
  send.textContent = 'Sending…';
  let result = 'Failed';
  try {
    const response = await fetch('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) { notice(data.error || 'Local proxy error.'); return; }
    showResponse(data);
    result = String(data.status);
  } catch { notice('Could not reach the local proxy.'); }
  finally {
    send.disabled = false;
    send.textContent = 'Send ↗';
    const record = { id: crypto.randomUUID(), method: draft.method, result, time: Date.now() };
    historyDetails.set(record, draft);
    history = [record, ...history].slice(0, 50);
    if (byId('keep-history-details').checked) {
      tabDetails[record.id] = draft;
      const retainedIds = new Set(history.map(entry => entry.id));
      for (const id of Object.keys(tabDetails)) {
        if (!retainedIds.has(id)) delete tabDetails[id];
      }
      try { sessionStorage.setItem(historyDetailKey, JSON.stringify(tabDetails)); }
      catch { notice('Could not retain request details after refresh. They are available on this page.'); }
    }
    try { localStorage.setItem(historyKey, JSON.stringify(history)); }
    catch { /* Keep history in memory if storage is unavailable. */ }
    renderSide();
  }
};

byId('save').onclick = () => byId('save-dialog').showModal();
byId('save-confirm').onclick = () => {
  const draft = snapshot();
  const variableOnly = /^\{\{\s*[\w.-]+\s*\}\}$/;
  const sensitive = /authorization|cookie|token|secret|api.?key|credential|password/i;
  const clean = {
    ...draft, id: draft.id || crypto.randomUUID(), name: draft.name || 'Untitled request',
    authUser: variableOnly.test(draft.authUser) ? draft.authUser : '',
    authSecret: variableOnly.test(draft.authSecret) ? draft.authSecret : '',
    headers: draft.headers.filter(([key, val]) => (!sensitive.test(key) && !key.includes('{{')) || variableOnly.test(val)),
    bodyText: ['raw', 'json'].includes(draft.bodyType) ? draft.bodyText : '',
    form: ['form', 'multipart'].includes(draft.bodyType) ? draft.form : [],
  };
  const next = saved.some(item => item.id === clean.id)
    ? saved.map(item => item.id === clean.id ? clean : item)
    : [...saved, clean];
  try { localStorage.setItem(saveKey, JSON.stringify(next)); }
  catch { byId('save-dialog').close(); notice('Browser storage is unavailable.'); return; }
  saved = next;
  currentId = clean.id;
  byId('name').value = clean.name;
  byId('save-dialog').close();
  document.querySelector('[data-side="saved"]').click();
  notice('Request template saved.');
};

for (const button of document.querySelectorAll('[data-add]')) button.onclick = () => addRow(button.dataset.add);
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => byId(button.dataset.close).close();
for (const group of ['side', 'editor', 'response']) {
  const buttons = document.querySelectorAll(`[data-${group}]`);
  for (const button of buttons) button.onclick = () => {
    for (const item of buttons) item.classList.toggle('active', item === button);
    const tab = button.dataset[group];
    if (group === 'side') { side = tab; renderSide(); }
    if (group === 'editor') for (const item of buttons) byId(item.dataset.editor).hidden = item !== button;
    if (group === 'response') {
      responseTab = tab;
      for (const item of buttons) byId(item.dataset.response).hidden = !hasResponse || item !== button;
    }
  };
}
byId('body-type').onchange = toggleFields;
byId('auth-type').onchange = toggleFields;
byId('new').onclick = () => { load(empty()); byId('url').focus(); };
byId('env-open').onclick = () => byId('env-dialog').showModal();
byId('import-open').onclick = () => {
  byId('curl').value = '';
  byId('import-error').textContent = '';
  byId('import-dialog').showModal();
};
function tokenize(command) {
  const tokens = [];
  let token = '';
  let quote = '';
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\' && quote !== "'") {
      const next = command[++i];
      if (next === undefined) throw new Error('Incomplete escape.');
      if (next === '\r' && command[i + 1] === '\n') { i++; continue; }
      if (next === '\n') continue;
      token += quote === '"' && !'"\\$`'.includes(next) ? '\\' + next : next;
      started = true;
    } else if (quote) {
      if (char === quote) quote = '';
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token);
      token = '';
      started = false;
    } else {
      if (/[;&|<>`]/.test(char)) throw new Error('Quote shell metacharacters inside arguments.');
      token += char;
      started = true;
    }
  }
  if (quote) throw new Error('Unclosed quote.');
  if (started) tokens.push(token);
  return tokens;
}

function parseCurl(command) {
  const tokens = tokenize(command.trim());
  if (!/^curl(?:\.exe)?$/i.test(tokens.shift() || '')) throw new Error('Start the command with curl.');
  const draft = { ...empty(), name: 'Imported request' };
  let explicit = '';
  let head = false;
  let get = false;
  const data = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const [flag] = token.split('=');
    const argument = () => {
      const arg = flag.startsWith('--') && token.includes('=') ? token.slice(flag.length + 1) : tokens[++i];
      if (arg === undefined) throw new Error('Missing cURL option value.');
      return arg;
    };
    const setUrl = url => {
      if (draft.url) throw new Error('Import one URL at a time.');
      draft.url = url;
    };
    switch (flag) {
      case '--url': setUrl(argument()); break;
      case '-X': case '--request': explicit = argument().toUpperCase(); break;
      case '-I': case '--head': head = true; break;
      case '-G': case '--get': get = true; break;
      case '-H': case '--header': {
        const header = argument();
        const split = header.indexOf(':');
        if (split < 1) throw new Error('Expected a name and value in the cURL header.');
        draft.headers.push([header.slice(0, split).trim(), header.slice(split + 1).trim()]);
        break;
      }
      case '-u': case '--user': {
        const user = argument();
        const colon = user.indexOf(':');
        if (colon < 0) throw new Error('Basic auth requires username:password.');
        draft.authType = 'basic';
        draft.authUser = user.slice(0, colon);
        draft.authSecret = user.slice(colon + 1);
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--json': {
        const part = argument();
        if (part.startsWith('@') && flag !== '--data-raw') throw new Error('File arguments are unsupported.');
        data.push(part);
        if (flag === '--json') {
          draft.headers.push(['Content-Type', 'application/json'], ['Accept', 'application/json']);
        }
        break;
      }
      default:
        if (token.startsWith('-')) throw new Error('Unsupported cURL option.');
        setUrl(token);
    }
  }
  if (!/^https?:\/\//i.test(draft.url)) throw new Error('The command must contain an absolute HTTP(S) URL.');
  draft.method = explicit || (head ? 'HEAD' : get ? 'GET' : data.length ? 'POST' : 'GET');
  if (![...byId('method').options].some(option => option.value === draft.method)) throw new Error('Unsupported HTTP method.');
  if (data.length) {
    if (get) {
      const url = new URL(draft.url);
      url.search += (url.search ? '&' : '?') + data.join('&');
      draft.url = url.href;
    } else {
      draft.bodyType = 'raw';
      draft.bodyText = data.join('&');
      if (!draft.headers.some(([key]) => key.toLowerCase() === 'content-type')) {
        draft.headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
      }
    }
  }
  return draft;
}

byId('import').onclick = () => {
  try {
    const request = parseCurl(value('curl'));
    load(request);
    byId('curl').value = '';
    byId('import-dialog').close();
    document.querySelector(`[data-editor="${request.bodyType !== 'none' ? 'body' : 'query'}"]`).click();
    notice('cURL imported.');
  } catch (error) { byId('import-error').textContent = error instanceof TypeError ? 'Invalid cURL URL.' : error.message; }
};

load(saved[0] || empty());
