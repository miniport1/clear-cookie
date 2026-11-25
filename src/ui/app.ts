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
import {
  hasPermissionForUrl,
  requestAllSitesPermission,
  requestPermissionForOrigin,
} from '../shared/permissions';
import {
  deleteProfile,
  loadProfilesForOrigin,
  loadSettings,
  saveProfile,
} from '../shared/storage';
import { applyTheme } from '../shared/theme';
import type {
  AppSurface,
  CookieDraft,
  CookieItem,
  CookieProfile,
  ExtensionSettings,
  TabContext,
} from '../shared/types';
import { el } from './dom';
import { createIcon } from './icons';
import { renderCookieCard } from './render-cookie-card';
import {
  renderAddCookieModal,
  renderClearConfirmModal,
  renderExportModal,
  renderImportModal,
  renderProfilesModal,
} from './render-modals';

type FilterMode = 'all' | 'httpOnly' | 'secure' | 'session' | 'partitioned';
type ActiveModal = 'none' | 'add' | 'export' | 'import' | 'profiles' | 'clear';

export async function mountCookieApp(root: HTMLElement, surface: AppSurface): Promise<void> {
  document.body.className = `surface-${surface}`;

  const settings: ExtensionSettings = await loadSettings();
  applyTheme(settings.theme);

  let ctx: TabContext = parseTabContext({});
  let hasPermission = false;
  let cookies: CookieItem[] = [];
  let profiles: CookieProfile[] = [];
  let searchQuery = '';
  let filterMode: FilterMode = 'all';
  let masked = settings.maskValuesByDefault;
  let expandedKey: string | null = null;
  let activeModal: ActiveModal = 'none';
  let toastTimer: number | null = null;

  // Persistent layout skeleton (so search input never loses focus on list re-renders)
  const shell = el('div', 'app-shell');

  // 1. Header
  const header = el('header', 'app-header');
  const brandMeta = el('div', 'brand-meta');
  const brandMark = el('div', 'brand-mark');
  brandMark.appendChild(createIcon('cookie'));

  const hostInfo = el('div', 'host-info');
  const hostTitle = el('span', 'host-title', 'ClearCookie');
  const countPill = el('span', 'count-pill', '0');
  countPill.hidden = true;
  hostInfo.append(hostTitle, countPill);
  brandMeta.append(brandMark, hostInfo);

  const headerActions = el('div', 'header-actions');

  const maskBtn = el('button', 'icon-btn');
  maskBtn.type = 'button';
  const updateMaskButton = () => {
    maskBtn.replaceChildren(createIcon(masked ? 'eye-off' : 'eye'));
    maskBtn.classList.toggle('active', masked);
    maskBtn.title = masked ? '取消遮罩' : '遮罩值';
    maskBtn.setAttribute('aria-label', maskBtn.title);
  };
  updateMaskButton();
  maskBtn.addEventListener('click', () => {
    masked = !masked;
    updateMaskButton();
    renderList();
  });

  const profilesBtn = el('button', 'icon-btn');
  profilesBtn.type = 'button';
  profilesBtn.title = '快照';
  profilesBtn.setAttribute('aria-label', '快照');
  profilesBtn.appendChild(createIcon('layers'));
  profilesBtn.addEventListener('click', async () => {
    if (!ctx.isSupported || !hasPermission) return;
    profiles = await loadProfilesForOrigin(ctx.origin);
    openModal('profiles');
  });

  const refreshBtn = el('button', 'icon-btn');
  refreshBtn.type = 'button';
  refreshBtn.title = '刷新';
  refreshBtn.setAttribute('aria-label', '刷新');
  refreshBtn.appendChild(createIcon('refresh'));
  refreshBtn.addEventListener('click', () => {
    void refreshCurrentTab();
  });

  const settingsBtn = el('button', 'icon-btn');
  settingsBtn.type = 'button';
  settingsBtn.title = '设置';
  settingsBtn.setAttribute('aria-label', '设置');
  settingsBtn.appendChild(createIcon('settings'));
  settingsBtn.addEventListener('click', () => {
    void ext.openOptionsPage();
  });

  headerActions.append(maskBtn, profilesBtn, refreshBtn, settingsBtn);
  header.append(brandMeta, headerActions);

  // 2. Search & Filter Toolbar
  const toolbar = el('div', 'toolbar');
  const searchBox = el('div', 'search-box');
  const searchIconWrap = el('span', 'search-icon');
  searchIconWrap.appendChild(createIcon('search', 'icon-sm'));

  const searchInput = el('input', 'search-input');
  searchInput.type = 'text';
  searchInput.placeholder = '搜索名称、值或 Domain';
  searchInput.setAttribute('aria-label', '搜索 Cookie');

  const clearSearchBtn = el('button', 'icon-btn search-clear');
  clearSearchBtn.type = 'button';
  clearSearchBtn.title = '清除搜索';
  clearSearchBtn.setAttribute('aria-label', '清除搜索');
  clearSearchBtn.appendChild(createIcon('x', 'icon-sm'));
  clearSearchBtn.hidden = true;

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    clearSearchBtn.hidden = searchQuery.length === 0;
    renderList();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    clearSearchBtn.hidden = true;
    searchInput.focus();
    renderList();
  });

  searchBox.append(searchIconWrap, searchInput, clearSearchBtn);

  const filterRow = el('div', 'filter-row');
  const filterDefs: Array<{ id: FilterMode; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'httpOnly', label: 'HttpOnly' },
    { id: 'secure', label: 'Secure' },
    { id: 'session', label: 'Session' },
    { id: 'partitioned', label: 'Partitioned' },
  ];
  const filterButtons = new Map<FilterMode, HTMLButtonElement>();
  for (const def of filterDefs) {
    const btn = el('button', def.id === 'all' ? 'filter-chip active' : 'filter-chip', def.label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      filterMode = def.id;
      for (const [id, b] of filterButtons) {
        b.classList.toggle('active', id === filterMode);
      }
      renderList();
    });
    filterButtons.set(def.id, btn);
    filterRow.appendChild(btn);
  }

  toolbar.append(searchBox, filterRow);

  // 3. Main Scroll Container
  const mainContent = el('main', 'main-content');

  // 4. Bottom Action Bar
  const bottomBar = el('footer', 'bottom-bar');
  const leftGroup = el('div', 'bottom-bar-group');
  const rightGroup = el('div', 'bottom-bar-group');

  const addBtn = el('button', 'btn btn-primary');
  addBtn.type = 'button';
  addBtn.append(createIcon('plus', 'icon-sm'), el('span', undefined, '新建 Cookie'));
  addBtn.addEventListener('click', () => openModal('add'));

  const importBtn = el('button', 'btn');
  importBtn.type = 'button';
  importBtn.append(createIcon('upload', 'icon-sm'), el('span', undefined, '导入'));
  importBtn.addEventListener('click', () => openModal('import'));

  const exportBtn = el('button', 'btn');
  exportBtn.type = 'button';
  exportBtn.append(createIcon('download', 'icon-sm'), el('span', undefined, '导出'));
  exportBtn.addEventListener('click', () => openModal('export'));

  const clearBtn = el('button', 'btn btn-danger');
  clearBtn.type = 'button';
  clearBtn.append(createIcon('trash', 'icon-sm'), el('span', undefined, '清空全部'));
  clearBtn.addEventListener('click', () => openModal('clear'));

  leftGroup.append(addBtn, importBtn, exportBtn);
  rightGroup.append(clearBtn);
  bottomBar.append(leftGroup, rightGroup);

  // 5. Modal Host & Toast
  const modalHost = el('div');
  const toastEl = el('div', 'toast');
  toastEl.hidden = true;

  shell.append(header, toolbar, mainContent, bottomBar, modalHost, toastEl);
  root.replaceChildren(shell);

  function showToast(message: string, isError = false): void {
    toastEl.textContent = message;
    toastEl.className = isError ? 'toast toast-error' : 'toast';
    toastEl.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
      toastTimer = null;
    }, 2400);
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

  function closeModal(): void {
    activeModal = 'none';
    modalHost.replaceChildren();
  }

  function openModal(kind: ActiveModal): void {
    activeModal = kind;
    renderModal();
  }

  function renderModal(): void {
    modalHost.replaceChildren();
    if (activeModal === 'none') return;

    if (activeModal === 'add') {
      modalHost.appendChild(
        renderAddCookieModal(
          ctx,
          async (draft: CookieDraft) => {
            await saveCookie(draft, ctx);
            await reloadCookies();
          },
          closeModal,
        ),
      );
    } else if (activeModal === 'export') {
      const targetList = getFilteredCookies();
      modalHost.appendChild(
        renderExportModal(
          targetList.length > 0 ? targetList : cookies,
          ctx.hostname,
          settings.defaultExportFormat,
          showToast,
          closeModal,
        ),
      );
    } else if (activeModal === 'import') {
      modalHost.appendChild(
        renderImportModal(
          ctx,
          async (drafts) => {
            const res = await importCookiesForTab(drafts, ctx);
            await reloadCookies();
            return res;
          },
          showToast,
          closeModal,
        ),
      );
    } else if (activeModal === 'profiles') {
      modalHost.appendChild(
        renderProfilesModal(
          ctx.hostname,
          cookies.length,
          profiles,
          {
            onSaveProfile: async (name) => {
              await saveProfile(ctx.origin, name, cookies);
              profiles = await loadProfilesForOrigin(ctx.origin);
              showToast(`已保存快照「${name.trim()}」`);
              renderModal();
            },
            onApplyProfile: async (profile) => {
              await clearCookiesForTab(ctx);
              const drafts: CookieDraft[] = profile.cookies.map((c) => ({
                ...c,
                storeId: ctx.cookieStoreId,
              }));
              const res = await importCookiesForTab(drafts, ctx);
              await reloadCookies();
              showToast(`已应用「${profile.name}」(${res.imported} 条)`);
            },
            onDeleteProfile: async (id) => {
              await deleteProfile(id);
              profiles = await loadProfilesForOrigin(ctx.origin);
              renderModal();
            },
          },
          closeModal,
        ),
      );
    } else if (activeModal === 'clear') {
      modalHost.appendChild(
        renderClearConfirmModal(
          ctx.hostname,
          cookies.length,
          async () => {
            const removed = await clearCookiesForTab(ctx);
            await reloadCookies();
            showToast(`已清空 ${removed} 条 Cookie`);
          },
          closeModal,
        ),
      );
    }
  }

  function renderList(): void {
    mainContent.replaceChildren();

    const canOperate = ctx.isSupported && hasPermission;
    toolbar.hidden = !canOperate || cookies.length === 0;
    bottomBar.hidden = !canOperate;
    profilesBtn.disabled = !canOperate;

    // Show Partitioned filter pill only when partitioned cookies exist
    const partitionedBtn = filterButtons.get('partitioned');
    if (partitionedBtn) {
      const hasPartitioned = cookies.some((c) => Boolean(c.partitionKey?.topLevelSite));
      partitionedBtn.hidden = !hasPartitioned;
      if (!hasPartitioned && filterMode === 'partitioned') {
        filterMode = 'all';
        filterButtons.get('all')?.classList.add('active');
        partitionedBtn.classList.remove('active');
      }
    }

    if (!ctx.isSupported) {
      hostTitle.textContent = 'ClearCookie';
      countPill.hidden = true;
      const box = el('div', 'center-state');
      const iconWrap = el('div', 'state-icon');
      iconWrap.appendChild(createIcon('cookie', 'icon-lg'));
      box.append(
        iconWrap,
        el('h2', 'state-title', '当前页面不支持 Cookie'),
        el('p', 'state-desc', '请切换到 http 或 https 网页后再查看。'),
      );
      mainContent.appendChild(box);
      return;
    }

    hostTitle.textContent = ctx.hostname;
    hostTitle.title = ctx.origin;

    if (!hasPermission) {
      countPill.hidden = true;
      const box = el('div', 'center-state');
      const iconWrap = el('div', 'state-icon accent');
      iconWrap.appendChild(createIcon('shield', 'icon-lg'));

      const actions = el('div', 'state-actions');
      const originBtn = el('button', 'btn btn-primary', '授权此站点');
      originBtn.type = 'button';
      originBtn.addEventListener('click', async () => {
        const granted = await requestPermissionForOrigin(ctx.url);
        if (granted) {
          hasPermission = true;
          await reloadCookies();
        }
      });

      const allBtn = el('button', 'btn', '授予全部站点');
      allBtn.type = 'button';
      allBtn.addEventListener('click', async () => {
        const granted = await requestAllSitesPermission();
        if (granted) {
          hasPermission = true;
          await reloadCookies();
        }
      });

      actions.append(originBtn, allBtn);
      box.append(
        iconWrap,
        el('h2', 'state-title', `需要 ${ctx.hostname} 的站点权限`),
        el('p', 'state-desc', '默认不请求全网权限。授权后才能读写此站点的 Cookie，随时可在设置中收回。'),
        actions,
      );
      mainContent.appendChild(box);
      return;
    }

    const filtered = getFilteredCookies();
    countPill.hidden = false;
    countPill.textContent =
      filtered.length === cookies.length
        ? String(cookies.length)
        : `${filtered.length}/${cookies.length}`;

    exportBtn.disabled = cookies.length === 0;
    clearBtn.disabled = cookies.length === 0;

    if (cookies.length === 0) {
      const box = el('div', 'center-state');
      const iconWrap = el('div', 'state-icon');
      iconWrap.appendChild(createIcon('cookie', 'icon-lg'));
      const createBtn = el('button', 'btn btn-primary', '新建 Cookie');
      createBtn.type = 'button';
      createBtn.addEventListener('click', () => openModal('add'));
      box.append(iconWrap, el('h2', 'state-title', '此站点没有 Cookie'), createBtn);
      mainContent.appendChild(box);
      return;
    }

    if (filtered.length === 0) {
      const box = el('div', 'center-state');
      const resetBtn = el('button', 'btn', '清除筛选');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', () => {
        searchQuery = '';
        searchInput.value = '';
        clearSearchBtn.hidden = true;
        filterMode = 'all';
        for (const [id, b] of filterButtons) {
          b.classList.toggle('active', id === 'all');
        }
        renderList();
      });
      box.append(el('h2', 'state-title', '没有匹配的 Cookie'), resetBtn);
      mainContent.appendChild(box);
      return;
    }

    for (const cookie of filtered) {
      const key = cookieIdentityKey(cookie);
      const isExpanded = expandedKey === key;
      const card = renderCookieCard(cookie, isExpanded, masked, {
        onToggleExpand: () => {
          expandedKey = expandedKey === key ? null : key;
          renderList();
        },
        onSave: async (draft, prev) => {
          const saved = await saveCookie(draft, ctx, prev);
          expandedKey = cookieIdentityKey(saved);
          await reloadCookies();
          showToast(`已保存 ${saved.name}`);
        },
        onDelete: async (target) => {
          await deleteCookie(target, ctx.protocol);
          if (expandedKey === key) expandedKey = null;
          await reloadCookies();
        },
        onToast: showToast,
      });
      mainContent.appendChild(card);
    }
  }

  async function reloadCookies(): Promise<void> {
    if (!ctx.isSupported || !hasPermission) {
      cookies = [];
      renderList();
      return;
    }
    try {
      cookies = await listCookiesForTab(ctx);
    } catch {
      cookies = [];
      showToast('读取 Cookie 失败', true);
    }
    renderList();
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
    await reloadCookies();
  }

  // Keep SidePanel / DevTools synced when switching tabs or navigating
  if (surface === 'sidepanel') {
    ext.raw.tabs.onActivated.addListener(() => {
      closeModal();
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeModal !== 'none') {
      closeModal();
    }
  });

  await refreshCurrentTab();
}
