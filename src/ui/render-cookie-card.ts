import { inspectCookieValue } from '../shared/inspector';
import type { CookieDraft, CookieItem, SameSiteStatus } from '../shared/types';
import { copyText, dateTimeLocalToEpoch, el, epochToDateTimeLocal } from './dom';
import { createIcon } from './icons';

export type RowFlashKind = 'changed' | 'saved' | 'added';

export interface CookieRowOptions {
  expanded: boolean;
  masked: boolean;
  showAdvancedDefault: boolean;
}

export interface CookieRowCallbacks {
  onToggleExpand: () => void;
  onSave: (draft: CookieDraft, previous: CookieItem) => Promise<void>;
  onDelete: (cookie: CookieItem) => Promise<void>;
  onToast: (message: string, isError?: boolean) => void;
}

export interface CookieRowController {
  readonly el: HTMLLIElement;
  getCookie: () => CookieItem;
  setExpanded: (expanded: boolean) => void;
  setMasked: (masked: boolean) => void;
  setShowAdvancedDefault: (show: boolean) => void;
  updateCookie: (next: CookieItem, flash?: RowFlashKind) => void;
  flash: (kind: RowFlashKind) => void;
  removeAnimated: (onDone?: () => void) => void;
}

function triggerAnimClass(node: HTMLElement, className: string): void {
  node.classList.remove('anim-saved', 'anim-value-changed', 'anim-added');
  // Force reflow so rapid consecutive updates re-trigger the keyframe cleanly
  void node.offsetWidth;
  node.classList.add(className);
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

interface EditorRefs {
  expando: HTMLDivElement;
  nameInput: HTMLInputElement;
  valueInput: HTMLTextAreaElement;
  revealBtn: HTMLButtonElement | null;
  domainInput: HTMLInputElement;
  pathInput: HTMLInputElement;
  expInput: HTMLInputElement;
  sameSiteSelect: HTMLSelectElement;
  hostOnlyCb: HTMLInputElement;
  hostOnlyWrap: HTMLLabelElement;
  sessionCb: HTMLInputElement;
  sessionWrap: HTMLLabelElement;
  secureCb: HTMLInputElement;
  secureWrap: HTMLLabelElement;
  httpOnlyCb: HTMLInputElement;
  httpOnlyWrap: HTMLLabelElement;
  advToggleBtn: HTMLButtonElement;
  advSection: HTMLDivElement;
  sideSaveBtn: HTMLButtonElement;
  refreshInspector: () => void;
  setLocalMasked: (masked: boolean) => void;
  setAdvancedOpen: (open: boolean) => void;
}

export function createCookieRowController(
  initialCookie: CookieItem,
  initialOpts: CookieRowOptions,
  callbacks: CookieRowCallbacks,
): CookieRowController {
  let cookie: CookieItem = { ...initialCookie };
  let expanded = initialOpts.expanded;
  let masked = initialOpts.masked;
  let showAdvancedDefault = initialOpts.showAdvancedDefault;
  let editor: EditorRefs | null = null;

  const li = el('li', expanded ? 'cookie-item expanded' : 'cookie-item');

  // Single-line compact header row
  const row = el('div', 'cookie-row');
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-expanded', String(expanded));

  const arrow = el('span', 'cookie-arrow');
  arrow.appendChild(createIcon('chevron-down', 'icon-sm'));

  const nameSpan = el('span', 'cookie-row-name', cookie.name);
  nameSpan.title = cookie.name;

  const extraSpan = el('span', 'cookie-row-extra', cookie.domain);
  extraSpan.title = `${cookie.domain}${cookie.path}`;

  // Hover quick actions
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

  function buildEditor(): EditorRefs {
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
    let localReveal = !masked;
    const valueField = el('div', 'field');
    const valueLabelRow = el('div', 'field-label');
    valueLabelRow.appendChild(el('span', undefined, 'Value'));

    const valueInput = el('textarea', 'textarea textarea-mono');
    valueInput.rows = 3;

    const inspectorHost = el('div');

    const refreshInspector = () => {
      inspectorHost.replaceChildren();
      if (!localReveal) return;
      const node = renderInspector(valueInput.value, callbacks.onToast);
      if (node) inspectorHost.appendChild(node);
    };

    const revealBtn = el('button', 'inline-link-btn', '显示值');
    revealBtn.type = 'button';

    const syncMaskControls = () => {
      revealBtn.hidden = !masked;
      if (masked && !localReveal) {
        valueInput.disabled = true;
        valueInput.value = '••••••••••••';
        revealBtn.textContent = '显示值';
      } else {
        valueInput.disabled = false;
        valueInput.value = cookie.value;
        revealBtn.textContent = '遮罩';
      }
      refreshInspector();
    };

    revealBtn.addEventListener('click', () => {
      localReveal = !localReveal;
      syncMaskControls();
    });

    valueLabelRow.appendChild(revealBtn);
    valueInput.addEventListener('input', refreshInspector);
    valueField.append(valueLabelRow, valueInput);
    syncMaskControls();

    // Advanced collapsible section
    let advancedVisible = showAdvancedDefault;
    const advToggleBtn = el(
      'button',
      'advanced-toggle-btn',
      advancedVisible ? '隐藏高级选项' : '显示高级选项',
    );
    advToggleBtn.type = 'button';

    const advSection = el('div', 'advanced-section');
    advSection.hidden = !advancedVisible;

    const setAdvancedOpen = (open: boolean) => {
      advancedVisible = open;
      advSection.hidden = !open;
      advToggleBtn.textContent = open ? '隐藏高级选项' : '显示高级选项';
    };

    advToggleBtn.addEventListener('click', () => setAdvancedOpen(!advancedVisible));

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

    // Flags
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
      } finally {
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

    return {
      expando,
      nameInput,
      valueInput,
      revealBtn,
      domainInput,
      pathInput,
      expInput,
      sameSiteSelect,
      hostOnlyCb: hostOnlyCtl.cb,
      hostOnlyWrap: hostOnlyCtl.wrap,
      sessionCb: sessionCtl.cb,
      sessionWrap: sessionCtl.wrap,
      secureCb: secureCtl.cb,
      secureWrap: secureCtl.wrap,
      httpOnlyCb: httpOnlyCtl.cb,
      httpOnlyWrap: httpOnlyCtl.wrap,
      advToggleBtn,
      advSection,
      sideSaveBtn,
      refreshInspector,
      setLocalMasked: (nextMasked: boolean) => {
        localReveal = !nextMasked;
        syncMaskControls();
      },
      setAdvancedOpen,
    };
  }

  function applyExpandedState(nextExpanded: boolean): void {
    expanded = nextExpanded;
    li.classList.toggle('expanded', expanded);
    row.setAttribute('aria-expanded', String(expanded));

    if (expanded) {
      if (!editor) {
        editor = buildEditor();
        li.appendChild(editor.expando);
      }
      editor.expando.hidden = false;
    } else if (editor) {
      editor.expando.hidden = true;
    }
  }

  function flash(kind: RowFlashKind): void {
    const cls =
      kind === 'saved'
        ? 'anim-saved'
        : kind === 'added'
          ? 'anim-added'
          : 'anim-value-changed';
    triggerAnimClass(row, cls);
  }

  function updateCookie(next: CookieItem, flashKind?: RowFlashKind): void {
    const prev = cookie;
    cookie = { ...next };

    nameSpan.textContent = next.name;
    nameSpan.title = next.name;
    extraSpan.textContent = next.domain;
    extraSpan.title = `${next.domain}${next.path}`;

    if (editor) {
      const shouldHighlightField = flashKind === 'changed';
      if (prev.name !== next.name) {
        editor.nameInput.value = next.name;
        if (shouldHighlightField) triggerAnimClass(editor.nameInput, 'anim-value-changed');
      }
      if (prev.value !== next.value) {
        if (!editor.valueInput.disabled) {
          editor.valueInput.value = next.value;
        }
        editor.refreshInspector();
        if (shouldHighlightField) triggerAnimClass(editor.valueInput, 'anim-value-changed');
      }
      if (prev.domain !== next.domain) {
        editor.domainInput.value = next.domain;
        if (shouldHighlightField) triggerAnimClass(editor.domainInput, 'anim-value-changed');
      }
      if (prev.path !== next.path) {
        editor.pathInput.value = next.path;
        if (shouldHighlightField) triggerAnimClass(editor.pathInput, 'anim-value-changed');
      }
      if (prev.expirationDate !== next.expirationDate) {
        editor.expInput.value = epochToDateTimeLocal(next.expirationDate);
        if (shouldHighlightField) triggerAnimClass(editor.expInput, 'anim-value-changed');
      }
      if (prev.sameSite !== next.sameSite) {
        editor.sameSiteSelect.value = next.sameSite;
        if (shouldHighlightField) triggerAnimClass(editor.sameSiteSelect, 'anim-value-changed');
      }
      if (prev.hostOnly !== next.hostOnly) {
        editor.hostOnlyCb.checked = next.hostOnly;
        if (shouldHighlightField) triggerAnimClass(editor.hostOnlyWrap, 'anim-value-changed');
      }
      if (prev.session !== next.session) {
        editor.sessionCb.checked = next.session;
        editor.expInput.disabled = next.session;
        if (shouldHighlightField) triggerAnimClass(editor.sessionWrap, 'anim-value-changed');
      }
      if (prev.secure !== next.secure) {
        editor.secureCb.checked = next.secure;
        if (shouldHighlightField) triggerAnimClass(editor.secureWrap, 'anim-value-changed');
      }
      if (prev.httpOnly !== next.httpOnly) {
        editor.httpOnlyCb.checked = next.httpOnly;
        if (shouldHighlightField) triggerAnimClass(editor.httpOnlyWrap, 'anim-value-changed');
      }
    }

    if (flashKind) {
      flash(flashKind);
    }
  }

  if (expanded) {
    applyExpandedState(true);
  }

  return {
    el: li,
    getCookie: () => cookie,
    setExpanded: applyExpandedState,
    setMasked: (nextMasked: boolean) => {
      masked = nextMasked;
      editor?.setLocalMasked(nextMasked);
    },
    setShowAdvancedDefault: (show: boolean) => {
      showAdvancedDefault = show;
      editor?.setAdvancedOpen(show);
    },
    updateCookie,
    flash,
    removeAnimated: (onDone?: () => void) => {
      li.classList.add('anim-removing');
      window.setTimeout(() => {
        li.remove();
        onDone?.();
      }, 220);
    },
  };
}
