import { inspectCookieValue } from '../shared/inspector';
import type { CookieDraft, CookieItem, SameSiteStatus } from '../shared/types';
import { copyText, dateTimeLocalToEpoch, el, epochToDateTimeLocal } from './dom';
import { createIcon } from './icons';

export interface CookieCardCallbacks {
  onToggleExpand: () => void;
  onSave: (draft: CookieDraft, previous: CookieItem) => Promise<void>;
  onDelete: (cookie: CookieItem) => Promise<void>;
  onToast: (message: string, isError?: boolean) => void;
}

function renderInspector(value: string, onToast: (msg: string, err?: boolean) => void): HTMLElement | null {
  const inspected = inspectCookieValue(value);
  if (!inspected) return null;

  const box = el('div', 'inspector-box');
  const header = el('div', 'inspector-header');
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

  const copyBtn = el('button', 'btn btn-sm', '复制解码内容');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(copyPayload);
    onToast(ok ? '已复制解码内容' : '复制失败', !ok);
  });

  header.append(meta, copyBtn);
  box.appendChild(header);

  if (inspected.kind === 'jwt') {
    box.appendChild(el('div', 'inspector-section-label', 'Payload'));
    box.appendChild(el('pre', 'inspector-pre', inspected.payload));
    box.appendChild(el('div', 'inspector-section-label', 'Header'));
    box.appendChild(el('pre', 'inspector-pre', inspected.header));
  } else if (inspected.kind === 'json') {
    box.appendChild(el('pre', 'inspector-pre', inspected.pretty));
  } else {
    box.appendChild(el('pre', 'inspector-pre', inspected.decoded));
  }

  return box;
}

