import { inspectCookieValue } from '../shared/inspector';
import type { CookieDraft, CookieItem, SameSiteStatus } from '../shared/types';
import { copyText, dateTimeLocalToEpoch, el, epochToDateTimeLocal } from './dom';
import { createIcon } from './icons';

export interface CookieRowOptions {
  expanded: boolean;
  masked: boolean;
  showAdvancedDefault: boolean;
  justSaved: boolean;
}

export interface CookieRowCallbacks {
  onToggleExpand: () => void;
  onSave: (draft: CookieDraft, previous: CookieItem) => Promise<void>;
  onDelete: (cookie: CookieItem) => Promise<void>;
  onToast: (message: string, isError?: boolean) => void;
}

function renderInspector(
  value: string,
  onToast: (msg: string, err?: boolean) => void,
): HTMLElement | null {
  const inspected = inspectCookieValue(value);
  if (!inspected) return null;

  const box = el('div', 'inspector-box');
  const head = el('div', 'inspector-head');
  const meta = el('div', 'inspector-meta');
  meta.appendChild(createIcon('code', 'icon-sm'));

  let copyPayload = '';

  if (inspected.kind === 'jwt') {
    meta.appendChild(el('span', undefined, 'JWT'));
    if (inspected.expired === true) {
      meta.appendChild(el('span', 'badge badge-danger', '已过期'));
    } else if (inspected.expired === false) {
      meta.appendChild(el('span', 'badge badge-green', '未过期'));
    }
    if (inspected.expiresAt) {
      meta.appendChild(el('span', undefined, `到期 ${inspected.expiresAt}`));
    }
    copyPayload = inspected.payload;
  } else if (inspected.kind === 'json') {
    meta.appendChild(el('span', undefined, inspected.wasUrlEncoded ? 'URL + JSON' : 'JSON'));
    copyPayload = inspected.pretty;
  } else if (inspected.kind === 'base64') {
    meta.appendChild(el('span', undefined, inspected.isJson ? 'Base64 JSON' : 'Base64'));
    copyPayload = inspected.decoded;
  } else {
    meta.appendChild(el('span', undefined, 'URL 解码'));
    copyPayload = inspected.decoded;
  }

  const copyBtn = el('button', 'inline-link-btn', '复制解码');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(copyPayload);
    onToast(ok ? '已复制解码内容' : '复制失败', !ok);
  });

  head.append(meta, copyBtn);
  box.appendChild(head);

  if (inspected.kind === 'jwt') {
    box.appendChild(el('div', 'inspector-sublabel', 'Payload'));
    box.appendChild(el('pre', 'inspector-pre', inspected.payload));
    box.appendChild(el('div', 'inspector-sublabel', 'Header'));
    box.appendChild(el('pre', 'inspector-pre', inspected.header));
  } else if (inspected.kind === 'json') {
    box.appendChild(el('pre', 'inspector-pre', inspected.pretty));
  } else {
    box.appendChild(el('pre', 'inspector-pre', inspected.decoded));
  }

  return box;
}

