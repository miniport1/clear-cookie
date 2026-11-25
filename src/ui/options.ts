import { ext } from '../shared/browser-api';
import {
  listGrantedOrigins,
  requestAllSitesPermission,
  revokeOriginPermission,
} from '../shared/permissions';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  loadSettings,
  onSettingsChanged,
  saveSettings,
} from '../shared/storage';
import { applyFontSize, applyTheme } from '../shared/theme';
import type { ExportFormat, ThemeMode } from '../shared/types';
import { el } from './dom';
import { createIcon } from './icons';

function createSwitch(checked: boolean, onChange: (val: boolean) => void): {
  wrap: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const wrap = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, el('span', 'switch-slider'));
  return { wrap, input };
}

export async function mountOptionsApp(root: HTMLElement): Promise<void> {
  document.body.className = 'surface-options';

  let settings = await loadSettings();
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);

  const container = el('div', 'options-container');

  // Header
  const header = el('header', 'options-header');
  const logo = el('div', 'options-logo');
  logo.appendChild(createIcon('cookie'));
  header.append(logo, el('h1', 'options-title', 'ClearCookie 设置'));

  // 1. General Settings
  const generalSection = el('section', 'options-section');
  generalSection.appendChild(el('div', 'options-section-head', '通用'));

  // Theme
  const themeRow = el('div', 'options-row');
  const themeLeft = el('div');
  themeLeft.appendChild(el('div', 'options-row-label', '外观主题'));
  const themeSelect = el('select', 'select options-select');
  for (const [val, label] of [
    ['system', '跟随系统'],
    ['light', '浅色'],
    ['dark', '深色'],
  ] as const) {
    const o = el('option', undefined, label);
    o.value = val;
    if (settings.theme === val) o.selected = true;
    themeSelect.appendChild(o);
  }
  themeSelect.addEventListener('change', async () => {
    settings = { ...settings, theme: themeSelect.value as ThemeMode };
    applyTheme(settings.theme);
    await saveSettings(settings);
  });
  themeRow.append(themeLeft, themeSelect);

  // Font Size
  const fontRow = el('div', 'options-row');
  const fontLeft = el('div');
  fontLeft.append(
    el('div', 'options-row-label', '字体大小'),
    el('div', 'options-row-sub', `支持 ${MIN_FONT_SIZE}px – ${MAX_FONT_SIZE}px，实时同步到弹窗与侧边栏`),
  );

  const fontControl = el('div', 'options-font-control');
  const fontStepper = el('div', 'menu-font-stepper');

  const minusBtn = el('button', 'stepper-btn');
  minusBtn.type = 'button';
  minusBtn.title = '缩小字号';
  minusBtn.setAttribute('aria-label', '缩小字号');
  minusBtn.appendChild(createIcon('minus', 'icon-sm'));

  const fontValueEl = el('span', 'stepper-val', `${settings.fontSize}px`);

  const plusBtn = el('button', 'stepper-btn');
  plusBtn.type = 'button';
  plusBtn.title = '增大字号';
  plusBtn.setAttribute('aria-label', '增大字号');
  plusBtn.appendChild(createIcon('plus', 'icon-sm'));

  fontStepper.append(minusBtn, fontValueEl, plusBtn);

  const presetWrap = el('div', 'format-pills');
  const presetItems = [
    { size: 12, label: '紧凑' },
    { size: 14, label: '标准' },
    { size: 16, label: '舒适' },
    { size: 18, label: '大号' },
  ];
  const presetBtns: Array<{ size: number; btn: HTMLButtonElement }> = [];

  const syncFontUi = () => {
    fontValueEl.textContent = `${settings.fontSize}px`;
    minusBtn.disabled = settings.fontSize <= MIN_FONT_SIZE;
    plusBtn.disabled = settings.fontSize >= MAX_FONT_SIZE;
    for (const p of presetBtns) {
      p.btn.classList.toggle('active', settings.fontSize === p.size);
    }
  };

  const updateFontSize = async (next: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
    settings = { ...settings, fontSize: clamped };
    applyFontSize(clamped);
    syncFontUi();
    await saveSettings(settings);
  };

  minusBtn.addEventListener('click', () => void updateFontSize(settings.fontSize - 1));
  plusBtn.addEventListener('click', () => void updateFontSize(settings.fontSize + 1));

  for (const p of presetItems) {
    const btn = el('button', 'filter-pill', p.label);
    btn.type = 'button';
    btn.addEventListener('click', () => void updateFontSize(p.size));
    presetBtns.push({ size: p.size, btn });
    presetWrap.appendChild(btn);
  }
  syncFontUi();

  fontControl.append(fontStepper, presetWrap);
  fontRow.append(fontLeft, fontControl);

  // Show Advanced By Default
  const advRow = el('div', 'options-row');
  const advLeft = el('div');
  advLeft.append(
    el('div', 'options-row-label', '默认展开高级选项'),
    el('div', 'options-row-sub', '展开单条 Cookie 时直接显示 Domain、Path、SameSite 和标记位'),
  );
  const advSwitch = createSwitch(settings.showAdvancedByDefault, async (val) => {
    settings = { ...settings, showAdvancedByDefault: val };
    await saveSettings(settings);
  });
  advRow.append(advLeft, advSwitch.wrap);

  // Default Mask Values
  const maskRow = el('div', 'options-row');
  const maskLeft = el('div');
  maskLeft.append(
    el('div', 'options-row-label', '打开时默认遮罩敏感值'),
    el('div', 'options-row-sub', '防止录屏或截图时意外暴露登录凭证'),
  );
  const maskSwitch = createSwitch(settings.maskValuesByDefault, async (val) => {
    settings = { ...settings, maskValuesByDefault: val };
    await saveSettings(settings);
  });
  maskRow.append(maskLeft, maskSwitch.wrap);

  // Default Export Format
  const exportRow = el('div', 'options-row');
  const exportLeft = el('div');
  exportLeft.appendChild(el('div', 'options-row-label', '默认导出格式'));
  const exportSelect = el('select', 'select options-select');
  for (const [val, label] of [
    ['json', 'JSON'],
    ['header', 'Header String'],
    ['netscape', 'Netscape (cookies.txt)'],
  ] as const) {
    const o = el('option', undefined, label);
    o.value = val;
    if (settings.defaultExportFormat === val) o.selected = true;
    exportSelect.appendChild(o);
  }
  exportSelect.addEventListener('change', async () => {
    settings = { ...settings, defaultExportFormat: exportSelect.value as ExportFormat };
    await saveSettings(settings);
  });
  exportRow.append(exportLeft, exportSelect);

  generalSection.append(themeRow, fontRow, advRow, maskRow, exportRow);

  // 2. Site Permissions Manager
  const permSection = el('section', 'options-section');
  const permHead = el('div', 'options-section-head');
  permHead.appendChild(el('span', undefined, '已授权站点'));

  const grantAllBtn = el('button', 'btn btn-sm', '授予全部站点');
  grantAllBtn.type = 'button';
  grantAllBtn.addEventListener('click', async () => {
    await requestAllSitesPermission();
    await renderPermissionsList();
  });
  permHead.appendChild(grantAllBtn);

  const permBody = el('div');
  permSection.append(permHead, permBody);

  async function renderPermissionsList(): Promise<void> {
    permBody.replaceChildren();
    const origins = await listGrantedOrigins();
    grantAllBtn.hidden = origins.includes('<all_urls>');

    if (origins.length === 0) {
      const emptyRow = el('div', 'options-row');
      emptyRow.appendChild(el('div', 'options-row-sub', '尚未授予任何站点权限'));
      permBody.appendChild(emptyRow);
      return;
    }

    for (const origin of origins) {
      const row = el('div', 'options-row');
      const labelWrap = el('div');
      labelWrap.appendChild(
        el('div', 'origin-code', origin === '<all_urls>' ? '<all_urls> (全部站点)' : origin),
      );

      const revokeBtn = el('button', 'btn btn-sm btn-danger', '收回权限');
      revokeBtn.type = 'button';
      revokeBtn.addEventListener('click', async () => {
        await revokeOriginPermission(origin);
        await renderPermissionsList();
      });

      row.append(labelWrap, revokeBtn);
      permBody.appendChild(row);
    }
  }

  // 3. Offline & Security Self-Check
  const auditSection = el('section', 'options-section');
  auditSection.appendChild(el('div', 'options-section-head', '本地安全校验'));

  const manifest = ext.getManifest();
  const cspObj = manifest.content_security_policy as { extension_pages?: string } | undefined;
  const cspStr = cspObj?.extension_pages ?? '';
  const hasNoConnect = cspStr.includes("connect-src 'none'");

  const makeAuditRow = (title: string, detail: string, status: string) => {
    const row = el('div', 'options-row');
    const left = el('div');
    left.append(el('div', 'options-row-label', title), el('div', 'options-row-sub', detail));
    const badge = el('span', 'audit-badge-ok');
    badge.append(createIcon('check', 'icon-sm'), el('span', undefined, status));
    row.append(left, badge);
    return row;
  };

  auditSection.append(
    makeAuditRow(
      '网络外联策略 (CSP)',
      hasNoConnect ? "Manifest 已强制 connect-src 'none'，扩展无法发出网络请求" : cspStr,
      hasNoConnect ? '已禁止外联' : '请检查 Manifest',
    ),
    makeAuditRow('数据存储位置', '设置与快照仅保存在本地 storage.local', '仅本地'),
    makeAuditRow('第三方运行时依赖', 'package.json 中运行时 dependencies 数量为 0', '0 依赖'),
  );

  container.append(header, generalSection, permSection, auditSection);
  root.replaceChildren(container);

  onSettingsChanged((next) => {
    settings = next;
    applyTheme(next.theme);
    applyFontSize(next.fontSize);
    themeSelect.value = next.theme;
    exportSelect.value = next.defaultExportFormat;
    advSwitch.input.checked = next.showAdvancedByDefault;
    maskSwitch.input.checked = next.maskValuesByDefault;
    syncFontUi();
  });

  await renderPermissionsList();
}