export function renderCookieCard(
  cookie: CookieItem,
  expanded: boolean,
  masked: boolean,
  callbacks: CookieCardCallbacks,
): HTMLElement {
  const card = el('article', expanded ? 'cookie-card expanded' : 'cookie-card');

  // Summary Header
  const summary = el('div', 'cookie-summary');
  summary.setAttribute('role', 'button');
  summary.setAttribute('tabindex', '0');
  summary.setAttribute('aria-expanded', String(expanded));

  const chevron = el('span', 'cookie-chevron');
  chevron.appendChild(createIcon('chevron-down', 'icon-sm'));

  const main = el('div', 'cookie-main');
  const topLine = el('div', 'cookie-top-line');
  const nameNode = el('span', 'cookie-name', cookie.name);
  nameNode.title = cookie.name;
  topLine.appendChild(nameNode);

  const badges = el('div', 'badge-group');
  if (cookie.httpOnly) badges.appendChild(el('span', 'badge badge-blue', 'HttpOnly'));
  if (cookie.secure) badges.appendChild(el('span', 'badge badge-green', 'Secure'));
  if (cookie.partitionKey?.topLevelSite) {
    badges.appendChild(el('span', 'badge badge-purple', 'Partitioned'));
  }
  if (cookie.session) badges.appendChild(el('span', 'badge', 'Session'));
  topLine.appendChild(badges);

  const subLine = el('div', 'cookie-sub-line');
  const valPreview = el(
    'span',
    masked ? 'cookie-value-preview masked' : 'cookie-value-preview',
    masked ? '••••••••••••' : cookie.value || '(空值)',
  );
  if (!masked) valPreview.title = cookie.value;
  const domainTag = el('span', 'cookie-domain-tag', cookie.domain);
  domainTag.title = `${cookie.domain}${cookie.path}`;
  subLine.append(valPreview, domainTag);

  main.append(topLine, subLine);

  const quickActions = el('div', 'cookie-quick-actions');

  const copyBtn = el('button', 'icon-btn');
  copyBtn.type = 'button';
  copyBtn.title = '复制值';
  copyBtn.setAttribute('aria-label', '复制值');
  copyBtn.appendChild(createIcon('copy', 'icon-sm'));
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(cookie.value);
    callbacks.onToast(ok ? `已复制 ${cookie.name}` : '复制失败', !ok);
  });

  const delBtn = el('button', 'icon-btn danger');
  delBtn.type = 'button';
  delBtn.title = '删除';
  delBtn.setAttribute('aria-label', '删除');
  delBtn.appendChild(createIcon('trash', 'icon-sm'));
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await callbacks.onDelete(cookie);
  });

  quickActions.append(copyBtn, delBtn);
  summary.append(chevron, main, quickActions);

  summary.addEventListener('click', callbacks.onToggleExpand);
  summary.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callbacks.onToggleExpand();
    }
  });

  card.appendChild(summary);

  if (!expanded) return card;

  // Expanded Inline Editor
  const form = el('form', 'cookie-editor');

  // Name
  const nameField = el('div', 'field');
  nameField.appendChild(el('label', 'field-label', 'Name'));
  const nameInput = el('input', 'input input-mono');
  nameInput.type = 'text';
  nameInput.value = cookie.name;
  nameInput.required = true;
  nameField.appendChild(nameInput);

  // Value
  let localReveal = !masked;
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

  if (masked) {
    const revealBtn = el('button', 'btn btn-sm', '显示值');
    revealBtn.type = 'button';
    valueInput.disabled = true;
    valueInput.value = '••••••••••••';
    revealBtn.addEventListener('click', () => {
      localReveal = !localReveal;
      if (localReveal) {
        valueInput.disabled = false;
        valueInput.value = cookie.value;
        revealBtn.textContent = '遮罩值';
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

  // Domain & Path
  const domainPathRow = el('div', 'grid-2');

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

  domainPathRow.append(domainField, pathField);

  // SameSite & Expiration
  const metaRow = el('div', 'grid-2');

  const sameSiteField = el('div', 'field');
  sameSiteField.appendChild(el('label', 'field-label', 'SameSite'));
  const sameSiteSelect = el('select', 'select');
  const sameSiteOptions: Array<{ value: SameSiteStatus; label: string }> = [
    { value: 'unspecified', label: 'Unspecified' },
    { value: 'lax', label: 'Lax' },
    { value: 'strict', label: 'Strict' },
    { value: 'no_restriction', label: 'None (no_restriction)' },
  ];
  for (const opt of sameSiteOptions) {
    const optionEl = el('option', undefined, opt.label);
    optionEl.value = opt.value;
    if (opt.value === cookie.sameSite) optionEl.selected = true;
    sameSiteSelect.appendChild(optionEl);
  }
  sameSiteField.appendChild(sameSiteSelect);

  const expField = el('div', 'field');
  expField.appendChild(el('label', 'field-label', '过期时间'));
  const expInput = el('input', 'input');
  expInput.type = 'datetime-local';
  expInput.value = epochToDateTimeLocal(cookie.expirationDate);
  expInput.disabled = cookie.session;
  expField.appendChild(expInput);

  metaRow.append(sameSiteField, expField);

  // Flags
  const flagsRow = el('div', 'checkbox-row');

  const makeCheck = (label: string, checked: boolean) => {
    const wrap = el('label', 'checkbox-label');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    wrap.append(cb, el('span', undefined, label));
    return { wrap, cb };
  };

  const hostOnlyCtl = makeCheck('HostOnly', cookie.hostOnly);
  const sessionCtl = makeCheck('Session', cookie.session);
  const httpOnlyCtl = makeCheck('HttpOnly', cookie.httpOnly);
  const secureCtl = makeCheck('Secure', cookie.secure);

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

  flagsRow.append(hostOnlyCtl.wrap, sessionCtl.wrap, httpOnlyCtl.wrap, secureCtl.wrap);

  // PartitionKey info (read-only if present)
  let partitionNode: HTMLElement | null = null;
  if (cookie.partitionKey?.topLevelSite) {
    partitionNode = el(
      'div',
      'partition-info',
      `PartitionKey: ${cookie.partitionKey.topLevelSite}`,
    );
  }

  // Error line
  const errorBox = el('div', 'inline-error');
  errorBox.hidden = true;

  // Footer
  const footer = el('div', 'editor-footer');
  const deleteActionBtn = el('button', 'btn btn-danger', '删除');
  deleteActionBtn.type = 'button';
  deleteActionBtn.addEventListener('click', async () => {
    await callbacks.onDelete(cookie);
  });

  const saveBtn = el('button', 'btn btn-primary', '保存');
  saveBtn.type = 'submit';

  footer.append(deleteActionBtn, saveBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    saveBtn.disabled = true;

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
      saveBtn.disabled = false;
    }
  });

  form.append(nameField, valueField, inspectorHost, domainPathRow, metaRow, flagsRow);
  if (partitionNode) form.appendChild(partitionNode);
  form.append(errorBox, footer);

  card.appendChild(form);
  return card;
}
