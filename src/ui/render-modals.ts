import { exportCookies, parseCookies } from '../shared/formats';
import type {
  CookieDraft,
  CookieItem,
  CookieProfile,
  ExportFormat,
  SameSiteStatus,
  TabContext,
} from '../shared/types';
import { copyText, dateTimeLocalToEpoch, downloadTextFile, el, epochToDateTimeLocal } from './dom';
import { createIcon } from './icons';

function createModalShell(title: string, onClose: () => void): {
  backdrop: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
} {
  const backdrop = el('div', 'modal-backdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onClose();
  });

  const card = el('div', 'modal-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const header = el('div', 'modal-header');
  header.appendChild(el('h2', 'modal-title', title));
  const closeBtn = el('button', 'icon-btn');
  closeBtn.type = 'button';
  closeBtn.title = '关闭';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.appendChild(createIcon('x', 'icon-sm'));
  closeBtn.addEventListener('click', onClose);
  header.appendChild(closeBtn);

  const body = el('div', 'modal-body');
  const footer = el('div', 'modal-footer');
  card.append(header, body, footer);
  backdrop.appendChild(card);
  return { backdrop, body, footer };
}

export function renderAddCookieModal(
  ctx: TabContext,
  onSubmit: (draft: CookieDraft) => Promise<void>,
  onClose: () => void,
): HTMLElement {
  const { backdrop, body, footer } = createModalShell('新建 Cookie', onClose);

  const form = el('form');
  form.id = 'add-cookie-form';

  const bodyFields = el('div', 'modal-body');

  const nameField = el('div', 'field');
  nameField.appendChild(el('label', 'field-label', 'Name'));
  const nameInput = el('input', 'input input-mono');
  nameInput.type = 'text';
  nameInput.placeholder = 'session_id';
  nameInput.required = true;
  nameField.appendChild(nameInput);

  const valueField = el('div', 'field');
  valueField.appendChild(el('label', 'field-label', 'Value'));
  const valueInput = el('textarea', 'textarea textarea-mono');
  valueInput.rows = 3;
  valueField.appendChild(valueInput);

  const grid1 = el('div', 'grid-2');
  const domainField = el('div', 'field');
  domainField.appendChild(el('label', 'field-label', 'Domain'));
  const domainInput = el('input', 'input input-mono');
  domainInput.type = 'text';
  domainInput.value = ctx.hostname;
  domainField.appendChild(domainInput);

  const pathField = el('div', 'field');
  pathField.appendChild(el('label', 'field-label', 'Path'));
  const pathInput = el('input', 'input input-mono');
  pathInput.type = 'text';
  pathInput.value = '/';
  pathField.appendChild(pathInput);
  grid1.append(domainField, pathField);

  const grid2 = el('div', 'grid-2');
  const sameSiteField = el('div', 'field');
  sameSiteField.appendChild(el('label', 'field-label', 'SameSite'));
  const sameSiteSelect = el('select', 'select');
  for (const [val, label] of [
    ['lax', 'Lax'],
    ['strict', 'Strict'],
    ['no_restriction', 'None (no_restriction)'],
    ['unspecified', 'Unspecified'],
  ] as const) {
    const o = el('option', undefined, label);
    o.value = val;
    sameSiteSelect.appendChild(o);
  }
  sameSiteField.appendChild(sameSiteSelect);

  const expField = el('div', 'field');
  expField.appendChild(el('label', 'field-label', '过期时间'));
  const expInput = el('input', 'input');
  expInput.type = 'datetime-local';
  const defaultExp = Math.floor(Date.now() / 1000) + 30 * 86400;
  expInput.value = epochToDateTimeLocal(defaultExp);
  expField.appendChild(expInput);
  grid2.append(sameSiteField, expField);

  const flags = el('div', 'checkbox-row');
  const makeCheck = (label: string, checked: boolean) => {
    const wrap = el('label', 'checkbox-label');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    wrap.append(cb, el('span', undefined, label));
    return { wrap, cb };
  };
  const hostOnlyCtl = makeCheck('HostOnly', true);
  const sessionCtl = makeCheck('Session', false);
  const httpOnlyCtl = makeCheck('HttpOnly', false);
  const secureCtl = makeCheck('Secure', ctx.protocol === 'https:');

  sessionCtl.cb.addEventListener('change', () => {
    expInput.disabled = sessionCtl.cb.checked;
  });
  sameSiteSelect.addEventListener('change', () => {
    if (sameSiteSelect.value === 'no_restriction') secureCtl.cb.checked = true;
  });

  flags.append(hostOnlyCtl.wrap, sessionCtl.wrap, httpOnlyCtl.wrap, secureCtl.wrap);

  const errorBox = el('div', 'inline-error');
  errorBox.hidden = true;

  bodyFields.append(nameField, valueField, grid1, grid2, flags, errorBox);
  body.replaceWith(bodyFields);

  const cancelBtn = el('button', 'btn', '取消');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', onClose);

  const saveBtn = el('button', 'btn btn-primary', '保存 Cookie');
  saveBtn.type = 'submit';
  saveBtn.setAttribute('form', 'add-cookie-form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    saveBtn.disabled = true;

    const isSession = sessionCtl.cb.checked;
    const draft: CookieDraft = {
      name: nameInput.value.trim(),
      value: valueInput.value,
      domain: domainInput.value.trim(),
      path: pathInput.value.trim() || '/',
      hostOnly: hostOnlyCtl.cb.checked,
      session: isSession,
      httpOnly: httpOnlyCtl.cb.checked,
      secure: secureCtl.cb.checked,
      sameSite: sameSiteSelect.value as SameSiteStatus,
      expirationDate: isSession ? undefined : dateTimeLocalToEpoch(expInput.value),
      storeId: ctx.cookieStoreId,
    };

    try {
      await onSubmit(draft);
      onClose();
    } catch (err) {
      errorBox.textContent = err instanceof Error ? err.message : '保存失败';
      errorBox.hidden = false;
      saveBtn.disabled = false;
    }
  });

  // Wrap bodyFields inside form so Enter submits naturally
  const parent = bodyFields.parentElement;
  if (parent) {
    parent.insertBefore(form, bodyFields);
    form.appendChild(bodyFields);
  }

  footer.append(cancelBtn, saveBtn);
  queueMicrotask(() => nameInput.focus());
  return backdrop;
}

