import { ext } from '../shared/browser-api';
import {
  clearCookiesForTab,
  cookieIdentityKey,
  deleteCookie,
  importCookiesForTab,
  listCookiesForTab,
  parseTabContext,
  saveCookie,
} from '../shared/cookie-service';
import { exportCookies, parseCookies } from '../shared/formats';
import {
  hasPermissionForUrl,
  requestAllSitesPermission,
  requestPermissionForOrigin,
} from '../shared/permissions';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  deleteProfile,
  loadProfilesForOrigin,
  loadSettings,
  onSettingsChanged,
  saveProfile,
  saveSettings,
} from '../shared/storage';
import { applyFontSize, applyTheme } from '../shared/theme';
import type {
  AppSurface,
  CookieDraft,
  CookieItem,
  CookieProfile,
  ExportFormat,
  ExtensionSettings,
  SameSiteStatus,
  TabContext,
} from '../shared/types';
import {
  copyText,
  dateTimeLocalToEpoch,
  downloadTextFile,
  el,
  epochToDateTimeLocal,
} from './dom';
import { createIcon, type IconName } from './icons';
import { renderCookieRow } from './render-cookie-card';

type FilterMode = 'all' | 'httpOnly' | 'secure' | 'session' | 'partitioned';
type ActiveView = 'list' | 'add' | 'import' | 'profiles' | 'clear';

interface FooterAction {
  icon: IconName;
  label: string;
  variant?: 'default' | 'primary' | 'danger' | 'danger-solid';
  disabled?: boolean;
  onClick: () => void;
}

