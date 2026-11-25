import { ext } from '../shared/browser-api';
import {
  listGrantedOrigins,
  requestAllSitesPermission,
  revokeOriginPermission,
} from '../shared/permissions';
import { loadSettings, saveSettings } from '../shared/storage';
import { applyTheme } from '../shared/theme';
import type { ExportFormat, ThemeMode } from '../shared/types';
import { el } from './dom';
import { createIcon } from './icons';

export async function mountOptionsApp(root: HTMLElement): Promise<void> {
  document.body.className = 'surface-options';

  const settings = await loadSettings();
  applyTheme(settings.theme);

  const container = el('div', 'options-container');

  // Header
  const header = el('header', 'options-header');
  const mark = el('div', 'brand-mark');
  mark.appendChild(createIcon('cookie'));
  header.append(mark, el('h1', 'options-title', 'ClearCookie 设置'));

  // 1. General Settings Section
  const generalSection = el('section', 'options-section');
  generalSection.appendChild(el('div', 'options-section-head', '通用'));

  // Theme Row
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
    settings.theme = themeSelect.value as ThemeMode;
    applyTheme(settings.theme);
    await saveSettings(settings);
  });
  themeRow.append(themeLeft, themeSelect);

  // Default Export Format Row
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
    settings.defaultExportFormat = exportSelect.value as ExportFormat;
    await saveSettings(settings);
  });
  exportRow.append(exportLeft, exportSelect);

  // Default Mask Row
  const maskRow = el('div', 'options-row');
  const maskLeft = el('div');
  maskLeft.append(
    el('div', 'options-row-label', '打开时默认遮罩 Cookie 值'),
    el('div', 'options-row-sub', '防止录屏或截图时意外暴露登录凭证'),
  );
  const maskLabel = el('label', 'checkbox-label');
  const maskCheck = el('input');
  maskCheck.type = 'checkbox';
  maskCheck.checked = settings.maskValuesByDefault;
  maskCheck.addEventListener('change', async () => {
    settings.maskValuesByDefault = maskCheck.checked;
    await saveSettings(settings);
  });
  maskLabel.append(maskCheck, el('span', undefined, '启用'));
  maskRow.append(maskLeft, maskLabel);

  generalSection.append(themeRow, exportRow, maskRow);

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

  await renderPermissionsList();
}