export function renderExportModal(
  cookies: CookieItem[],
  hostname: string,
  initialFormat: ExportFormat,
  onToast: (msg: string, err?: boolean) => void,
  onClose: () => void,
): HTMLElement {
  const { backdrop, body, footer } = createModalShell('导出 Cookie', onClose);

  let format: ExportFormat = initialFormat;

  const tabs = el('div', 'tab-strip');
  const formats: Array<{ id: ExportFormat; label: string; ext: string }> = [
    { id: 'json', label: 'JSON', ext: 'json' },
    { id: 'header', label: 'Header', ext: 'txt' },
    { id: 'netscape', label: 'Netscape', ext: 'txt' },
  ];

  const preview = el('textarea', 'textarea code-preview');
  preview.readOnly = true;

  const tabButtons: HTMLButtonElement[] = [];

  const updatePreview = () => {
    preview.value = exportCookies(cookies, format);
    for (const btn of tabButtons) {
      btn.classList.toggle('active', btn.dataset.format === format);
    }
  };

  for (const item of formats) {
    const btn = el('button', 'tab-btn', item.label);
    btn.type = 'button';
    btn.dataset.format = item.id;
    btn.addEventListener('click', () => {
      format = item.id;
      updatePreview();
    });
    tabButtons.push(btn);
    tabs.appendChild(btn);
  }

  updatePreview();
  body.append(tabs, preview);

  const downloadBtn = el('button', 'btn');
  downloadBtn.type = 'button';
  downloadBtn.append(createIcon('download', 'icon-sm'), el('span', undefined, '下载文件'));
  downloadBtn.addEventListener('click', () => {
    const meta = formats.find((f) => f.id === format);
    const safeHost = (hostname || 'cookies').replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${safeHost}-cookies-${format}.${meta?.ext ?? 'txt'}`;
    downloadTextFile(filename, preview.value);
    onToast(`已下载 ${filename}`);
  });

  const copyBtn = el('button', 'btn btn-primary');
  copyBtn.type = 'button';
  copyBtn.append(createIcon('copy', 'icon-sm'), el('span', undefined, '复制内容'));
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(preview.value);
    onToast(ok ? `已复制 ${cookies.length} 条 Cookie` : '复制失败', !ok);
    if (ok) onClose();
  });

  footer.append(downloadBtn, copyBtn);
  return backdrop;
}

export function renderImportModal(
  ctx: TabContext,
  onImport: (drafts: CookieDraft[]) => Promise<{ imported: number; failed: Array<{ name: string; reason: string }> }>,
  onToast: (msg: string, err?: boolean) => void,
  onClose: () => void,
): HTMLElement {
  const { backdrop, body, footer } = createModalShell('导入 Cookie', onClose);

  let format: ExportFormat | 'auto' = 'auto';

  const tabs = el('div', 'tab-strip');
  const modes: Array<{ id: ExportFormat | 'auto'; label: string }> = [
    { id: 'auto', label: '自动识别' },
    { id: 'json', label: 'JSON' },
    { id: 'header', label: 'Header' },
    { id: 'netscape', label: 'Netscape' },
  ];
  const tabBtns: HTMLButtonElement[] = [];
  for (const m of modes) {
    const btn = el('button', m.id === 'auto' ? 'tab-btn active' : 'tab-btn', m.label);
    btn.type = 'button';
    btn.dataset.mode = m.id;
    btn.addEventListener('click', () => {
      format = m.id;
      for (const b of tabBtns) {
        b.classList.toggle('active', b.dataset.mode === format);
      }
    });
    tabBtns.push(btn);
    tabs.appendChild(btn);
  }

  const textarea = el('textarea', 'textarea code-preview');
  textarea.placeholder = '粘贴 JSON 数组、Cookie Header 或 Netscape cookies.txt 内容';

  const fileInput = el('input', 'file-input-hidden');
  fileInput.type = 'file';
  fileInput.accept = '.json,.txt,text/plain,application/json';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    textarea.value = await file.text();
  });

  const errorBox = el('div', 'inline-error');
  errorBox.hidden = true;

  body.append(tabs, textarea, fileInput, errorBox);

  const fileBtn = el('button', 'btn');
  fileBtn.type = 'button';
  fileBtn.append(createIcon('file', 'icon-sm'), el('span', undefined, '选择文件'));
  fileBtn.addEventListener('click', () => fileInput.click());

  const importBtn = el('button', 'btn btn-primary', '导入 Cookie');
  importBtn.type = 'button';
  importBtn.addEventListener('click', async () => {
    errorBox.hidden = true;
    importBtn.disabled = true;
    try {
      const parsed = parseCookies(textarea.value, format, ctx.url);
      if (parsed.cookies.length === 0) {
        throw new Error('未解析出可导入的 Cookie');
      }
      const result = await onImport(parsed.cookies);
      if (result.failed.length > 0 && result.imported === 0) {
        const first = result.failed[0];
        throw new Error(`${first?.name ?? 'Cookie'}: ${first?.reason ?? '写入失败'}`);
      }
      const summary =
        result.failed.length > 0
          ? `已导入 ${result.imported} 条，失败 ${result.failed.length} 条`
          : `已导入 ${result.imported} 条 Cookie`;
      onToast(summary, result.failed.length > 0);
      onClose();
    } catch (err) {
      errorBox.textContent = err instanceof Error ? err.message : '导入失败';
      errorBox.hidden = false;
      importBtn.disabled = false;
    }
  });

  footer.append(fileBtn, importBtn);
  queueMicrotask(() => textarea.focus());
  return backdrop;
}

export function renderProfilesModal(
  hostname: string,
  currentCount: number,
  profiles: CookieProfile[],
  actions: {
    onSaveProfile: (name: string) => Promise<void>;
    onApplyProfile: (profile: CookieProfile) => Promise<void>;
    onDeleteProfile: (id: string) => Promise<void>;
  },
  onClose: () => void,
): HTMLElement {
  const { backdrop, body, footer } = createModalShell(`快照 · ${hostname}`, onClose);

  body.appendChild(
    el('p', 'helper-text', '将当前站点的整套 Cookie 存在本地，切换账号时一键恢复。'),
  );

  const createRow = el('form', 'profile-create-row');
  const nameInput = el('input', 'input');
  nameInput.type = 'text';
  nameInput.placeholder = '输入快照名称，例如 测试账号';
  nameInput.required = true;

  const saveBtn = el('button', 'btn btn-primary', '保存快照');
  saveBtn.type = 'submit';
  saveBtn.disabled = currentCount === 0;

  const errorBox = el('div', 'inline-error');
  errorBox.hidden = true;

  createRow.append(nameInput, saveBtn);
  createRow.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    saveBtn.disabled = true;
    try {
      await actions.onSaveProfile(nameInput.value);
    } catch (err) {
      errorBox.textContent = err instanceof Error ? err.message : '保存失败';
      errorBox.hidden = false;
      saveBtn.disabled = false;
    }
  });

  body.append(createRow, errorBox);

  const list = el('div', 'profile-list');
  if (profiles.length === 0) {
    list.appendChild(el('p', 'helper-text', '此站点还没有保存快照'));
  } else {
    for (const p of profiles) {
      const row = el('div', 'profile-item');
      const meta = el('div', 'profile-meta');
      meta.appendChild(el('span', 'profile-name', p.name));
      const dateText = new Date(p.savedAt).toLocaleString('zh-CN', { hour12: false });
      meta.appendChild(el('span', 'profile-sub', `${p.cookies.length} 条 Cookie · ${dateText}`));

      const act = el('div', 'profile-actions');
      const applyBtn = el('button', 'btn btn-sm', '应用快照');
      applyBtn.type = 'button';
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        await actions.onApplyProfile(p);
        onClose();
      });

      const delBtn = el('button', 'icon-btn danger');
      delBtn.type = 'button';
      delBtn.title = '删除快照';
      delBtn.setAttribute('aria-label', '删除快照');
      delBtn.appendChild(createIcon('trash', 'icon-sm'));
      delBtn.addEventListener('click', async () => {
        await actions.onDeleteProfile(p.id);
      });

      act.append(applyBtn, delBtn);
      row.append(meta, act);
      list.appendChild(row);
    }
  }

  body.appendChild(list);

  const closeBtn = el('button', 'btn', '关闭');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', onClose);
  footer.appendChild(closeBtn);

  return backdrop;
}

export function renderClearConfirmModal(
  hostname: string,
  count: number,
  onConfirm: () => Promise<void>,
  onClose: () => void,
): HTMLElement {
  const { backdrop, body, footer } = createModalShell('清空全部 Cookie？', onClose);
  body.appendChild(
    el(
      'p',
      'helper-text',
      `将删除 ${hostname} 的 ${count} 条 Cookie，当前登录状态会失效，操作无法撤回。`,
    ),
  );

  const cancelBtn = el('button', 'btn', '取消');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', onClose);

  const confirmBtn = el('button', 'btn btn-danger-solid', '清空全部');
  confirmBtn.type = 'button';
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    await onConfirm();
    onClose();
  });

  footer.append(cancelBtn, confirmBtn);
  return backdrop;
}