export async function mountCookieApp(root: HTMLElement, surface: AppSurface): Promise<void> {
  document.body.className = `surface-${surface}`;

  let settings: ExtensionSettings = await loadSettings();
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);

  let ctx: TabContext = parseTabContext({});
  let hasPermission = false;
  let cookies: CookieItem[] = [];
  let profiles: CookieProfile[] = [];
  let searchQuery = '';
  let filterMode: FilterMode = 'all';
  let masked = settings.maskValuesByDefault;
  let expandedKey: string | null = null;
  let justSavedKey: string | null = null;
  let activeView: ActiveView = 'list';
  let menuOpen = false;
  let exportMenuOpen = false;
  let toastTimer: number | null = null;

  const shell = el('div', 'app-shell');

  // ==================== 1. Top Title Bar (Cookie-Editor style) ====================
  const titleBar = el('header', 'page-title');
  const titleLeft = el('div', 'title-left');
  const heading = el('h1', 'page-heading', 'ClearCookie');
  const hostSub = el('span', 'title-sub');
  titleLeft.append(heading, hostSub);

  const titleRight = el('div', 'title-right');
  const countLabel = el('span', 'title-count');
  countLabel.hidden = true;

  const refreshBtn = el('button', 'round-icon-btn');
  refreshBtn.type = 'button';
  refreshBtn.title = '刷新';
  refreshBtn.setAttribute('aria-label', '刷新');
  refreshBtn.appendChild(createIcon('refresh', 'icon-sm'));
  refreshBtn.addEventListener('click', () => {
    closePopovers();
    void refreshCurrentTab();
  });

  const menuBtn = el('button', 'round-icon-btn');
  menuBtn.type = 'button';
  menuBtn.title = '菜单';
  menuBtn.setAttribute('aria-label', '菜单');
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.appendChild(createIcon('more-vertical'));

  titleRight.append(countLabel, refreshBtn, menuBtn);

  // Dropdown Menu (⋮)
  const menuPanel = el('div', 'main-menu-panel');
  menuPanel.hidden = true;

  // Item 1: Show Advanced toggle
  const advMenuLabel = el('label', 'menu-item');
  advMenuLabel.appendChild(el('span', undefined, '显示高级选项'));
  const advSwitchWrap = el('span', 'switch');
  const advSwitchInput = el('input');
  advSwitchInput.type = 'checkbox';
  advSwitchInput.checked = settings.showAdvancedByDefault;
  advSwitchWrap.append(advSwitchInput, el('span', 'switch-slider'));
  advMenuLabel.appendChild(advSwitchWrap);
  advSwitchInput.addEventListener('change', async () => {
    settings = { ...settings, showAdvancedByDefault: advSwitchInput.checked };
    await saveSettings(settings);
    if (activeView === 'list') renderListContent();
  });

  // Item 2: Mask sensitive values toggle
  const maskMenuLabel = el('label', 'menu-item');
  maskMenuLabel.appendChild(el('span', undefined, '遮罩敏感值'));
  const maskSwitchWrap = el('span', 'switch');
  const maskSwitchInput = el('input');
  maskSwitchInput.type = 'checkbox';
  maskSwitchInput.checked = masked;
  maskSwitchWrap.append(maskSwitchInput, el('span', 'switch-slider'));
  maskMenuLabel.appendChild(maskSwitchWrap);
  maskSwitchInput.addEventListener('change', () => {
    masked = maskSwitchInput.checked;
    if (activeView === 'list') renderListContent();
  });

  // Item 3: Font Size Stepper
  const fontMenuRow = el('div', 'menu-item menu-item-static');
  fontMenuRow.appendChild(el('span', undefined, '字体大小'));
  const fontStepper = el('div', 'menu-font-stepper');

  const fontMinusBtn = el('button', 'stepper-btn');
  fontMinusBtn.type = 'button';
  fontMinusBtn.title = '缩小字号';
  fontMinusBtn.setAttribute('aria-label', '缩小字号');
  fontMinusBtn.appendChild(createIcon('minus', 'icon-sm'));

  const fontValSpan = el('span', 'stepper-val', `${settings.fontSize}px`);

  const fontPlusBtn = el('button', 'stepper-btn');
  fontPlusBtn.type = 'button';
  fontPlusBtn.title = '增大字号';
  fontPlusBtn.setAttribute('aria-label', '增大字号');
  fontPlusBtn.appendChild(createIcon('plus', 'icon-sm'));

  const syncMenuControls = () => {
    advSwitchInput.checked = settings.showAdvancedByDefault;
    fontValSpan.textContent = `${settings.fontSize}px`;
    fontMinusBtn.disabled = settings.fontSize <= MIN_FONT_SIZE;
    fontPlusBtn.disabled = settings.fontSize >= MAX_FONT_SIZE;
  };
  syncMenuControls();

  const updateFontSize = async (nextSize: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, nextSize));
    settings = { ...settings, fontSize: clamped };
    applyFontSize(clamped);
    syncMenuControls();
    await saveSettings(settings);
  };

  fontMinusBtn.addEventListener('click', () => void updateFontSize(settings.fontSize - 1));
  fontPlusBtn.addEventListener('click', () => void updateFontSize(settings.fontSize + 1));

  fontStepper.append(fontMinusBtn, fontValSpan, fontPlusBtn);
  fontMenuRow.appendChild(fontStepper);

  // Item 4: Snapshots / Profiles
  const profilesMenuBtn = el('button', 'menu-item');
  profilesMenuBtn.type = 'button';
  profilesMenuBtn.append(el('span', undefined, '账号快照'), createIcon('layers', 'icon-sm'));
  profilesMenuBtn.addEventListener('click', async () => {
    closePopovers();
    if (!ctx.isSupported || !hasPermission) return;
    profiles = await loadProfilesForOrigin(ctx.origin);
    setView('profiles');
  });

  // Item 5: All Options
  const optionsMenuBtn = el('button', 'menu-item');
  optionsMenuBtn.type = 'button';
  optionsMenuBtn.append(el('span', undefined, '所有设置'), createIcon('external-link', 'icon-sm'));
  optionsMenuBtn.addEventListener('click', () => {
    closePopovers();
    void ext.openOptionsPage();
  });

  menuPanel.append(
    advMenuLabel,
    maskMenuLabel,
    fontMenuRow,
    el('div', 'menu-divider'),
    profilesMenuBtn,
    optionsMenuBtn,
  );

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenuOpen = false;
    exportPopover.hidden = true;
    menuOpen = !menuOpen;
    menuPanel.hidden = !menuOpen;
    menuBtn.classList.toggle('active', menuOpen);
  });

  titleBar.append(titleLeft, titleRight, menuPanel);

  // ==================== 2. Main Scroll Container ====================
  const mainContainer = el('main', 'main-container');

  // Persistent List View container (so search input keeps focus while filtering)
  const listViewWrap = el('div');

  const searchBarWrap = el('div', 'search-bar-wrap');
  const searchIcon = el('span', 'search-bar-icon');
  searchIcon.appendChild(createIcon('search', 'icon-sm'));

  const searchInput = el('input', 'search-bar-input');
  searchInput.type = 'text';
  searchInput.placeholder = '搜索 Cookie...';
  searchInput.setAttribute('aria-label', '搜索 Cookie');

  const searchClearBtn = el('button', 'round-icon-btn search-bar-clear');
  searchClearBtn.type = 'button';
  searchClearBtn.title = '清除搜索';
  searchClearBtn.setAttribute('aria-label', '清除搜索');
  searchClearBtn.appendChild(createIcon('x', 'icon-sm'));
  searchClearBtn.hidden = true;

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchInput.classList.toggle('has-content', searchQuery.trim().length > 0);
    searchClearBtn.hidden = searchQuery.length === 0;
    renderCookieItems();
  });

  searchClearBtn.addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    searchInput.classList.remove('has-content');
    searchClearBtn.hidden = true;
    searchInput.focus();
    renderCookieItems();
  });

  searchBarWrap.append(searchIcon, searchInput, searchClearBtn);

  const filterStrip = el('div', 'filter-strip');
  const filterDefs: Array<{ id: FilterMode; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'httpOnly', label: 'HttpOnly' },
    { id: 'secure', label: 'Secure' },
    { id: 'session', label: 'Session' },
    { id: 'partitioned', label: 'Partitioned' },
  ];
  const filterButtons = new Map<FilterMode, HTMLButtonElement>();
  for (const def of filterDefs) {
    const btn = el('button', def.id === 'all' ? 'filter-pill active' : 'filter-pill', def.label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      filterMode = def.id;
      for (const [id, b] of filterButtons) {
        b.classList.toggle('active', id === filterMode);
      }
      renderCookieItems();
    });
    filterButtons.set(def.id, btn);
    filterStrip.appendChild(btn);
  }

  const cookieListHost = el('div');
  listViewWrap.append(searchBarWrap, filterStrip, cookieListHost);

  const subviewHost = el('div');
  subviewHost.hidden = true;

  mainContainer.append(listViewWrap, subviewHost);

  // ==================== 3. Anchored Export Popover (Cookie-Editor style) ====================
  const exportPopover = el('div', 'export-popover');
  exportPopover.hidden = true;
  exportPopover.appendChild(el('h3', 'export-popover-title', '导出为'));

  const exportFormats: Array<{ id: ExportFormat; label: string; ext: string }> = [
    { id: 'json', label: 'JSON', ext: 'json' },
    { id: 'header', label: 'Header String', ext: 'txt' },
    { id: 'netscape', label: 'Netscape', ext: 'txt' },
  ];

  for (const fmt of exportFormats) {
    const row = el('div', 'export-format-row');

    const copyFmtBtn = el('button', 'export-format-copy');
    copyFmtBtn.type = 'button';
    copyFmtBtn.append(el('span', undefined, fmt.label), createIcon('copy', 'icon-sm'));
    copyFmtBtn.addEventListener('click', async () => {
      const target = getFilteredCookies();
      const source = target.length > 0 ? target : cookies;
      const output = exportCookies(source, fmt.id);
      const ok = await copyText(output);
      closePopovers();
      showToast(ok ? `已复制 ${source.length} 条 Cookie (${fmt.label})` : '复制失败', !ok);
    });

    const dlBtn = el('button', 'export-format-dl');
    dlBtn.type = 'button';
    dlBtn.title = `下载 ${fmt.label} 文件`;
    dlBtn.setAttribute('aria-label', `下载 ${fmt.label} 文件`);
    dlBtn.appendChild(createIcon('download', 'icon-sm'));
    dlBtn.addEventListener('click', () => {
      const target = getFilteredCookies();
      const source = target.length > 0 ? target : cookies;
      const output = exportCookies(source, fmt.id);
      const safeHost = (ctx.hostname || 'cookies').replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${safeHost}-cookies-${fmt.id}.${fmt.ext}`;
      downloadTextFile(filename, output);
      closePopovers();
      showToast(`已下载 ${filename}`);
    });

    row.append(copyFmtBtn, dlBtn);
    exportPopover.appendChild(row);
  }

  // ==================== 4. Segmented Bottom Footer Bar ====================
  const footerBar = el('footer', 'footer-bar');

  function setFooterActions(actions: FooterAction[]): void {
    footerBar.replaceChildren();
    footerBar.hidden = actions.length === 0;
    actions.forEach((act, idx) => {
      if (idx > 0) {
        footerBar.appendChild(el('div', 'footer-sep'));
      }
      const cls = ['footer-btn'];
      if (act.variant && act.variant !== 'default') cls.push(act.variant);
      const btn = el('button', cls.join(' '));
      btn.type = 'button';
      btn.disabled = Boolean(act.disabled);
      btn.title = act.label;

      const iconSpan = el('span', 'footer-btn-icon');
      iconSpan.appendChild(createIcon(act.icon));
      const labelSpan = el('span', 'footer-btn-label', act.label);
      btn.append(iconSpan, labelSpan);
      btn.addEventListener('click', act.onClick);
      footerBar.appendChild(btn);
    });
  }

  // ==================== 5. Toast Notification ====================
  const toastWrap = el('div', 'notification-wrap');
  toastWrap.hidden = true;
  const toastPill = el('div', 'notification-pill');
  const toastText = el('span');
  const toastCloseBtn = el('button', 'notification-dismiss');
  toastCloseBtn.type = 'button';
  toastCloseBtn.setAttribute('aria-label', '关闭提示');
  toastCloseBtn.appendChild(createIcon('x', 'icon-sm'));
  toastCloseBtn.addEventListener('click', () => {
    toastWrap.hidden = true;
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
  });
  toastPill.append(toastText, toastCloseBtn);
  toastWrap.appendChild(toastPill);

  shell.append(titleBar, mainContainer, exportPopover, footerBar, toastWrap);
  root.replaceChildren(shell);

  // Sync settings live across Popup, SidePanel, DevTools, Options
  onSettingsChanged((next) => {
    settings = next;
    applyTheme(next.theme);
    applyFontSize(next.fontSize);
    syncMenuControls();
    if (activeView === 'list') renderCookieItems();
  });

  function closePopovers(): void {
    menuOpen = false;
    exportMenuOpen = false;
    menuPanel.hidden = true;
    exportPopover.hidden = true;
    menuBtn.classList.remove('active');
  }

  document.addEventListener('click', (e) => {
    const target = e.target as Node | null;
    if (menuOpen && target && !menuPanel.contains(target) && !menuBtn.contains(target)) {
      menuOpen = false;
      menuPanel.hidden = true;
      menuBtn.classList.remove('active');
    }
    if (exportMenuOpen && target && !exportPopover.contains(target) && !footerBar.contains(target)) {
      exportMenuOpen = false;
      exportPopover.hidden = true;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (menuOpen || exportMenuOpen) {
        closePopovers();
      } else if (activeView !== 'list') {
        setView('list');
      }
    }
  });

  function showToast(message: string, isError = false): void {
    toastText.textContent = message;
    toastPill.className = isError ? 'notification-pill is-error' : 'notification-pill';
    toastWrap.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastWrap.hidden = true;
      toastTimer = null;
    }, 2600);
  }

  function getFilteredCookies(): CookieItem[] {
    const q = searchQuery.trim().toLowerCase();
    return cookies.filter((c) => {
      if (filterMode === 'httpOnly' && !c.httpOnly) return false;
      if (filterMode === 'secure' && !c.secure) return false;
      if (filterMode === 'session' && !c.session) return false;
      if (filterMode === 'partitioned' && !c.partitionKey?.topLevelSite) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q) ||
        c.domain.toLowerCase().includes(q)
      );
    });
  }

  function setView(view: ActiveView): void {
    closePopovers();
    activeView = view;
    if (view === 'list') {
      listViewWrap.hidden = false;
      subviewHost.hidden = true;
      subviewHost.replaceChildren();
      renderListContent();
    } else {
      listViewWrap.hidden = true;
      subviewHost.hidden = false;
      renderSubview(view);
    }
  }

  // ==================== List View Renderer ====================
  function renderListContent(): void {
    const canOperate = ctx.isSupported && hasPermission;
    profilesMenuBtn.disabled = !canOperate;

    if (!ctx.isSupported) {
      hostSub.textContent = '';
      countLabel.hidden = true;
      searchBarWrap.hidden = true;
      filterStrip.hidden = true;
      setFooterActions([]);

      const box = el('div', 'center-state');
      box.append(
        createIcon('cookie', 'icon-lg'),
        el('h2', 'state-title', '当前页面不支持 Cookie'),
        el('p', 'state-desc', '请切换到 http 或 https 网页后再查看。'),
      );
      cookieListHost.replaceChildren(box);
      return;
    }

    hostSub.textContent = ctx.hostname;
    hostSub.title = ctx.origin;

    if (!hasPermission) {
      countLabel.hidden = true;
      searchBarWrap.hidden = true;
      filterStrip.hidden = true;
      setFooterActions([]);

      const box = el('div', 'center-state');
      const actions = el('div', 'state-actions');

      const thisSiteBtn = el('button', 'btn btn-primary', '授权此站点');
      thisSiteBtn.type = 'button';
      thisSiteBtn.addEventListener('click', async () => {
        const ok = await requestPermissionForOrigin(ctx.url);
        if (ok) {
          hasPermission = true;
          await reloadCookies();
        }
      });

      const allSitesBtn = el('button', 'btn', '授予全部站点');
      allSitesBtn.type = 'button';
      allSitesBtn.addEventListener('click', async () => {
        const ok = await requestAllSitesPermission();
        if (ok) {
          hasPermission = true;
          await reloadCookies();
        }
      });

      actions.append(thisSiteBtn, allSitesBtn);
      box.append(
        createIcon('shield', 'icon-lg'),
        el('h2', 'state-title', `需要 ${ctx.hostname} 的站点权限`),
        el('p', 'state-desc', '默认不请求全网权限。授权后才能读写此站点 Cookie，随时可在设置中收回。'),
        actions,
      );
      cookieListHost.replaceChildren(box);
      return;
    }

    searchBarWrap.hidden = cookies.length === 0;
    filterStrip.hidden = cookies.length === 0;

    // Show Partitioned filter pill only when partitioned cookies exist
    const partBtn = filterButtons.get('partitioned');
    if (partBtn) {
      const hasPartitioned = cookies.some((c) => Boolean(c.partitionKey?.topLevelSite));
      partBtn.hidden = !hasPartitioned;
      if (!hasPartitioned && filterMode === 'partitioned') {
        filterMode = 'all';
        filterButtons.get('all')?.classList.add('active');
        partBtn.classList.remove('active');
      }
    }

    renderCookieItems();

    setFooterActions([
      {
        icon: 'plus',
        label: '新建',
        onClick: () => setView('add'),
      },
      {
        icon: 'trash',
        label: '清空',
        variant: 'danger',
        disabled: cookies.length === 0,
        onClick: () => setView('clear'),
      },
      {
        icon: 'upload',
        label: '导入',
        onClick: () => setView('import'),
      },
      {
        icon: 'download',
        label: '导出',
        disabled: cookies.length === 0,
        onClick: () => {
          menuOpen = false;
          menuPanel.hidden = true;
          menuBtn.classList.remove('active');
          exportMenuOpen = !exportMenuOpen;
          exportPopover.hidden = !exportMenuOpen;
        },
      },
    ]);
  }

  function renderCookieItems(): void {
    const filtered = getFilteredCookies();
    countLabel.hidden = false;
    countLabel.textContent =
      filtered.length === cookies.length
        ? `${cookies.length} 条`
        : `${filtered.length}/${cookies.length}`;

    if (cookies.length === 0) {
      const box = el('div', 'center-state');
      const addBtn = el('button', 'btn btn-primary', '新建 Cookie');
      addBtn.type = 'button';
      addBtn.addEventListener('click', () => setView('add'));
      box.append(el('h2', 'state-title', '此页面没有 Cookie'), addBtn);
      cookieListHost.replaceChildren(box);
      return;
    }

    if (filtered.length === 0) {
      const box = el('div', 'center-state');
      const resetBtn = el('button', 'btn', '清除筛选');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', () => {
        searchQuery = '';
        searchInput.value = '';
        searchInput.classList.remove('has-content');
        searchClearBtn.hidden = true;
        filterMode = 'all';
        for (const [id, b] of filterButtons) {
          b.classList.toggle('active', id === 'all');
        }
        renderCookieItems();
      });
      box.append(el('h2', 'state-title', '没有匹配的 Cookie'), resetBtn);
      cookieListHost.replaceChildren(box);
      return;
    }

    const ul = el('ul', 'cookie-list');
    for (const cookie of filtered) {
      const key = cookieIdentityKey(cookie);
      const li = renderCookieRow(
        cookie,
        {
          expanded: expandedKey === key,
          masked,
          showAdvancedDefault: settings.showAdvancedByDefault,
          justSaved: justSavedKey === key,
        },
        {
          onToggleExpand: () => {
            expandedKey = expandedKey === key ? null : key;
            renderCookieItems();
          },
          onSave: async (draft, prev) => {
            const saved = await saveCookie(draft, ctx, prev);
            const newKey = cookieIdentityKey(saved);
            expandedKey = newKey;
            justSavedKey = newKey;
            await reloadCookies();
            showToast(`已保存 ${saved.name}`);
            window.setTimeout(() => {
              if (justSavedKey === newKey) justSavedKey = null;
            }, 650);
          },
          onDelete: async (target) => {
            await deleteCookie(target, ctx.protocol);
            if (expandedKey === key) expandedKey = null;
            await reloadCookies();
            showToast(`已删除 ${target.name}`);
          },
          onToast: showToast,
        },
      );
      ul.appendChild(li);
    }

    cookieListHost.replaceChildren(ul);
  }

  // ==================== Subview Renderers (Add / Import / Profiles / Clear) ====================
  function renderSubview(view: Exclude<ActiveView, 'list'>): void {
    subviewHost.replaceChildren();

    if (view === 'add') {
      const pane = el('form', 'subview-pane');
      pane.appendChild(el('h2', 'subview-title', '新建 Cookie'));

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
      valueInput.rows = 4;
      valueField.appendChild(valueInput);

      let advOpen = settings.showAdvancedByDefault;
      const advToggle = el(
        'button',
        'advanced-toggle-btn',
        advOpen ? '隐藏高级选项' : '显示高级选项',
      );
      advToggle.type = 'button';

      const advSec = el('div', 'advanced-section');
      advSec.hidden = !advOpen;
      advToggle.addEventListener('click', () => {
        advOpen = !advOpen;
        advSec.hidden = !advOpen;
        advToggle.textContent = advOpen ? '隐藏高级选项' : '显示高级选项';
      });

      const grid1 = el('div', 'form-grid-2');
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

      const grid2 = el('div', 'form-grid-2');
      const expField = el('div', 'field');
      expField.appendChild(el('label', 'field-label', '过期时间'));
      const expInput = el('input', 'input');
      expInput.type = 'datetime-local';
      expInput.value = epochToDateTimeLocal(Math.floor(Date.now() / 1000) + 30 * 86400);
      expField.appendChild(expInput);

      const sameSiteField = el('div', 'field');
      sameSiteField.appendChild(el('label', 'field-label', 'SameSite'));
      const sameSiteSelect = el('select', 'select');
      for (const [val, label] of [
        ['lax', 'Lax'],
        ['strict', 'Strict'],
        ['no_restriction', 'None'],
        ['unspecified', 'Unspecified'],
      ] as const) {
        const o = el('option', undefined, label);
        o.value = val;
        sameSiteSelect.appendChild(o);
      }
      sameSiteField.appendChild(sameSiteSelect);
      grid2.append(expField, sameSiteField);

      const cbList = el('div', 'checkbox-list');
      const mkCheck = (label: string, checked: boolean) => {
        const w = el('label', 'checkbox-item');
        const c = el('input');
        c.type = 'checkbox';
        c.checked = checked;
        w.append(c, el('span', undefined, label));
        return { w, c };
      };
      const hostOnlyCtl = mkCheck('HostOnly', true);
      const sessionCtl = mkCheck('Session', false);
      const secureCtl = mkCheck('Secure', ctx.protocol === 'https:');
      const httpOnlyCtl = mkCheck('HttpOnly', false);

      sessionCtl.c.addEventListener('change', () => {
        expInput.disabled = sessionCtl.c.checked;
      });
      sameSiteSelect.addEventListener('change', () => {
        if (sameSiteSelect.value === 'no_restriction') secureCtl.c.checked = true;
      });

      cbList.append(hostOnlyCtl.w, sessionCtl.w, secureCtl.w, httpOnlyCtl.w);
      advSec.append(grid1, grid2, cbList);

      const errorBox = el('div', 'inline-error');
      errorBox.hidden = true;

      const handleCreate = async () => {
        errorBox.hidden = true;
        const isSession = sessionCtl.c.checked;
        const draft: CookieDraft = {
          name: nameInput.value.trim(),
          value: valueInput.value,
          domain: domainInput.value.trim(),
          path: pathInput.value.trim() || '/',
          hostOnly: hostOnlyCtl.c.checked,
          session: isSession,
          httpOnly: httpOnlyCtl.c.checked,
          secure: secureCtl.c.checked,
          sameSite: sameSiteSelect.value as SameSiteStatus,
          expirationDate: isSession ? undefined : dateTimeLocalToEpoch(expInput.value),
          storeId: ctx.cookieStoreId,
        };
        try {
          const saved = await saveCookie(draft, ctx);
          expandedKey = cookieIdentityKey(saved);
          justSavedKey = expandedKey;
          await reloadCookies();
          setView('list');
          showToast(`已新建 ${saved.name}`);
        } catch (err) {
          errorBox.textContent = err instanceof Error ? err.message : '保存失败';
          errorBox.hidden = false;
        }
      };

      pane.addEventListener('submit', (e) => {
        e.preventDefault();
        void handleCreate();
      });

      pane.append(nameField, valueField, advToggle, advSec, errorBox);
      subviewHost.appendChild(pane);

      setFooterActions([
        { icon: 'arrow-left', label: '取消', onClick: () => setView('list') },
        { icon: 'save', label: '保存', variant: 'primary', onClick: () => void handleCreate() },
      ]);
      queueMicrotask(() => nameInput.focus());
      return;
    }

    if (view === 'import') {
      const pane = el('div', 'subview-pane');
      pane.appendChild(el('h2', 'subview-title', '导入 Cookie'));

      let mode: ExportFormat | 'auto' = 'auto';
      const pills = el('div', 'format-pills');
      const modes: Array<{ id: ExportFormat | 'auto'; label: string }> = [
        { id: 'auto', label: '自动识别' },
        { id: 'json', label: 'JSON' },
        { id: 'header', label: 'Header' },
        { id: 'netscape', label: 'Netscape' },
      ];
      const modeBtns: HTMLButtonElement[] = [];
      for (const m of modes) {
        const b = el('button', m.id === 'auto' ? 'filter-pill active' : 'filter-pill', m.label);
        b.type = 'button';
        b.dataset.mode = m.id;
        b.addEventListener('click', () => {
          mode = m.id;
          for (const item of modeBtns) {
            item.classList.toggle('active', item.dataset.mode === mode);
          }
        });
        modeBtns.push(b);
        pills.appendChild(b);
      }

      const textarea = el('textarea', 'textarea import-textarea');
      textarea.placeholder =
        'JSON:\n[{"name":"sid","value":"abc"}]\n\nHeader String:\nsid=abc; theme=dark\n\nNetscape:\n# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tsid\tabc';

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

      pane.append(pills, textarea, fileInput, errorBox);
      subviewHost.appendChild(pane);

      const handleImport = async () => {
        errorBox.hidden = true;
        try {
          const parsed = parseCookies(textarea.value, mode, ctx.url);
          if (parsed.cookies.length === 0) {
            throw new Error('未解析出可导入的 Cookie');
          }
          const res = await importCookiesForTab(parsed.cookies, ctx);
          if (res.failed.length > 0 && res.imported === 0) {
            const first = res.failed[0];
            throw new Error(`${first?.name ?? 'Cookie'}: ${first?.reason ?? '写入失败'}`);
          }
          await reloadCookies();
          setView('list');
          const msg =
            res.failed.length > 0
              ? `已导入 ${res.imported} 条，失败 ${res.failed.length} 条`
              : `已导入 ${res.imported} 条 Cookie`;
          showToast(msg, res.failed.length > 0);
        } catch (err) {
          errorBox.textContent = err instanceof Error ? err.message : '导入失败';
          errorBox.hidden = false;
        }
      };

      setFooterActions([
        { icon: 'arrow-left', label: '返回', onClick: () => setView('list') },
        { icon: 'file', label: '选择文件', onClick: () => fileInput.click() },
        { icon: 'upload', label: '导入', variant: 'primary', onClick: () => void handleImport() },
      ]);
      queueMicrotask(() => textarea.focus());
      return;
    }

    if (view === 'profiles') {
      const pane = el('div', 'subview-pane');
      pane.append(
        el('h2', 'subview-title', `账号快照 · ${ctx.hostname}`),
        el('p', 'subview-desc', '将当前站点的整套 Cookie 存在本地，切换测试账号时一键恢复。'),
      );

      const createForm = el('form', 'profile-create-form');
      const nameInput = el('input', 'input');
      nameInput.type = 'text';
      nameInput.placeholder = '输入快照名称，例如 管理员';
      nameInput.required = true;

      const saveBtn = el('button', 'btn btn-primary', '保存快照');
      saveBtn.type = 'submit';
      saveBtn.disabled = cookies.length === 0;

      const errorBox = el('div', 'inline-error');
      errorBox.hidden = true;

      createForm.append(nameInput, saveBtn);
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        try {
          await saveProfile(ctx.origin, nameInput.value, cookies);
          profiles = await loadProfilesForOrigin(ctx.origin);
          showToast(`已保存快照「${nameInput.value.trim()}」`);
          renderSubview('profiles');
        } catch (err) {
          errorBox.textContent = err instanceof Error ? err.message : '保存失败';
          errorBox.hidden = false;
        }
      });

      const list = el('div', 'profile-list');
      if (profiles.length === 0) {
        list.appendChild(el('p', 'subview-desc', '此站点还没有保存快照'));
      } else {
        for (const p of profiles) {
          const row = el('div', 'profile-row');
          const info = el('div', 'profile-info');
          info.appendChild(el('span', 'profile-name', p.name));
          const dt = new Date(p.savedAt).toLocaleString('zh-CN', { hour12: false });
          info.appendChild(el('span', 'profile-meta', `${p.cookies.length} 条 · ${dt}`));

          const btns = el('div', 'profile-btns');
          const applyBtn = el('button', 'btn btn-sm btn-primary', '应用');
          applyBtn.type = 'button';
          applyBtn.addEventListener('click', async () => {
            await clearCookiesForTab(ctx);
            const drafts: CookieDraft[] = p.cookies.map((c) => ({
              ...c,
              storeId: ctx.cookieStoreId,
            }));
            const res = await importCookiesForTab(drafts, ctx);
            await reloadCookies();
            setView('list');
            showToast(`已应用「${p.name}」(${res.imported} 条)`);
          });

          const delBtn = el('button', 'btn btn-sm btn-danger', '删除');
          delBtn.type = 'button';
          delBtn.addEventListener('click', async () => {
            await deleteProfile(p.id);
            profiles = await loadProfilesForOrigin(ctx.origin);
            renderSubview('profiles');
          });

          btns.append(applyBtn, delBtn);
          row.append(info, btns);
          list.appendChild(row);
        }
      }

      pane.append(createForm, errorBox, list);
      subviewHost.appendChild(pane);

      setFooterActions([{ icon: 'arrow-left', label: '返回列表', onClick: () => setView('list') }]);
      return;
    }

    if (view === 'clear') {
      const box = el('div', 'center-state');
      box.append(
        createIcon('trash', 'icon-lg'),
        el('h2', 'state-title', '清空全部 Cookie？'),
        el(
          'p',
          'state-desc',
          `将删除 ${ctx.hostname} 的 ${cookies.length} 条 Cookie，当前登录状态会失效，操作无法撤回。`,
        ),
      );
      subviewHost.appendChild(box);

      setFooterActions([
        { icon: 'arrow-left', label: '取消', onClick: () => setView('list') },
        {
          icon: 'trash',
          label: '清空全部',
          variant: 'danger-solid',
          onClick: async () => {
            const removed = await clearCookiesForTab(ctx);
            await reloadCookies();
            setView('list');
            showToast(`已清空 ${removed} 条 Cookie`);
          },
        },
      ]);
    }
  }

  // ==================== Data & Tab Lifecycle ====================
  async function reloadCookies(): Promise<void> {
    if (!ctx.isSupported || !hasPermission) {
      cookies = [];
      if (activeView === 'list') renderListContent();
      return;
    }
    try {
      cookies = await listCookiesForTab(ctx);
    } catch {
      cookies = [];
      showToast('读取 Cookie 失败', true);
    }
    if (activeView === 'list') renderListContent();
  }

  async function resolveCurrentTab(): Promise<TabContext> {
    if (surface === 'devtools' && ext.raw.devtools?.inspectedWindow) {
      const tabId = ext.raw.devtools.inspectedWindow.tabId;
      const tab = await ext.getTab(tabId);
      return parseTabContext(tab);
    }
    const tab = await ext.getActiveTab();
    return parseTabContext(tab ?? {});
  }

  async function refreshCurrentTab(): Promise<void> {
    ctx = await resolveCurrentTab();
    expandedKey = null;
    hasPermission = ctx.isSupported ? await hasPermissionForUrl(ctx.url) : false;
    activeView = 'list';
    listViewWrap.hidden = false;
    subviewHost.hidden = true;
    subviewHost.replaceChildren();
    await reloadCookies();
  }

  if (surface === 'sidepanel') {
    ext.raw.tabs.onActivated.addListener(() => {
      closePopovers();
      void refreshCurrentTab();
    });
    ext.raw.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (tabId === ctx.tabId && (changeInfo.url || changeInfo.status === 'complete')) {
        void refreshCurrentTab();
      }
    });
  } else if (surface === 'devtools') {
    ext.raw.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (tabId === ctx.tabId && (changeInfo.url || changeInfo.status === 'complete')) {
        void refreshCurrentTab();
      }
    });
  }

  await refreshCurrentTab();
}