export function renderCookieRow(
  cookie: CookieItem,
  opts: CookieRowOptions,
  callbacks: CookieRowCallbacks,
): HTMLLIElement {
  const classes = ['cookie-item'];
  if (opts.expanded) classes.push('expanded');
  if (opts.justSaved) classes.push('anim-saved');
  const li = el('li', classes.join(' '));

  // Single-line compact Cookie-Editor header row
  const row = el('div', 'cookie-row');
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-expanded', String(opts.expanded));

  const arrow = el('span', 'cookie-arrow');
  arrow.appendChild(createIcon('chevron-down', 'icon-sm'));

  const nameSpan = el('span', 'cookie-row-name', cookie.name);
  nameSpan.title = cookie.name;

  const extraText = opts.masked ? cookie.domain : cookie.domain;
  const extraSpan = el('span', 'cookie-row-extra', extraText);
  extraSpan.title = `${cookie.domain}${cookie.path}`;

  // Hover quick buttons (Copy + Delete)
  const hoverBtns = el('div', 'cookie-row-hover-btns');

  const copyQuickBtn = el('button', 'row-mini-btn');
  copyQuickBtn.type = 'button';
  copyQuickBtn.title = '复制值';
  copyQuickBtn.setAttribute('aria-label', '复制值');
  copyQuickBtn.appendChild(createIcon('copy', 'icon-sm'));
  copyQuickBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(cookie.value);
    callbacks.onToast(ok ? `已复制 ${cookie.name}` : '复制失败', !ok);
  });

  const delQuickBtn = el('button', 'row-mini-btn danger');
  delQuickBtn.type = 'button';
  delQuickBtn.title = '删除';
  delQuickBtn.setAttribute('aria-label', '删除');
  delQuickBtn.appendChild(createIcon('trash', 'icon-sm'));
  delQuickBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await callbacks.onDelete(cookie);
  });

  hoverBtns.append(copyQuickBtn, delQuickBtn);
  row.append(arrow, nameSpan, extraSpan, hoverBtns);

  row.addEventListener('click', callbacks.onToggleExpand);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callbacks.onToggleExpand();
    }
  });

  li.appendChild(row);

  if (!opts.expanded) return li;

  // Cookie-Editor signature expando: left vertical action rail + right form
  const expando = el('div', 'cookie-expando');

  const sideActions = el('div', 'expando-side-actions');
  const sideDeleteBtn = el('button', 'expando-action-btn delete');
  sideDeleteBtn.type = 'button';
  sideDeleteBtn.title = '删除';
  sideDeleteBtn.setAttribute('aria-label', '删除');
  sideDeleteBtn.appendChild(createIcon('trash'));

  const sideSaveBtn = el('button', 'expando-action-btn save');
  sideSaveBtn.type = 'button';
  sideSaveBtn.title = '保存';
  sideSaveBtn.setAttribute('aria-label', '保存');
  sideSaveBtn.appendChild(createIcon('save'));

  sideActions.append(sideDeleteBtn, sideSaveBtn);

  const form = el('form', 'expando-form');

  // Name
  const nameField = el('div', 'field');
  nameField.appendChild(el('label', 'field-label', 'Name'));
  const nameInput = el('input', 'input input-mono');
  nameInput.type = 'text';
  nameInput.value = cookie.name;
  nameInput.required = true;
  nameField.appendChild(nameInput);

  // Value
  let localReveal = !opts.masked;
  const valueField = el('div', 'field');
  const valueLabelRow = el('div', 'field-label');
  valueLabelRow.appendChild(el('span', undefined, 'Value'));

  const valueInput = el('textarea', 'textarea textarea-mono');
  valueInput.value = cookie.value;
  valueInput.rows = 3;

  const inspectorHost = el('div');

  const refreshInspector = () => {
    inspectorHost.replaceChildren();
    if (!localReveal) return;
    const node = renderInspector(valueInput.value, callbacks.onToast);
    if (node) inspectorHost.appendChild(node);
  };

  if (opts.masked) {
    const revealBtn = el('button', 'inline-link-btn', '显示值');
    revealBtn.type = 'button';
    valueInput.disabled = true;
    valueInput.value = '••••••••••••';
    revealBtn.addEventListener('click', () => {
      localReveal = !localReveal;
      if (localReveal) {
        valueInput.disabled = false;
        valueInput.value = cookie.value;
        revealBtn.textContent = '遮罩';
      } else {
        valueInput.disabled = true;
        valueInput.value = '••••••••••••';
        revealBtn.textContent = '显示值';
      }
      refreshInspector();
    });
    valueLabelRow.appendChild(revealBtn);
  }

  valueInput.addEventListener('input', refreshInspector);
  valueField.append(valueLabelRow, valueInput);
  refreshInspector();

  // Collapsible Advanced Fields (Cookie-Editor style)
  let advancedVisible = opts.showAdvancedDefault;
  const advToggleBtn = el(
    'button',
    'advanced-toggle-btn',
    advancedVisible ? '隐藏高级选项' : '显示高级选项',
  );
  advToggleBtn.type = 'button';

  const advSection = el('div', 'advanced-section');
  advSection.hidden = !advancedVisible;

  advToggleBtn.addEventListener('click', () => {
    advancedVisible = !advancedVisible;
    advSection.hidden = !advancedVisible;
    advToggleBtn.textContent = advancedVisible ? '隐藏高级选项' : '显示高级选项';
  });

  // Domain & Path
  const domainPathGrid = el('div', 'form-grid-2');

  const domainField = el('div', 'field');
  domainField.appendChild(el('label', 'field-label', 'Domain'));
  const domainInput = el('input', 'input input-mono');
  domainInput.type = 'text';
  domainInput.value = cookie.domain;
  domainField.appendChild(domainInput);

  const pathField = el('div', 'field');
  pathField.appendChild(el('label', 'field-label', 'Path'));
  const pathInput = el('input', 'input input-mono');
  pathInput.type = 'text';
  pathInput.value = cookie.path;
  pathField.appendChild(pathInput);

  domainPathGrid.append(domainField, pathField);

  // Expiration & SameSite
  const metaGrid = el('div', 'form-grid-2');

  const expField = el('div', 'field');
  expField.appendChild(el('label', 'field-label', '过期时间'));
  const expInput = el('input', 'input');
  expInput.type = 'datetime-local';
  expInput.value = epochToDateTimeLocal(cookie.expirationDate);
  expInput.disabled = cookie.session;
  expField.appendChild(expInput);

  const sameSiteField = el('div', 'field');
  sameSiteField.appendChild(el('label', 'field-label', 'SameSite'));
  const sameSiteSelect = el('select', 'select');
  for (const [val, label] of [
    ['unspecified', 'Unspecified'],
    ['lax', 'Lax'],
    ['strict', 'Strict'],
    ['no_restriction', 'None'],
  ] as const) {
    const o = el('option', undefined, label);
    o.value = val;
    if (val === cookie.sameSite) o.selected = true;
    sameSiteSelect.appendChild(o);
  }
  sameSiteField.appendChild(sameSiteSelect);

  metaGrid.append(expField, sameSiteField);

  // Checkboxes
  const checkboxList = el('div', 'checkbox-list');
  const makeCheck = (label: string, checked: boolean) => {
    const wrap = el('label', 'checkbox-item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    wrap.append(cb, el('span', undefined, label));
    return { wrap, cb };
  };

  const hostOnlyCtl = makeCheck('HostOnly', cookie.hostOnly);
  const sessionCtl = makeCheck('Session', cookie.session);
  const secureCtl = makeCheck('Secure', cookie.secure);
  const httpOnlyCtl = makeCheck('HttpOnly', cookie.httpOnly);

  sessionCtl.cb.addEventListener('change', () => {
    expInput.disabled = sessionCtl.cb.checked;
    if (!sessionCtl.cb.checked && !expInput.value) {
      const thirtyDays = Math.floor(Date.now() / 1000) + 30 * 86400;
      expInput.value = epochToDateTimeLocal(thirtyDays);
    }
  });

  sameSiteSelect.addEventListener('change', () => {
    if (sameSiteSelect.value === 'no_restriction') {
      secureCtl.cb.checked = true;
    }
  });

  checkboxList.append(hostOnlyCtl.wrap, sessionCtl.wrap, secureCtl.wrap, httpOnlyCtl.wrap);
  advSection.append(domainPathGrid, metaGrid, checkboxList);

  if (cookie.partitionKey?.topLevelSite) {
    advSection.appendChild(
      el('div', 'partition-line', `PartitionKey: ${cookie.partitionKey.topLevelSite}`),
    );
  }

  const errorBox = el('div', 'inline-error');
  errorBox.hidden = true;

  const submitSave = async () => {
    errorBox.hidden = true;
    sideSaveBtn.disabled = true;

    const actualValue = localReveal ? valueInput.value : cookie.value;
    const isSession = sessionCtl.cb.checked;
    const draft: CookieDraft = {
      name: nameInput.value.trim(),
      value: actualValue,
      domain: domainInput.value.trim(),
      path: pathInput.value.trim() || '/',
      hostOnly: hostOnlyCtl.cb.checked,
      session: isSession,
      httpOnly: httpOnlyCtl.cb.checked,
      secure: secureCtl.cb.checked,
      sameSite: sameSiteSelect.value as SameSiteStatus,
      expirationDate: isSession ? undefined : dateTimeLocalToEpoch(expInput.value),
      storeId: cookie.storeId,
      partitionKey: cookie.partitionKey,
      firstPartyDomain: cookie.firstPartyDomain,
    };

    try {
      await callbacks.onSave(draft, cookie);
    } catch (err) {
      errorBox.textContent = err instanceof Error ? err.message : '保存失败';
      errorBox.hidden = false;
      sideSaveBtn.disabled = false;
    }
  };

  sideSaveBtn.addEventListener('click', () => void submitSave());
  sideDeleteBtn.addEventListener('click', () => void callbacks.onDelete(cookie));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitSave();
  });

  form.append(nameField, valueField, inspectorHost, advToggleBtn, advSection, errorBox);
  expando.append(sideActions, form);
  li.appendChild(expando);
  return li;
}
