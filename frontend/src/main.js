// ===== Wails Bindings =====
import * as App from '../wailsjs/go/main/App';
import * as Service from '../wailsjs/go/main/Service';
import * as Runtime from '../wailsjs/runtime/runtime';

// ===== Tab Navigation with Slide Transition =====
let currentTab = 'dashboard';

function switchTab(tab) {
    if (tab === currentTab) return;

    // Animate out old tab
    const oldTab = document.getElementById(`tab-${currentTab}`);
    if (oldTab) {
        oldTab.classList.remove('active');
    }

    // Animate in new tab
    const newTab = document.getElementById(`tab-${tab}`);
    if (newTab) {
        newTab.classList.add('active');
    }

    // Update nav buttons
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const navBtn = document.querySelector(`[data-tab="${tab}"]`);
    if (navBtn) navBtn.classList.add('active');

    currentTab = tab;

    // Load data for the tab (uses cache, refreshes in background)
    if (tab === 'dashboard') refreshDashboard();
    else if (tab === 'installed') loadInstalled(tab);
    else if (tab === 'outdated') loadOutdated();
    else if (tab === 'services') loadServices();
    else if (tab === 'taps') loadTaps();
    else if (tab === 'dependencies') {
        // Dependencies tab doesn't auto-load, waits for user input
    }
    else if (tab === 'search') {
        // Focus the search input once the tab transition finishes
        setTimeout(() => {
            const input = document.getElementById('search-input');
            if (input) input.focus();
        }, 160);
    }
    else if (tab === 'config') loadConfig();
}

// Expose switchTab so inline onclick handlers (e.g. dashboard "查看全部") can navigate
window.switchTab = switchTab;

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    });
});

// ===== Toast =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Modal =====
// modalOpId stamps every modal opening so a background operation that finishes
// after its modal was dismissed can tell whether it is still the one on screen.
let modalOpId = 0;

function showModal(title, body, onConfirm, streamOp) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-overlay').style.display = 'flex';
    const opId = ++modalOpId;
    document.getElementById('modal-overlay').dataset.opId = String(opId);
    const confirmBtn = document.getElementById('modal-confirm');
    const newBtn = confirmBtn.cloneNode(true);
    // cloneNode copies attributes from the previous run (data-done='1', the
    // '执行中...' spinner, disabled), so always reset the button to a fresh
    // confirm state — otherwise closing a running modal and opening another
    // showModal-based feature would show a stuck '执行中...' button.
    newBtn.removeAttribute('data-done');
    newBtn.textContent = '确认';
    newBtn.disabled = false;
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', async () => {
        // Guard against double-clicks while a long operation is running
        if (newBtn.disabled) return;
        newBtn.disabled = true;
        const bodyEl = document.getElementById('modal-body');
        let stream = null;
        if (streamOp) stream = attachBrewStream(streamOp, bodyEl);
        try {
            await onConfirm();
        } catch (err) {
            // Handled by the caller; keep the modal open until it finishes
        } finally {
            if (stream) detachBrewStream(stream);
            // Only close if this modal is still the one on screen: the user
            // may have dismissed it mid-run and opened another feature, and
            // the finished background op must not close that newer modal.
            if (document.getElementById('modal-overlay').dataset.opId === String(opId)) {
                closeModal();
            }
        }
    });
}

window.closeModal = closeModal;
function closeModal() {
    // Drop any active progress stream so events from a background operation
    // that keeps running after the modal was dismissed are ignored instead
    // of leaking into the next modal.
    activeBrewStream = null;
    document.getElementById('modal-overlay').style.display = 'none';
    // Reset any size class applied by showModalLoading (e.g. 'modal-lg')
    const modalEl = document.getElementById('modal-overlay').querySelector('.modal');
    if (modalEl) modalEl.className = 'modal';
}

// ===== Package Detail Modal =====
let currentDetailPackage = null;

window.showDetailModal = showDetailModal;
function showDetailModal(pkg) {
    currentDetailPackage = pkg;
    const body = document.getElementById('detail-modal-body');

    body.innerHTML = '<div class="loading-state"><span class="spinner"></span> 加载详情...</div>';
    document.getElementById('detail-modal-overlay').style.display = 'flex';

    // Everything but 被依赖 comes from ONE `brew info --json=v2` on the Go side
    // (info + install time + dependencies); uses needs its own `brew uses` call.
    Service.GetPackageDetail(pkg.name, pkg.type).then(info => {
        renderDetailModal(info);
        Service.GetUses(info.name).then(uses => {
            renderRelationList('uses-count', 'detail-uses', uses, '暂无被依赖信息');
        }).catch(() => {
            renderRelationList('uses-count', 'detail-uses', null, '获取失败');
        });
    }).catch(err => {
        body.innerHTML = `<p class="empty-state">加载详情失败: ${err.message}</p>`;
    });
}

function renderDetailModal(info) {
    const body = document.getElementById('detail-modal-body');
    const isCask = info.type === 'cask';

    body.innerHTML = `
        <div class="detail-hero">
            <div class="pkg-icon pkg-icon-lg pkg-icon-${info.type}">${isCask ? CASK_ICON : FORMULA_ICON}</div>
            <div class="detail-hero-main">
                <div class="detail-hero-title-row">
                    <span class="detail-hero-name">${escapeHtml(info.name)}</span>
                    <span class="type-badge ${info.type}">${isCask ? '应用' : '命令行'}</span>
                </div>
                <span class="detail-hero-version">${escapeHtml(info.version || '版本未知')}</span>
            </div>
        </div>
        <p class="detail-desc">${escapeHtml(info.description || '暂无描述')}</p>
        <div class="detail-section">
            <div class="detail-section-header"><span>依赖</span><span class="count-badge" id="deps-count">…</span></div>
            <div class="detail-deps-list" id="detail-deps"><span class="rel-loading">加载中...</span></div>
        </div>
        <div class="detail-section">
            <div class="detail-section-header"><span>被依赖</span><span class="count-badge" id="uses-count">…</span></div>
            <div class="detail-deps-list" id="detail-uses"><span class="rel-loading">加载中...</span></div>
        </div>
        <div class="detail-section" id="detail-install-time-section">
            <div class="detail-section-header"><span>安装时间</span></div>
            <span id="detail-install-time" class="rel-loading">加载中...</span>
        </div>
    `;

    // Install time and dependencies come pre-loaded from the single info call
    const tEl = document.getElementById('detail-install-time');
    if (tEl) { tEl.className = ''; tEl.textContent = info.install_time || '未知'; }
    renderRelationList('deps-count', 'detail-deps', info.depends_on || [], '暂无依赖');
}

// renderRelationList fills one relation section (依赖 / 被依赖) with tags.
// Tags are clickable and open the detail of that package.
function renderRelationList(countId, listId, items, emptyText) {
    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = items && items.length > 0 ? String(items.length) : '0';
    const listEl = document.getElementById(listId);
    if (!listEl) return;
    if (items && items.length > 0) {
        listEl.innerHTML = items.map(dep =>
            `<span class="dep-tag dep-tag-link" onclick="showDetailModal(${jsonInline({name: dep, type: 'formula'})})">${escapeHtml(dep)}</span>`
        ).join('');
    } else {
        listEl.innerHTML = `<span class="rel-empty">${escapeHtml(emptyText)}</span>`;
    }
}

window.closeDetailModal = closeDetailModal;
function closeDetailModal() {
    document.getElementById('detail-modal-overlay').style.display = 'none';
    currentDetailPackage = null;
}

// ===== Cache System =====
// Each tab has its own cache: { data, timestamp }
const tabCache = {
    dashboard:  { data: null, timestamp: 0 },
    installed:   { data: null, timestamp: 0 },
    outdated:    { data: null, timestamp: 0 },
    services:    { data: null, timestamp: 0 },

    taps:     { data: null, timestamp: 0 },
    config:   { data: null, timestamp: 0 },
};

// Pre-load installed packages on startup for instant tab switch
let installedPackages = [];
let installedLoaded = false;
(async () => {
    try {
        installedPackages = await Service.ListInstalled();
        installedLoaded = true;
        tabCache.installed.data = installedPackages;
        tabCache.installed.timestamp = Date.now();
        updateInstalledCounts();
    } catch (err) {
        console.warn('预加载已安装包失败:', err);
    }
})();

// Pre-load taps on startup so the 仓库 stat & sidebar badge show instantly,
// without waiting for the slower outdated check
(async () => {
    try {
        const [taps, trust] = await Promise.all([
            Service.GetTaps(),
            Service.GetTrustInfo().catch(() => ({ supported: false, taps: [] })),
        ]);
        cachedTrustInfo = trust || { supported: false, taps: [] };
        tabCache.taps.data = taps;
        tabCache.taps.timestamp = Date.now();
        updateTapBadge(taps.length);
        if (currentTab === 'dashboard' && tabCache.dashboard.data) {
            tabCache.dashboard.data.taps = taps;
            tabCache.dashboard.data._tapsLoaded = true;
            renderDashboard(tabCache.dashboard.data);
        }
    } catch (err) {
        console.warn('预加载仓库列表失败:', err);
    }
})();

// Pre-load services on startup so the 服务 stat & sidebar badge show instantly
(async () => {
    try {
        const services = await Service.ListServices();
        tabCache.services.data = services;
        tabCache.services.timestamp = Date.now();
        updateServiceBadge(services);
        if (currentTab === 'dashboard' && tabCache.dashboard.data) {
            tabCache.dashboard.data.services = services;
            tabCache.dashboard.data._servicesLoaded = true;
            renderDashboard(tabCache.dashboard.data);
        }
    } catch (err) {
        console.warn('预加载服务列表失败:', err);
    }
})();

// Pre-load disk usage on startup so the 配置页 disk section shows it instantly
(async () => {
    try {
        cachedDiskUsage = await Service.GetDiskUsage();
        // Update the dashboard disk stat card once data arrives
        updateDiskStat();
    } catch (err) {
        console.warn('预加载磁盘使用失败:', err);
    }
})();

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

function isCacheValid(cache) {
    return cache && cache.data && (Date.now() - cache.timestamp < CACHE_TTL);
}

// ===== 就地更新（Local Patch）=====
// 操作完成后不再清空缓存/快照再全量重取，而是在内存数据上直接应用变更并
// 重绘当前视图，数据一致性交给各自的静默后台刷新（loadXInBackground）兜底。
// 这样列表始终有内容：不闪骨架屏、不整页重载、不丢滚动位置。

// 重建列表时保留标签页滚动位置，防止操作后内容高度变化导致页面"跳动"
function setListHTML(container, html) {
    const tabEl = document.querySelector('.tab-content.active');
    const prevScroll = tabEl ? tabEl.scrollTop : 0;
    container.innerHTML = html;
    if (tabEl) tabEl.scrollTop = prevScroll;
}

// 就地更新已安装列表快照：mutate(list) 直接修改 installedPackages
function patchInstalled(mutate) {
    mutate(installedPackages);
    tabCache.installed.data = installedPackages;
    tabCache.installed.timestamp = Date.now();
    updateInstalledCounts();
    if (currentTab === 'installed') renderInstalled(installedType, installedPackages);
    if (currentTab === 'dashboard' && tabCache.dashboard.data) {
        tabCache.dashboard.data.packages = installedPackages;
        renderDashboard(tabCache.dashboard.data);
    }
}

// 就地更新待更新列表：match 为函数时按谓词过滤，否则按名字数组过滤
function patchOutdated(match) {
    const filter = typeof match === 'function' ? match : (p => !match.includes(p.name));
    const list = tabCache.outdated.data;
    const dash = currentTab === 'dashboard' && tabCache.dashboard.data ? tabCache.dashboard.data : null;

    if (list) {
        const keep = list.filter(filter);
        list.length = 0;
        list.push(...keep);
        tabCache.outdated.timestamp = Date.now();
    }
    // 概览页缓存可能持有独立数组引用，同样就地更新
    if (dash && dash.outdated) {
        const keep = dash.outdated.filter(filter);
        dash.outdated.length = 0;
        dash.outdated.push(...keep);
        dash._outdatedLoaded = true;
    }

    if (currentTab === 'outdated' && list) {
        renderOutdated(list);
    }
    if (dash) {
        renderDashboard(dash);
    }
    // renderOutdated 不更新徽标，统一在此同步（renderDashboard 内部也会更新，重复调用无害）
    updateOutdatedBadge(list || (dash && dash.outdated) || []);
}

// 就地更新服务状态：只改单个服务的状态并重绘
function patchServices(name, status) {
    const list = tabCache.services.data;
    if (!list) return;
    const sv = list.find(s => s.name === name);
    if (sv) {
        sv.status = status;
        if (status !== 'started') sv.pid = '';
    } else {
        list.push({ name, status });
    }
    tabCache.services.timestamp = Date.now();
    updateServiceBadge(list);
    if (currentTab === 'services') renderServices(list);
    if (currentTab === 'dashboard' && tabCache.dashboard.data) {
        tabCache.dashboard.data.services = list;
        renderDashboard(tabCache.dashboard.data);
    }
}

// 就地更新仓库列表：action 为 'add'（name 为新仓库名）或 'remove'（name 为仓库名）
function patchTaps(action, name) {
    const list = tabCache.taps.data;
    if (!list) return;
    const changed = action === 'add' && !list.some(t => t.split(' ')[0] === name)
        ? [...list, name]
        : action === 'remove'
            ? list.filter(t => t.split(' ')[0] !== name)
            : list;
    tabCache.taps.data = changed;
    tabCache.taps.timestamp = Date.now();
    // 概览页缓存同步（无论当前在哪个 tab，保证下次进入概览时统计正确）
    if (tabCache.dashboard.data) tabCache.dashboard.data.taps = changed;
    if (currentTab === 'taps') renderTaps(changed, cachedTrustInfo);
    if (currentTab === 'dashboard' && tabCache.dashboard.data) {
        renderDashboard(tabCache.dashboard.data);
    }
}

// 静默刷新磁盘占用（cleanup / autoremove 之后），不重载整个页面
async function refreshDiskUsageSilent() {
    try {
        cachedDiskUsage = await Service.GetDiskUsage();
    } catch (err) {
        return;
    }
    updateDiskStat();
    if (currentTab === 'config') renderConfigDiskUsage();
}

// Sidebar 待更新徽标（跟随顶层筛选）
function updateOutdatedBadge(outdated) {
    const outdatedCount = outdatedTopLevelCount(outdated || []);
    const badge = document.getElementById('outdated-badge');
    if (!badge) return;
    if (outdatedCount > 0) {
        badge.style.display = 'inline';
        badge.textContent = outdatedCount;
    } else {
        badge.style.display = 'none';
    }
}

// ===== Dashboard =====
// Disk usage changes rarely within a session — keep it cached so switching
// back to the dashboard doesn't re-show the skeleton on every visit
let cachedDiskUsage = null;

window.refreshDashboard = refreshDashboard;
async function refreshDashboard(force) {
    if (force) {
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
    }

    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.dashboard)) {
        renderDashboard(tabCache.dashboard.data);
        // Still refresh disk usage, taps and outdated in background
        refreshDashboardInBackground();
        return;
    }

    // Always render immediately with pre-loaded data (zero wait)
    const quickData = {
        packages: installedPackages,
        taps: tabCache.taps.data || [],
        outdated: tabCache.outdated.data || [],
        services: tabCache.services.data || [],
        _tapsLoaded: !!tabCache.taps.data,
        _outdatedLoaded: !!tabCache.outdated.data,
        _servicesLoaded: !!tabCache.services.data,
    };
    tabCache.dashboard.data = quickData;
    tabCache.dashboard.timestamp = Date.now();
    renderDashboard(quickData);
    setDashboardRefreshing(true);

    // Fetch everything in background (don't block initial render).
    // Fast data (packages / disk / taps) is rendered in ONE pass once all
    // three settle; the slow outdated check renders on its own when done —
    // this keeps the dashboard from re-rendering (and visually "jumping")
    // several times per tab switch.
    Promise.allSettled([
        Service.ListInstalled().then(packages => {
            quickData.packages = packages;
            installedPackages = packages;
        }).catch(() => {}),
        Service.GetTaps().then(taps => {
            quickData.taps = taps;
            quickData._tapsLoaded = true;
        }).catch(() => {}),
        Service.ListServices().then(services => {
            quickData.services = services;
            quickData._servicesLoaded = true;
            tabCache.services.data = services;
            tabCache.services.timestamp = Date.now();
            updateServiceBadge(services);
        }).catch(() => {}),
        Service.GetDiskUsage().then(disk => {
            cachedDiskUsage = disk;
        }).catch(() => {}),
    ]).then(() => {
        tabCache.dashboard.timestamp = Date.now();
        setDashboardRefreshing(false);
        if (currentTab === 'dashboard') {
            renderDashboard(quickData);
        }
    });

    // Slow outdated check renders on its own when it finishes.
    // If the outdated tab already fetched a fresh copy, reuse it — don't run
    // `brew outdated` twice for the same 5-minute window.
    if (isCacheValid(tabCache.outdated)) {
        quickData.outdated = tabCache.outdated.data;
        quickData._outdatedLoaded = true;
    } else {
        Service.GetOutdated().then(outdated => {
            quickData.outdated = outdated;
            quickData._outdatedLoaded = true;
            // Sync into the outdated tab cache so switching there doesn't re-fetch
            tabCache.outdated.data = outdated;
            tabCache.outdated.timestamp = Date.now();
            tabCache.dashboard.timestamp = Date.now();
            if (currentTab === 'dashboard') {
                renderDashboard(quickData);
            }
        }).catch(() => {});
    }
}

// Background refresh used when the dashboard cache is already valid:
// re-fetch disk / taps / outdated, then render ONCE when all settle.
// If the outdated tab cache is still fresh, reuse it instead of re-running
// `brew outdated` for the same 5-minute window.
async function refreshDashboardInBackground() {
    const data = tabCache.dashboard.data;
    if (!data) return;

    // Skip re-fetching outdated if the shared cache is already fresh
    const outdatedFresh = isCacheValid(tabCache.outdated)
        ? Promise.resolve(tabCache.outdated.data)
        : Service.GetOutdated();

    const [taps, outdated, services, disk] = await Promise.allSettled([
        Service.GetTaps(),
        outdatedFresh,
        Service.ListServices(),
        Service.GetDiskUsage(),
    ]);
    if (taps.status === 'fulfilled') {
        data.taps = taps.value;
        data._tapsLoaded = true;
    }
    if (outdated.status === 'fulfilled') {
        data.outdated = outdated.value;
        data._outdatedLoaded = true;
        // Sync into the outdated tab cache so switching there doesn't re-fetch
        tabCache.outdated.data = outdated.value;
        tabCache.outdated.timestamp = Date.now();
    }
    if (services.status === 'fulfilled') {
        data.services = services.value;
        data._servicesLoaded = true;
        tabCache.services.data = services.value;
        tabCache.services.timestamp = Date.now();
        updateServiceBadge(services.value);
    }
    if (disk.status === 'fulfilled') {
        cachedDiskUsage = disk.value;
    }
    tabCache.dashboard.timestamp = Date.now();
    // Only re-render if still on dashboard tab
    if (currentTab === 'dashboard') {
        renderDashboard(data);
    }
}

// Clicking a stat card jumps to the matching tab
(function bindStatCardClicks() {
    const grid = document.getElementById('stats-grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.stat-card-clickable');
        if (card && card.dataset.tabTarget) {
            // Stat cards may pre-select a type inside the merged 已安装 tab
            if (card.dataset.tabType) setInstalledType(card.dataset.tabType);
            switchTab(card.dataset.tabTarget);
        }
    });
})();

function setDashboardRefreshing(on) {
    const btn = document.getElementById('dashboard-refresh-btn');
    if (!btn) return;
    btn.classList.toggle('refreshing', on);
    btn.disabled = on;
}

// Set a stat value directly (no count-up animation — numbers just update instantly)
function setStatValue(el, value) {
    if (!el) return;
    el.classList.remove('skeleton-text');
    el.textContent = value;
}

// Parse "1.2G" / "345M" / "12K" / "1.2 GB" style sizes into bytes
function parseSize(str) {
    if (!str) return 0;
    const m = String(str).trim().match(/^([\d.]+)\s*([KMGTP]?)(?:i?B)?$/i);
    if (!m) return 0;
    const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }[m[2].toUpperCase()] || 1;
    return parseFloat(m[1]) * mult;
}

// Inverse of parseSize: bytes -> "1.2G" style string (matches Go du output)
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'K', 'M', 'G', 'T'];
    let i = 0;
    let v = bytes;
    while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    const s = v >= 100 ? v.toFixed(0) : v.toFixed(1);
    return s + ' ' + units[i];
}

// Sum all Homebrew directories (Cellar + Caskroom + Cache, incl. Intel variants)
function totalDiskUsage(diskUsage) {
    if (!diskUsage) return 0;
    return Object.values(diskUsage).reduce((sum, v) => sum + parseSize(v), 0);
}

// Update the dashboard disk stat card from the cached disk usage map
function updateDiskStat() {
    setStatValue(document.getElementById('stat-disk'), formatBytes(totalDiskUsage(cachedDiskUsage)));
}

// ===== Shared icons (inline SVG, sized for list rows) =====
const CASK_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;
const FORMULA_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
const OUTDATED_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
const SEARCH_OFF_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="8" x2="14" y2="14"/><line x1="14" y1="8" x2="8" y2="14"/></svg>`;
const SEARCH_WARN_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const TAP_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

// Nicer empty-state block with an icon, title and optional hint
function emptyStateHTML(icon, title, sub) {
    return `<div class="empty-state-box">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="empty-state-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

// 顶层筛选默认开启（只显示手动安装的顶层包）
let leavesOnly = true;
let cachedLeaves = null;

// Active type inside the merged "已安装" tab: all / formula / cask，默认全部
let installedType = 'all';
const installedSearch = { all: '', formula: '', cask: '' };

// updateInstalledCounts refreshes dashboard stats, sidebar badge and the
// type-switch counts from the current installedPackages snapshot.
// 顶层筛选开启时，formula 相关统计只统计顶层包，保持与列表一致。
function updateInstalledCounts() {
    const formulas = installedPackages.filter(p => p.type === 'formula');
    const casks = installedPackages.filter(p => p.type === 'cask');

    // Formula 数量跟随顶层筛选（cask 不受影响）
    const formulaCount = leavesOnly && cachedLeaves
        ? formulas.filter(f => cachedLeaves.includes(f.name)).length
        : formulas.length;

    // Dashboard stats (命令行 stat 同样跟随顶层筛选)
    setStatValue(document.getElementById('stat-formulas'), formulaCount);
    setStatValue(document.getElementById('stat-casks'), casks.length);

    // Sidebar badge: 已安装总数跟随顶层筛选（应用 + 顶层命令行）
    const total = casks.length + formulaCount;
    const badge = document.getElementById('installed-count-badge');
    if (badge) {
        badge.style.display = total > 0 ? 'inline' : 'none';
        badge.textContent = total;
    }

    // Type-switch counts: 全部/命令行计数均跟随顶层筛选，保证与列表一致
    const ac = document.getElementById('switch-all-count');
    if (ac) ac.textContent = total > 0 ? String(total) : '';
    const fc = document.getElementById('switch-formula-count');
    if (fc) fc.textContent = formulaCount > 0 ? String(formulaCount) : '';
    const cc = document.getElementById('switch-cask-count');
    if (cc) cc.textContent = casks.length > 0 ? String(casks.length) : '';
}

// setInstalledType switches the merged tab between all / formula / cask view
window.setInstalledType = setInstalledType;
function setInstalledType(type) {
    if (type === installedType) return;
    installedType = type;

    // Sliding thumb + active class
    const sw = document.getElementById('installed-type-switch');
    if (sw) sw.dataset.active = type;
    document.querySelectorAll('#installed-type-switch .type-switch-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === type);
    });

    // 顶层筛选在所有视图下都可见、始终生效
    const lw = document.getElementById('leaves-toggle-wrap');
    if (lw) lw.style.display = '';

    // Per-type search value + placeholder
    const input = document.getElementById('installed-search');
    if (input) {
        input.placeholder = type === 'cask' ? '搜索已安装的应用…'
            : type === 'formula' ? '搜索已安装的命令行…'
            : '搜索已安装的软件包…';
        input.value = installedSearch[type];
        input.focus();
        input.select();
    }

    renderInstalled(type, installedPackages);
}

// Pre-fetch leaves on startup so dashboard/formula counts are correct immediately
(async () => {
    try {
        cachedLeaves = await Service.GetLeaves();
        if (installedPackages.length > 0) {
            updateFormulaStat();
        }
        // 顶层列表到达后刷新统计，并在已安装页时同步重绘列表
        if (currentTab === 'installed') {
            renderInstalled(installedType, installedPackages);
        }
    } catch (err) {
        console.warn('预加载顶层包列表失败:', err);
    }
})();

window.toggleLeavesFilter = toggleLeavesFilter;
function toggleLeavesFilter() {
    const cb = document.getElementById('leaves-filter-checkbox');
    leavesOnly = cb ? cb.checked : !leavesOnly;
    if (leavesOnly && !cachedLeaves) {
        Service.GetLeaves().then(list => {
            cachedLeaves = list;
            if (currentTab === 'installed') renderInstalled(installedType, installedPackages);
            updateInstalledCounts();
        }).catch(err => {
            showToast('获取顶层包列表失败: ' + err.message, 'error');
            leavesOnly = false;
            if (cb) cb.checked = false;
        });
        return;
    }
    if (currentTab === 'installed') renderInstalled(installedType, installedPackages);
    updateInstalledCounts();
    // Also refresh outdated/dashboard if on those tabs
    if (currentTab === 'outdated' && tabCache.outdated.data) {
        renderOutdated(tabCache.outdated.data);
    }
    if (currentTab === 'dashboard') {
        refreshDashboard();
    }
    // 更新徽标同样受顶层筛选影响，无论当前在哪个 tab 都同步
    if (tabCache.outdated.data) {
        const oc = outdatedTopLevelCount(tabCache.outdated.data);
        const ob = document.getElementById('outdated-badge');
        if (ob) {
            ob.style.display = oc > 0 ? 'inline' : 'none';
            ob.textContent = oc;
        }
    }
}

function updateFormulaStat() {
    updateInstalledCounts();
}

function outdatedTopLevelCount(outdated) {
    if (!leavesOnly || !cachedLeaves) return outdated.length;
    return outdated.filter(p => p.type !== 'formula' || cachedLeaves.includes(p.name)).length;
}

function renderDashboard(data) {
    const { packages, outdated } = data;

    // Stats cards — formula stat respects leaves filter, and sidebar badge +
    // type-switch counts all come from updateInstalledCounts()
    updateInstalledCounts();
    setStatValue(document.getElementById('stat-taps'), (data.taps || []).length);

    // Disk stat: total Homebrew directory usage (Cellar + Caskroom + Cache)
    updateDiskStat();

    // Outdated badge (sidebar) — respects leaves filter
    updateOutdatedBadge(outdated);

    // Sidebar badge for repository (tap) count
    updateTapBadge((data.taps || []).length);

    renderOutdatedPreview(outdated, data._outdatedLoaded);
    renderServicesPreview(data.services, data._servicesLoaded);
}

// ===== Outdated Preview (dashboard) =====
function renderOutdatedPreview(outdated, loaded) {
    const container = document.getElementById('outdated-preview');
    const countEl = document.getElementById('outdated-section-count');
    if (!container) return;

    if (!loaded) {
        if (countEl) countEl.textContent = '…';
        container.innerHTML = Array.from({ length: 3 }, () => `
            <div class="outdated-item">
                <div class="skeleton" style="width:40px;height:40px;border-radius:11px;flex-shrink:0;"></div>
                <div class="skeleton" style="width:110px;height:12px;"></div>
                <div class="skeleton" style="width:38px;height:12px;"></div>
                <div class="skeleton" style="width:46px;height:22px;border-radius:8px;"></div>
            </div>`).join('');
        return;
    }

    // Apply leaves filter to the preview as well
    const visible = leavesOnly && cachedLeaves
        ? outdated.filter(p => p.type !== 'formula' || cachedLeaves.includes(p.name))
        : outdated;

    if (countEl) countEl.textContent = visible.length;

    if (visible.length === 0) {
        container.innerHTML = `
            <div class="outdated-empty">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>所有包都是最新的</span>
            </div>`;
        return;
    }

    const top = visible.slice(0, 5);
    container.innerHTML = top.map(p => {
        const icon = p.type === 'cask' ? CASK_ICON : FORMULA_ICON;
        const iconCls = p.type === 'cask' ? 'pkg-icon-cask' : 'pkg-icon-formula';
        const hasCur = !!p.version;
        const hasNew = !!(p.latest_version && p.latest_version !== p.version);
        const verBox = (hasCur || hasNew) ? `
            <span class="outdated-versions">
                ${hasCur ? `<span class="outdated-version" title="${escapeHtml(p.version)}">${escapeHtml(p.version)}</span>` : ''}
                ${hasNew ? `<span class="outdated-version outdated-version-latest" title="${escapeHtml(p.latest_version)}">${escapeHtml(p.latest_version)}</span>` : ''}
            </span>` : '';
        return `
        <div class="outdated-item">
            <div class="pkg-icon ${iconCls} pkg-icon-sm">${icon}</div>
            <span class="outdated-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            ${verBox}
            <button class="btn btn-update-action btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
        </div>`;
    }).join('');
}

// ===== Installed =====
async function loadInstalled(tab) {
    const type = installedType;
    // Wait for pre-load to complete, then render
    if (installedPackages.length === 0) {
        // Not yet loaded, show loading state
        renderInstalled(type, []);
    } else {
        renderInstalled(type, installedPackages);
    }
    loadInstalledInBackground(type);
}

async function loadInstalledInBackground(type) {
    try {
        const packages = await Service.ListInstalled();
        installedPackages = packages;
        installedLoaded = true;
        tabCache.installed.data = packages;
        tabCache.installed.timestamp = Date.now();
        updateInstalledCounts();
        if (currentTab === 'installed') {
            renderInstalled(installedType, packages);
        }
    } catch (err) {
        // Silently fail for background refresh
    }
}

function spinRefreshBtn(btn, on) {
    if (!btn) return;
    btn.classList.toggle('refreshing', on);
    btn.disabled = on;
}

window.refreshInstalled = refreshInstalled;
async function refreshInstalled() {
    const btn = document.getElementById('installed-refresh');
    spinRefreshBtn(btn, true);
    try {
        const packages = await Service.ListInstalled();
        installedPackages = packages;
        installedLoaded = true;
        tabCache.installed.data = packages;
        tabCache.installed.timestamp = Date.now();
        renderInstalled(installedType, packages);
        updateInstalledCounts();
    } catch (err) {
        showToast('刷新失败: ' + err.message, 'error');
    }
    spinRefreshBtn(btn, false);
}

window.refreshOutdated = refreshOutdated;
async function refreshOutdated() {
    const btn = document.getElementById('outdated-refresh');
    spinRefreshBtn(btn, true);
    try {
        const outdated = await Service.GetOutdated();
        tabCache.outdated.data = outdated;
        tabCache.outdated.timestamp = Date.now();
        renderOutdated(outdated);
    } catch (err) {
        showToast('刷新失败: ' + err.message, 'error');
    }
    spinRefreshBtn(btn, false);
}

function renderInstalled(type, packages) {
    const search = (document.getElementById('installed-search')?.value || '').toLowerCase();
    const filtered = packages.filter(p => {
        // 全部视图不做类型过滤，展示所有包
        if (type !== 'all' && p.type !== type) return false;
        // 顶层筛选始终生效（只作用于命令行，应用不受影响）
        if (leavesOnly && p.type === 'formula' && cachedLeaves && !cachedLeaves.includes(p.name)) return false;
        if (!search) return true;
        return p.name.toLowerCase().includes(search) ||
               (p.description && p.description.toLowerCase().includes(search));
    });

    const container = document.getElementById('installed-list');
    if (!container) return;

    const typeLabel = type === 'cask' ? '应用' : type === 'formula' ? '命令行' : '软件包';

    if (filtered.length === 0) {
        if (packages.length === 0 && !installedLoaded) {
            // Still loading — show skeletons
            setListHTML(container, Array.from({length: 5}, () => `
                <div class="skeleton-row">
                    <div class="skeleton sk-icon"></div>
                    <div class="skeleton-row-main">
                        <div class="skeleton-row-line">
                            <div class="skeleton sk-name"></div>
                            <div class="skeleton sk-version"></div>
                        </div>
                        <div class="skeleton sk-desc"></div>
                    </div>
                    <div class="skeleton sk-badge"></div>
                </div>
            `).join(''));
        } else if (search) {
            setListHTML(container, emptyStateHTML(
                SEARCH_OFF_ICON,
                '未找到匹配的包',
                `没有名称或描述包含「${search}」的${typeLabel}`
            ));
        } else {
            const icon = type === 'cask' ? CASK_ICON : type === 'formula' ? FORMULA_ICON : CASK_ICON;
            setListHTML(container, emptyStateHTML(
                icon,
                type === 'all' ? '尚未安装任何软件包' : `尚未安装任何${typeLabel}`,
                '前往「搜索」页面查找并安装软件包'
            ));
        }
        return;
    }
    setListHTML(container, filtered.map(p => `
        <div class="pkg-item">
            <div class="pkg-icon pkg-icon-${p.type}">${p.type === 'cask' ? CASK_ICON : FORMULA_ICON}</div>
            <div class="pkg-main">
                <div class="pkg-name-row">
                    <span class="pkg-name">${escapeHtml(p.name)}</span>
                    <span class="pkg-version">${escapeHtml(p.version || '-')}</span>
                </div>
                <span class="pkg-desc">${escapeHtml(p.description || '暂无描述')}</span>
            </div>
            <div class="pkg-actions">
                ${p.type === 'formula' ? `<button class="btn btn-secondary btn-sm${p.pinned ? ' btn-pinned' : ''}" onclick="togglePin('${escapeHtml(p.name)}', ${p.pinned})">${p.pinned ? '解锁' : '锁定'}</button>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="showDetailModal(${jsonInline({name: p.name, type: p.type})})">详情</button>
                <button class="btn btn-warning btn-sm" onclick="reinstallPackage('${escapeHtml(p.name)}', '${p.type}')">重装</button>
                <button class="btn btn-danger btn-sm" onclick="uninstallPackage('${escapeHtml(p.name)}', '${p.type}')">卸载</button>
            </div>
        </div>
    `).join(''));
}

window.filterInstalled = filterInstalled;
function filterInstalled() {
    const input = document.getElementById('installed-search');
    if (input) installedSearch[installedType] = input.value;
    renderInstalled(installedType, installedPackages);
}

window.reinstallPackage = reinstallPackage;
async function reinstallPackage(name, type) {
    showModalLoading(
        '确认重装',
        `确定要重装 <strong>${escapeHtml(name)}</strong> 吗？这将重新下载并安装该包。\n\n下方将实时显示安装进度。`,
        async () => {
            try {
                await Service.Reinstall(name, type);
                // 重装会装到最新版：从待更新列表移除，后台静默同步已安装列表
                patchOutdated([name]);
                loadInstalledInBackground();
                return `${name} 重装成功`;
            } catch (err) {
                throw new Error(`重装失败: ${err.message}`);
            }
        },
        'modal-lg',
        `reinstall:${name}`
    );
}

window.uninstallPackage = uninstallPackage;
async function uninstallPackage(name, type) {
    showModalLoading(
        '确认卸载',
        `确定要卸载 <strong>${escapeHtml(name)}</strong> 吗？\n\n下方将实时显示卸载进度。`,
        async () => {
            try {
                await Service.Uninstall(name, type);
                // 就地移除该包并同步待更新列表，不再全量重取
                patchInstalled(list => {
                    const idx = list.findIndex(p => p.name === name && p.type === type);
                    if (idx >= 0) list.splice(idx, 1);
                });
                patchOutdated([name]);
                return `${name} 已卸载`;
            } catch (err) {
                throw new Error(`卸载失败: ${err.message}`);
            }
        },
        'modal-lg',
        `uninstall:${name}`
    );
}

// ===== Search Page =====
let searchTimeout = null;

function renderSearchResults(results, warnings) {
    const container = document.getElementById('search-results');
    if (!container) return;

    // Show non-fatal warnings (e.g. untrusted tap) above the results
    const warnHTML = (warnings && warnings.length > 0)
        ? warnings.map(w => `<div class="search-warning">${SEARCH_WARN_ICON}<span>${escapeHtml(w)}</span></div>`).join('')
        : '';

    if (!results || results.length === 0) {
        container.innerHTML = warnHTML || emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的包', '换个关键词试试，如 git、google-chrome');
        return;
    }

    container.innerHTML = warnHTML + results.slice(0, 50).map(r => `
        <div class="result-item">
            <div class="result-icon result-icon-${r.type}">${r.type === 'cask' ? CASK_ICON : FORMULA_ICON}</div>
            <div class="result-main">
                <div class="result-name-row">
                    <span class="result-name">${escapeHtml(r.name)}</span>
                    ${r.version ? `<span class="result-version">${escapeHtml(r.version)}</span>` : ''}
                    <span class="type-badge ${r.type}">${r.type === 'cask' ? '应用' : '命令行'}</span>
                </div>
                <span class="result-desc">${escapeHtml(r.description || '暂无描述')}</span>
            </div>
            <div class="result-actions">
                ${r.installed
                    ? `<span class="installed-tag">✓ 已安装</span>
                       <button class="btn btn-sm btn-secondary" onclick="showDetailModal(${jsonInline({name: r.name, type: r.type})})">详情</button>`
                    : `<button class="btn btn-sm btn-primary" onclick="installPackage('${escapeHtml(r.name)}', '${r.type}')">安装</button>`}
            </div>
        </div>
    `).join('');
}

async function doSearch(query) {
    const container = document.getElementById('search-results');
    if (!container) return;
    container.innerHTML = '<div class="loading-state"><span class="spinner"></span> 搜索中...</div>';

    try {
        const resp = await Service.Search(query);
        renderSearchResults(resp.results, resp.warnings);
    } catch (err) {
        container.innerHTML = `<div class="empty-state">搜索失败: ${escapeHtml(err.message)}</div>`;
    }
}

window.debounceSearch = function() {
    clearTimeout(searchTimeout);
    const input = document.getElementById('search-input');
    if (!input) return;
    const query = input.value.trim();
    if (!query) {
        document.getElementById('search-results').innerHTML = '';
        return;
    }
    searchTimeout = setTimeout(() => doSearch(query), 300);
};

window.installPackage = installPackage;
async function installPackage(name, type) {
    showModalLoading(
        '确认安装',
        `确定要安装 <strong>${escapeHtml(name)}</strong> 吗？\n\n下方将实时显示安装进度。`,
        async () => {
            try {
                await Service.Install(name, type);
                // 就地插入占位条目（不闪骨架屏），后台同步补齐完整信息
                patchInstalled(list => {
                    if (!list.some(p => p.name === name && p.type === type)) {
                        list.push({ name, type, version: '', description: '', pinned: false, installed: true, outdated: false });
                        // 新装的命令行属于顶层包，本地同步进 leaves，保证计数一致
                        if (type === 'formula' && cachedLeaves && !cachedLeaves.includes(name)) {
                            cachedLeaves.push(name);
                        }
                    }
                });
                loadInstalledInBackground();
                return `${name} 安装成功`;
            } catch (err) {
                throw new Error(`安装失败: ${err.message}`);
            }
        },
        'modal-lg',
        `install:${name}`
    );
}

// ===== Outdated =====
window.loadOutdated = loadOutdated;
async function loadOutdated() {
    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.outdated)) {
        renderOutdated(tabCache.outdated.data);
        // Still refresh in background
        loadOutdatedInBackground();
        return;
    }

    try {
        const outdated = await Service.GetOutdated();
        tabCache.outdated.data = outdated;
        tabCache.outdated.timestamp = Date.now();
        // Sync into the dashboard's cache so switching back doesn't re-fetch
        if (tabCache.dashboard.data) {
            tabCache.dashboard.data.outdated = outdated;
            tabCache.dashboard.data._outdatedLoaded = true;
        }
        renderOutdated(outdated);
    } catch (err) {
        document.getElementById('outdated-list').innerHTML =
            `<p class="empty-state">加载失败: ${err.message}</p>`;
    }
}

async function loadOutdatedInBackground() {
    try {
        const outdated = await Service.GetOutdated();
        tabCache.outdated.data = outdated;
        tabCache.outdated.timestamp = Date.now();
        // Sync into the dashboard's cache so switching back doesn't re-fetch
        if (tabCache.dashboard.data) {
            tabCache.dashboard.data.outdated = outdated;
            tabCache.dashboard.data._outdatedLoaded = true;
        }

        // Only re-render if still on outdated tab
        if (currentTab === 'outdated') {
            renderOutdated(outdated);
        }
    } catch (err) {
        // Silently fail for background refresh
    }
}

window.filterOutdated = filterOutdated;
function filterOutdated() {
    renderOutdated(tabCache.outdated.data || []);
}

window.upgradePackage = upgradePackage;
function renderOutdated(outdated) {
    const container = document.getElementById('outdated-list');
    const search = (document.getElementById('outdated-search')?.value || '').toLowerCase();
    const filtered = outdated.filter(p => {
        if (leavesOnly && cachedLeaves && p.type === 'formula' && !cachedLeaves.includes(p.name)) return false;
        if (!search) return true;
        return p.name.toLowerCase().includes(search) ||
               (p.description && p.description.toLowerCase().includes(search));
    });

    // Enable/disable bulk upgrade
    const upgradeAllBtn = document.getElementById('upgrade-all-btn');
    if (upgradeAllBtn) upgradeAllBtn.disabled = outdated.length === 0;

    if (filtered.length === 0) {
        setListHTML(container, outdated.length === 0
            ? emptyStateHTML(CHECK_ICON, '所有包都是最新的', '没有可用的更新')
            : emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的包', '换个关键词试试'));
        return;
    }

    setListHTML(container, filtered.map(p => {
        const icon = p.type === 'cask' ? CASK_ICON : FORMULA_ICON;
        const iconCls = p.type === 'cask' ? 'pkg-icon-cask' : 'pkg-icon-formula';
        return `
        <div class="pkg-item">
            <div class="pkg-icon ${iconCls}">${icon}</div>
            <div class="pkg-main">
                <div class="pkg-name-row">
                    <span class="pkg-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                    ${p.version ? `<span class="pkg-version" title="${escapeHtml(p.version)}">${escapeHtml(p.version)}</span>` : ''}
                    ${p.latest_version && p.latest_version !== p.version ? `<span class="version-arrow">→</span><span class="pkg-version pkg-version-latest" title="${escapeHtml(p.latest_version)}">${escapeHtml(p.latest_version)}</span>` : ''}
                </div>
                ${p.description ? `<span class="pkg-desc">${escapeHtml(p.description)}</span>` : ''}
            </div>
            <div class="pkg-actions">
                <button class="btn btn-secondary btn-sm" onclick="showDetailModal(${jsonInline({name: p.name, type: p.type})})">详情</button>
                <button class="btn btn-update-action btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
            </div>
        </div>`;
    }).join(''));
}

async function upgradePackage(name) {
    showModalLoading(
        '更新包',
        `正在更新 <strong>${escapeHtml(name)}</strong>，下方将实时显示更新进度。`,
        async () => {
            try {
                await Service.Upgrade([name]);
                // 就地移除已更新的包，同步徽标与概览预览
                patchOutdated([name]);
                return `${name} 更新成功`;
            } catch (err) {
                throw new Error('更新失败: ' + err.message);
            }
        },
        'modal-lg',
        `upgrade:${name}`
    );
}

window.upgradeAll = upgradeAll;
async function upgradeAll() {
    showModal(
        '全部更新',
        '确定要更新所有待更新的包吗？这可能需要较长时间，下方将实时显示更新进度。',
        async () => {
            const btn = document.getElementById('upgrade-all-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner"></span> 更新中...';
            }
            try {
                await Service.Upgrade([]);
                showToast('全部更新完成', 'success');
                // brew upgrade 全部成功才会返回 nil：本地清空待更新列表，
                // 后台静默复查兜底，避免立即整页重载
                patchOutdated(() => false);
                loadOutdatedInBackground();
            } catch (err) {
                showToast('更新失败: ' + err.message, 'error');
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                </svg> 全部更新`;
            }
        },
        'upgrade:all'
    );
}

// Show export/import feedback inside the matching quick-action card
function setInlineResult(elId, message, ok) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = 'config-inline-result show ' + (ok ? 'config-inline-ok' : 'config-inline-err');
    el.textContent = message;
}

window.exportConfig = exportConfig;
async function exportConfig() {
    const card = document.getElementById('export-config-card');
    if (card) card.classList.add('is-busy');
    setInlineResult('export-config-result', '正在打开保存对话框...', true);
    try {
        // Go side opens a native save dialog and writes the file,
        // returning the saved path (empty if the user cancelled)
        const path = await Service.ExportConfig();
        if (!path) {
            showToast('已取消导出', 'info');
            setInlineResult('export-config-result', '', true);
            return;
        }
        setInlineResult('export-config-result', '✓ 配置已导出至：' + path, true);
    } catch (err) {
        setInlineResult('export-config-result', '✗ 导出失败：' + err.message, false);
    } finally {
        if (card) card.classList.remove('is-busy');
    }
}

// ===== Import config (restore from a backup file, inline — no modal) =====
window.importConfig = async function() {
    const card = document.getElementById('import-config-card');
    if (card) {
        if (card.classList.contains('is-busy')) return;
        card.classList.add('is-busy');
    }
    setInlineResult('import-config-result', '正在选择备份文件...', true);
    const logEl = document.getElementById('import-config-log');
    let stream = logEl ? attachBrewStream('import', logEl) : null;
    try {
        const result = await Service.ImportConfig();
        if (!result) throw new Error('导入失败');
        if (result.cancelled) {
            showToast('已取消导入', 'info');
            setInlineResult('import-config-result', '', true);
            return;
        }

        const ok = result.failed.length === 0;
        const lines = [`${result.installed.length}/${result.total} 个软件包安装成功`];
        if (result.failed.length > 0) {
            lines.push(`${result.failed.length} 个失败：`);
            result.failed.forEach(f => lines.push(`  · ${f.name}: ${f.error}`));
        }
        const message = lines.join('\n');

        setInlineResult('import-config-result', (ok ? '✓ ' : '✗ ') + message, ok);

        // Packages changed -> silent background sync, keep current lists visible
        loadInstalledInBackground();
        loadOutdatedInBackground();
    } catch (err) {
        setInlineResult('import-config-result', '✗ 导入失败：' + err.message, false);
    } finally {
        if (stream) detachBrewStream(stream);
        if (card) card.classList.remove('is-busy');
    }
};

window.cleanupBrew = cleanupBrew;
async function cleanupBrew() {
    const btn = document.getElementById('cleanup-btn');
    showModalLoading(
        '清理缓存',
        '确定要清理 Homebrew 缓存和旧版本吗？\n\n下方将实时显示清理进度。',
        async () => {
            setButtonLoading(btn, true, '清理缓存');
            try {
                await Service.Cleanup();
                // 只刷新磁盘占用数据，不清缓存、不整页重载
                refreshDiskUsageSilent();
                return '清理完成';
            } catch (err) {
                throw new Error(`清理失败: ${err.message}`);
            } finally {
                setButtonLoading(btn, false, '清理缓存');
            }
        },
        'modal-lg',
        'cleanup'
    );
}

window.autoremoveDeps = autoremoveDeps;
async function autoremoveDeps() {
    const btn = document.getElementById('autoremove-btn');
    showModalLoading(
        '清理孤立依赖',
        '确定要清理不再被任何包依赖的孤立依赖吗？这将释放磁盘空间。\n\n下方将实时显示清理进度。',
        async () => {
            setButtonLoading(btn, true, '执行清理');
            try {
                await Service.Autoremove();
                // autoremove 可能移除孤立依赖：刷新磁盘占用 + 静默同步已安装列表
                refreshDiskUsageSilent();
                loadInstalledInBackground();
                return '清理完成';
            } catch (err) {
                throw new Error(`清理失败: ${err.message}`);
            } finally {
                setButtonLoading(btn, false, '执行清理');
            }
        },
        'modal-lg',
        'autoremove'
    );
}

// ===== 仓库管理 =====
// Trust info (Homebrew 6+ `brew trust`) cached alongside the tap list
let cachedTrustInfo = { supported: false, taps: [] };

async function loadTaps() {
    if (isCacheValid(tabCache.taps)) {
        renderTaps(tabCache.taps.data, cachedTrustInfo);
        loadTapsInBackground();
        return;
    }

    try {
        const taps = await Service.GetTaps();
        tabCache.taps.data = taps;
        tabCache.taps.timestamp = Date.now();
        // Render immediately; trust status fills in asynchronously
        renderTaps(taps, cachedTrustInfo);
        loadTrustInfo();
    } catch (err) {
        document.getElementById('taps-list').innerHTML = `<p class="empty-state">加载失败: ${err.message}</p>`;
    }
}

async function loadTapsInBackground() {
    try {
        const taps = await Service.GetTaps();
        tabCache.taps.data = taps;
        tabCache.taps.timestamp = Date.now();
        if (currentTab === 'taps') {
            renderTaps(taps, cachedTrustInfo);
        }
    } catch (err) {
        // Silently fail
    }
}

// Fetch which taps are trusted by `brew trust` and re-render once available
async function loadTrustInfo() {
    try {
        const trust = await Service.GetTrustInfo();
        cachedTrustInfo = trust || { supported: false, taps: [] };
        if (currentTab === 'taps') {
            renderTaps(tabCache.taps.data || [], cachedTrustInfo);
        }
    } catch (err) {
        cachedTrustInfo = { supported: false, taps: [] };
    }
}

function updateTapBadge(count) {
    const tapBadge = document.getElementById('tap-count-badge');
    if (!tapBadge) return;
    if (count > 0) {
        tapBadge.style.display = 'inline';
        tapBadge.textContent = count;
    } else {
        tapBadge.style.display = 'none';
    }
}

function renderTaps(taps, trustInfo) {
    // Update sidebar badge
    updateTapBadge(taps.length);

    const trustSupported = !!(trustInfo && trustInfo.supported);
    const trustedSet = new Set((trustInfo && trustInfo.taps) || []);

    document.getElementById('taps-list').innerHTML = taps.length > 0
        ? taps.map(t => {
            const tapName = t.split(' ')[0];
            const rest = t.slice(tapName.length).trim();
            const trusted = trustedSet.has(tapName);
            // One stateful button carries both the state and the action:
            // 「信任」(primary) while untrusted, 「已信任 ✓」(green) once trusted.
            const trustBtn = trustSupported
                ? `<button class="btn btn-sm ${trusted ? 'btn-success' : 'btn-primary'}" title="${trusted ? '已信任，点击取消信任' : '未信任，点击信任'}" onclick="toggleTapTrust('${escapeHtml(tapName)}', ${trusted ? 'false' : 'true'})">${trusted ? '✓ 已信任' : '信任'}</button>`
                : '';
            return `<div class="tap-item">
                <div class="tap-icon">${TAP_ICON}</div>
                <div class="tap-main">
                    <span class="tap-name">${escapeHtml(tapName)}</span>
                    ${rest ? `<span class="tap-desc">${escapeHtml(rest)}</span>` : ''}
                </div>
                <div class="tap-actions">
                    ${trustBtn}
                    <button class="btn btn-danger btn-sm" onclick="removeTap('${escapeHtml(tapName)}')">移除</button>
                </div>
            </div>`;
        }).join('')
        : emptyStateHTML(TAP_ICON, '暂无仓库', '在上方输入仓库名称添加，如 homebrew/cask');
}

// Toggle a tap's trust state with immediate effect; failures roll the
// button state back and surface a toast.
window.toggleTapTrust = toggleTapTrust;
async function toggleTapTrust(tap, on) {
    try {
        if (on) {
            await Service.TrustTap(tap);
            showToast(`已信任 ${tap}，现在可以搜索其中的包了`, 'success');
        } else {
            await Service.UntrustTap(tap);
            showToast(`已取消信任 ${tap}`, 'info');
        }
        const set = new Set(cachedTrustInfo.taps || []);
        if (on) set.add(tap); else set.delete(tap);
        cachedTrustInfo.taps = Array.from(set);
        if (currentTab === 'taps') {
            renderTaps(tabCache.taps.data || [], cachedTrustInfo);
        }
    } catch (err) {
        showToast(`${on ? '信任失败' : '取消信任失败'}: ${err.message}`, 'error');
        if (currentTab === 'taps') {
            renderTaps(tabCache.taps.data || [], cachedTrustInfo); // roll back the button state
        }
    }
}

window.addTap = addTap;
async function addTap() {
    const input = document.getElementById('tap-input');
    const tap = input.value.trim();
    if (!tap) {
        showToast('请输入仓库名称', 'error');
        return;
    }
    const btn = input.nextElementSibling;
    setButtonLoading(btn, true, '添加仓库');
    try {
        await Service.AddTap(tap);
        showToast(`仓库 ${tap} 添加成功`, 'success');
        input.value = '';
        // 就地追加新仓库并静默后台同步（补齐描述等信息）
        patchTaps('add', tap);
        loadTapsInBackground();
    } catch (err) {
        showToast('添加仓库失败: ' + err.message, 'error');
    }
    setButtonLoading(btn, false, '添加仓库');
}

window.removeTap = removeTap;
async function removeTap(tap) {
    showModalLoading(
        '确认移除仓库',
        `确定要移除仓库 <strong>${escapeHtml(tap)}</strong> 吗？\n\n下方将实时显示移除进度。`,
        async () => {
            try {
                await Service.RemoveTap(tap);
                // 就地移除该仓库并静默后台同步
                patchTaps('remove', tap);
                loadTapsInBackground();
                return `仓库 ${tap} 已移除`;
            } catch (err) {
                throw new Error(`移除失败: ${err.message}`);
            }
        },
        'modal-lg',
        `untap:${tap}`
    );
}

// ===== 服务管理（brew services） =====
const SERVICE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;

const SERVICE_STATUS = {
    started: { label: '运行中', cls: 'status-started' },
    stopped: { label: '已停止', cls: 'status-stopped' },
    none:    { label: '未运行', cls: 'status-none' },
    error:   { label: '错误', cls: 'status-error' },
    unknown: { label: '未知', cls: 'status-none' },
};

// Update the sidebar badge with the number of running services
function updateServiceBadge(services) {
    const badge = document.getElementById('service-count-badge');
    if (!badge) return;
    const running = (services || []).filter(s => s.status === 'started').length;
    if (running > 0) {
        badge.style.display = 'inline';
        badge.textContent = running;
    } else {
        badge.style.display = 'none';
    }
}

window.refreshServices = refreshServices;
async function refreshServices() {
    const btn = document.getElementById('services-refresh');
    spinRefreshBtn(btn, true);
    try {
        const services = await Service.ListServices();
        tabCache.services.data = services;
        tabCache.services.timestamp = Date.now();
        updateServiceBadge(services);
        renderServices(services);
    } catch (err) {
        showToast('刷新失败: ' + err.message, 'error');
    }
    spinRefreshBtn(btn, false);
}

window.filterServices = filterServices;
function filterServices() {
    renderServices(tabCache.services.data || []);
}

async function loadServices() {
    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.services)) {
        renderServices(tabCache.services.data);
        loadServicesInBackground();
        return;
    }
    try {
        const services = await Service.ListServices();
        tabCache.services.data = services;
        tabCache.services.timestamp = Date.now();
        updateServiceBadge(services);
        renderServices(services);
    } catch (err) {
        const container = document.getElementById('services-list');
        if (container) container.innerHTML = `<p class="empty-state">加载失败: ${err.message}</p>`;
    }
}

async function loadServicesInBackground() {
    try {
        const services = await Service.ListServices();
        tabCache.services.data = services;
        tabCache.services.timestamp = Date.now();
        updateServiceBadge(services);
        if (currentTab === 'services') {
            renderServices(services);
        }
    } catch (err) {
        // Silently fail for background refresh
    }
}

function renderServices(services) {
    updateServiceBadge(services);

    const search = (document.getElementById('services-search')?.value || '').toLowerCase();
    const filtered = services.filter(sv => {
        if (!search) return true;
        return sv.name.toLowerCase().includes(search) ||
               (sv.user || '').toLowerCase().includes(search) ||
               (sv.file || '').toLowerCase().includes(search);
    });

    const container = document.getElementById('services-list');
    if (!container) return;

    if (filtered.length === 0) {
        setListHTML(container, services.length === 0
            ? emptyStateHTML(SERVICE_ICON, '暂无服务', '当 Formula 提供后台守护进程（如 mysql、redis）时，这里会显示服务')
            : emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的服务', '换个关键词试试'));
        return;
    }

    setListHTML(container, filtered.map(sv => {
        const st = SERVICE_STATUS[sv.status] || SERVICE_STATUS.unknown;
        const iconCls = sv.status === 'started' ? 'pkg-icon-formula' : 'pkg-icon-cask';
        const running = sv.status === 'started';
        return `
        <div class="pkg-item">
            <div class="pkg-icon ${iconCls}">${SERVICE_ICON}</div>
            <div class="pkg-main">
                <div class="pkg-name-row">
                    <span class="pkg-name">${escapeHtml(sv.name)}</span>
                    <span class="status-badge ${st.cls}">${st.label}</span>
                    ${sv.pid ? `<span class="pkg-version">PID ${escapeHtml(sv.pid)}</span>` : ''}
                    ${sv.exit_code ? `<span class="pkg-version pkg-version-latest">退出码 ${escapeHtml(sv.exit_code)}</span>` : ''}
                </div>
                ${sv.file ? `<span class="pkg-desc">${escapeHtml(sv.file)}</span>` : ''}
                ${sv.user ? `<span class="service-user">用户：${escapeHtml(sv.user)}</span>` : ''}
            </div>
            <div class="pkg-actions">
                ${running ? `
                <button class="service-action-btn service-action-running" onclick="toggleService('${escapeHtml(sv.name)}', false)" title="运行中 · 点击停止">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>` : `
                <button class="service-action-btn service-action-stopped" onclick="toggleService('${escapeHtml(sv.name)}', true)" title="已停止 · 点击启动">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>`}
                <button class="service-action-btn service-action-restart" onclick="restartService('${escapeHtml(sv.name)}', this)" title="重启">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 5V2L7 7l5 5V8c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/></svg>
                </button>
            </div>
        </div>`;
    }).join(''));
}

window.restartService = restartService;
async function restartService(name, btn) {
    if (servicesBusy) return;
    servicesBusy = true;
    const actions = document.querySelectorAll('.service-action-btn');
    actions.forEach(b => { b.disabled = true; });
    if (btn) btn.classList.add('is-busy');
    try {
        await Service.RestartService(name);
        showToast(`服务 ${name} 已重启`, 'success');
        reloadServices(name, 'started');
    } catch (err) {
        actions.forEach(b => { b.disabled = false; });
        if (btn) btn.classList.remove('is-busy');
        showToast(`重启失败: ${err.message}`, 'error');
    }
    servicesBusy = false;
}

// After a service action, patch the state in place and sync in the background
function reloadServices(name, status) {
    patchServices(name, status);
    loadServicesInBackground();
}

// Dashboard quick-management preview: top services with inline icon buttons
function renderServicesPreview(services, loaded) {
    const container = document.getElementById('services-preview');
    const countEl = document.getElementById('service-section-count');
    if (!container) return;

    if (!loaded) {
        if (countEl) countEl.textContent = '…';
        container.innerHTML = `<div class="services-preview-grid">${Array.from({ length: 2 }, () => `
            <div class="service-chip">
                <div class="skeleton" style="width:70px;height:11px;"></div>
                <div class="skeleton" style="width:24px;height:24px;border-radius:7px;"></div>
            </div>`).join('')}</div>`;
        return;
    }

    const list = services || [];
    const running = list.filter(s => s.status === 'started').length;
    if (countEl) countEl.textContent = `${running}/${list.length}`;

    if (list.length === 0) {
        container.innerHTML = `
            <div class="outdated-empty services-empty">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                <span>暂无服务</span>
            </div>`;
        return;
    }

    // Compact quick management: wrapping chips, each with name + mini action button,
    // so several services fit side-by-side instead of filling the column vertically
    const top = list.slice(0, 8);
    container.innerHTML = `<div class="services-preview-grid">${top.map(sv => {
        const isRunning = sv.status === 'started';
        return `
            <div class="service-chip${isRunning ? ' is-running' : ''}">
                <span class="service-chip-name">${escapeHtml(sv.name)}</span>
                <button class="service-action-btn service-action-sm ${isRunning ? 'service-action-running' : 'service-action-stopped'}" onclick="toggleService('${escapeHtml(sv.name)}', ${!isRunning})" title="${isRunning ? '运行中 · 点击停止' : '已停止 · 点击启动'}">
                    ${isRunning
                        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
                        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'}
                </button>
            </div>`;
    }).join('')}</div>`;
}

// Icon status indicators: running (play, green) / stopped (pause bars, grey), click toggles
let servicesBusy = false;

window.toggleService = toggleService;
async function toggleService(name, on) {
    // Ignore while another service operation is in flight
    if (servicesBusy) return;

    servicesBusy = true;

    // Lock every action button on the page (services tab + dashboard preview) while the operation runs
    const actions = document.querySelectorAll('.service-action-btn');
    actions.forEach(b => { b.disabled = true; });

    try {
        if (on) {
            await Service.StartService(name);
        } else {
            await Service.StopService(name);
        }
        showToast(`服务 ${name} 已${on ? '启动' : '停止'}`, 'success');
        reloadServices(name, on ? 'started' : 'stopped');
    } catch (err) {
        actions.forEach(b => { b.disabled = false; });
        showToast(`${on ? '启动' : '停止'}失败: ${err.message}`, 'error');
    }
    servicesBusy = false;
}

// ===== Utility =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    // innerHTML never escapes single quotes or backslashes; escape them too so
    // the result is also safe inside single-quoted JS strings in onclick="..."
    // attributes (e.g. upgradePackage('name-with-quote')).
    return div.innerHTML.replace(/'/g, '&#39;').replace(/\\/g, '&#92;');
}

// Serialize an object for use inside an onclick="..." attribute safely.
// JSON.stringify emits raw double quotes which would truncate the HTML
// attribute value, so escape both quote characters as entities (the browser
// decodes them back before executing the inline handler).
function jsonInline(obj) {
    return JSON.stringify(obj).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===== Button Loading State =====
function setButtonLoading(btn, loading, originalText) {
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.dataset.originalText = originalText || btn.textContent.trim();
        const origHTML = btn.innerHTML;
        btn.dataset.originalHTML = origHTML;
        btn.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 处理中...`;
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalHTML || btn.dataset.originalText;
    }
}

// ===== Modal with Loading Indicator =====
// modalClassName: optional extra class(es) for the modal (e.g. 'modal-lg')
function showModalLoading(title, bodyHTML, onConfirm, modalClassName, streamOp) {
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    body.innerHTML = bodyHTML;
    const modalEl = document.getElementById('modal-overlay').querySelector('.modal');
    modalEl.className = 'modal' + (modalClassName ? ' ' + modalClassName : '');
    document.getElementById('modal-overlay').style.display = 'flex';
    const confirmBtn = document.getElementById('modal-confirm');
    const newBtn = confirmBtn.cloneNode(true);
    // cloneNode copies attributes from the previous run (data-done='1', text '关闭'),
    // so reset the button to a fresh confirm state
    newBtn.removeAttribute('data-done');
    newBtn.textContent = '确认';
    newBtn.disabled = false;
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', async () => {
        // After the operation has completed, the button turns into "关闭"
        if (newBtn.dataset.done === '1') {
            closeModal();
            return;
        }
        newBtn.disabled = true;
        newBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 执行中...';
        let stream = null;
        if (streamOp) stream = attachBrewStream(streamOp, body);
        try {
            const result = await onConfirm(newBtn);
            if (result) {
                if (typeof result === 'object' && result.message != null) {
                    renderModalResult(body, result.type || 'success', result.message);
                } else {
                    renderModalResult(body, 'success', result);
                }
            }
        } catch (err) {
            renderModalResult(body, 'error', err.message || '操作失败');
        } finally {
            if (stream) detachBrewStream(stream);
            newBtn.dataset.done = '1';
            newBtn.disabled = false;
            newBtn.innerHTML = '关闭';
        }
    });
}

// Show operation result inside the modal body (after onConfirm resolves/rejects)
function renderModalResult(body, type, message) {
    const prev = body.querySelector('.modal-result');
    if (prev) prev.remove();
    const div = document.createElement('div');
    div.className = `modal-result modal-result-${type}`;
    div.textContent = (type === 'success' ? '✓ ' : '✗ ') + message;
    body.appendChild(div);
}

// ===== Live progress log (streamed from Go via "brew:progress" events) =====
// Only one streaming operation is active at a time (UI serializes them); the
// listener stays registered and filters on the active operation id.
let activeBrewStream = null;

function initBrewProgressListener() {
    if (initBrewProgressListener.done) return;
    initBrewProgressListener.done = true;
    Runtime.EventsOn('brew:progress', (e) => {
        const st = activeBrewStream;
        if (!st || !e || e.op !== st.op) return;
        handleBrewProgress(st, e);
    });
}
initBrewProgressListener();

// attachBrewStream shows a terminal-style log pane (created inside logPane
// host element) and routes brew:progress events for op into it.
function attachBrewStream(op, host) {
    // Reuse an existing pane (e.g. the import card's #import-config-log)
    let pane = host.classList && host.classList.contains('progress-log') ? host : null;
    if (!pane) pane = host.querySelector('.progress-log');
    if (!pane) {
        pane = document.createElement('div');
        pane.className = 'progress-log';
        host.appendChild(pane);
    }
    pane.hidden = true;
    pane.innerHTML = '';
    const pre = document.createElement('pre');
    pane.appendChild(pre);
    const st = { op, log: pane, pre, lineCount: 0, pendingLines: [], pendingRefresh: null, flushScheduled: false };
    activeBrewStream = st;
    return st;
}

function detachBrewStream(st) {
    if (activeBrewStream === st) activeBrewStream = null;
}

function handleBrewProgress(st, e) {
    if (e.kind === 'done' || !e.text) return; // final result handled by the caller
    st.log.hidden = false;
    if (e.kind === 'refresh') {
        // progress-bar update: replaces the previous rendered line
        st.pendingRefresh = e.text;
        flushLog(st);
        return;
    }
    const kind = e.kind === 'phase' ? 'phase' : e.kind === 'start' ? 'cmd' : null;
    st.pendingLines.push({ text: e.text, kind });
    scheduleLogFlush(st);
}

function scheduleLogFlush(st) {
    if (st.flushScheduled) return;
    st.flushScheduled = true;
    requestAnimationFrame(() => flushLog(st));
}

// flushLog appends all queued lines in ONE DOM pass (DocumentFragment) and
// scrolls once per frame, instead of creating/appending a node and forcing a
// synchronous scroll layout per line — the previous code thrashed the layout
// on long installs (thousands of lines).
function flushLog(st) {
    st.flushScheduled = false;
    const frag = document.createDocumentFragment();
    let changed = false;

    // A pending refresh line replaces the last visible line (unless the last
    // element is a cmd/phase header, in which case it behaves like a line).
    if (st.pendingRefresh != null) {
        const last = st.pre.lastElementChild;
        if (last && last.className !== 'log-cmd' && last.className !== 'log-phase') {
            last.textContent = st.pendingRefresh;
            st.pendingRefresh = null;
            changed = true;
        } else {
            st.pendingLines.push({ text: st.pendingRefresh, kind: null });
            st.pendingRefresh = null;
        }
    }

    for (const { text, kind } of st.pendingLines) {
        // Cap total lines: drop the oldest to keep the DOM light for long runs
        if (st.lineCount >= 4000) {
            const first = st.pre.firstElementChild;
            if (first) { first.remove(); st.lineCount--; }
        }
        const div = document.createElement('div');
        div.textContent = text;
        if (kind === 'cmd') div.className = 'log-cmd';
        else if (kind === 'phase') div.className = 'log-phase';
        else if (/^(error|fatal)/i.test(text)) div.className = 'log-err';
        else if (/^warning:/i.test(text)) div.className = 'log-warn';
        frag.appendChild(div);
        st.lineCount++;
    }
    st.pendingLines.length = 0;
    if (frag.childNodes.length > 0) {
        st.pre.appendChild(frag);
        changed = true;
    }
    if (changed) st.pre.scrollTop = st.pre.scrollHeight;
}

window.setButtonLoading = setButtonLoading;
window.showModalLoading = showModalLoading;

// ===== Window Controls (custom traffic lights) =====
window.windowClose = function() { Runtime.Quit(); };
window.windowMinimise = function() { Runtime.WindowMinimise(); };
window.windowMaximise = function() { Runtime.WindowToggleMaximise(); };

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + W = Close window
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        Runtime.Quit();
    }
    // Cmd/Ctrl + M = Minimise
    if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault();
        Runtime.WindowMinimise();
    }
    // Cmd/Ctrl + S = Go to search page
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        switchTab('search');
    }
    // Cmd/Ctrl + R = Refresh Dashboard
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        // Invalidate cache and force refresh
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        switchTab('dashboard');
    }
    // Escape = Close modals
    if (e.key === 'Escape') {
        closeModal();
        closeDetailModal();
    }
});

// ===== Update (opened as a modal from the config page, consistent with dashboard quick actions) =====
window.runUpdateQuick = function() {
    showModalLoading(
        'Homebrew 更新',
        '将执行 <code>brew update</code> 更新 Homebrew 本体与各仓库索引，建议定期执行。\n下方将实时显示更新进度。',
        async () => {
            try {
                const result = await Service.UpdateWithOutput();
                // update 会改变 outdated / taps / 版本信息：静默后台刷新，不清缓存
                loadOutdatedInBackground();
                loadTapsInBackground();
                loadInstalledInBackground();
                return result.trim() || 'brew update 完成！';
            } catch (err) {
                throw new Error(`更新失败: ${err.message}`);
            }
        },
        'modal-lg',
        'update'
    );
};

// ===== Doctor / Vulnerabilities (opened as modals from the dashboard) =====
// 系统诊断：直接弹框运行 brew doctor，不再跳转配置页
window.runDoctorQuick = function() {
    showModalLoading(
        '系统诊断',
        '将运行 <code>brew doctor</code> 检查 Homebrew 环境健康状况。\n下方将实时显示诊断进度。',
        async () => {
            try {
                const result = await Service.Doctor();
                return result || '系统健康，未发现异常';
            } catch (err) {
                throw new Error(`诊断失败: ${err.message}`);
            }
        },
        'modal-lg',
        'doctor'
    );
};

// ===== Config =====
async function loadConfig() {
    // Disk usage
    renderConfigDiskUsage();
    // Mirror sources
    loadMirrorSources();
}

// ===== Mirror sources (换镜像源) =====
let mirrorSources = [];
let currentMirror = 'official';

async function loadMirrorSources() {
    const list = document.getElementById('mirror-list');
    try {
        const res = await App.GetMirrorSources();
        mirrorSources = res.sources || [];
        currentMirror = res.current || 'official';
        renderMirrorSources();
    } catch (err) {
        if (list) list.innerHTML = '<div class="mirror-error">加载镜像源失败：' + escapeHtml(err.message) + '</div>';
    }
}

// Badge initials + accent color per source
const MIRROR_BADGE = {
    official: { text: 'GH', cls: 'mirror-badge-official' },
    tuna:     { text: 'TUNA', cls: 'mirror-badge-tuna' },
    aliyun:   { text: 'ALI', cls: 'mirror-badge-aliyun' },
    ustc:     { text: 'USTC', cls: 'mirror-badge-ustc' },
    bfsu:     { text: 'BFSU', cls: 'mirror-badge-bfsu' },
    custom:   { text: '自定义', cls: 'mirror-badge-custom' },
};

const MIRROR_CHECK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function renderMirrorSources() {
    const list = document.getElementById('mirror-list');
    if (!list) return;

    const customNote = document.getElementById('mirror-custom-note');
    if (customNote) customNote.style.display = currentMirror === 'custom' ? '' : 'none';

    if (!mirrorSources.length) {
        list.innerHTML = '<div class="mirror-error">暂无可用镜像源</div>';
        return;
    }

    list.innerHTML = mirrorSources.map(src => {
        const active = src.id === currentMirror;
        const badge = MIRROR_BADGE[src.id] || { text: '镜像', cls: 'mirror-badge-custom' };
        return '<div class="mirror-card' + (active ? ' active' : '') + '" onclick="switchMirror(\'' + src.id + '\')" title="' + (active ? '当前使用中' : '点击切换') + '">'
            + '<div class="mirror-badge ' + badge.cls + '">' + badge.text + '</div>'
            + '<div class="mirror-info">'
            +   '<div class="mirror-name">' + escapeHtml(src.name) + (active ? '<span class="mirror-current-tag">当前</span>' : '') + '</div>'
            +   '<div class="mirror-desc">' + escapeHtml(src.description) + '</div>'
            +   '<div class="mirror-url">' + escapeHtml(src.url) + '</div>'
            + '</div>'
            + '<div class="mirror-check">' + (active ? MIRROR_CHECK_SVG : '') + '</div>'
        + '</div>';
    }).join('');
}

// Exposed for inline onclick handlers
window.switchMirror = function(id) {
    const src = mirrorSources.find(s => s.id === id);
    if (!src) return;
    if (id === currentMirror) return; // already active

    showModal('切换镜像源',
        '<p style="margin:0 0 12px;line-height:1.7;font-size:13px;color:var(--text-secondary)">确定要将 Homebrew 镜像源切换为 <b style="color:var(--text-primary)">' + escapeHtml(src.name) + '</b> 吗？</p>'
        + '<p style="margin:0;line-height:1.7;font-size:12px;color:var(--text-muted)">切换会写入对应的 shell 配置文件（macOS 默认 ~/.zshrc，fish/bash 用户写各自的配置文件）并立即对当前应用生效；下载异常时可随时切回官方源。原配置文件会备份为 .bak。</p>',
        async () => {
            try {
                await App.SetMirrorSource(id);
                currentMirror = id;
                renderMirrorSources();
                showToast('已切换到「' + src.name + '」', 'success');
            } catch (err) {
                showToast('切换失败: ' + err.message, 'error');
                loadMirrorSources(); // restore highlight on failure
            }
        }
    );
};

function renderConfigDiskUsage() {
    const grid = document.getElementById('config-disk-usage');
    const totalEl = document.getElementById('config-disk-total');
    if (!grid) return;

    const disk = cachedDiskUsage;
    grid.innerHTML = diskUsageHTML(disk);
    if (totalEl) {
        totalEl.textContent = (disk && Object.keys(disk).length > 0) ? formatBytes(totalDiskUsage(disk)) : '-';
    }
}

// Build the disk usage grid (total + per-directory bars)
function diskUsageHTML(disk) {
    if (!disk || Object.keys(disk).length === 0) {
        return '<div class="disk-empty">暂无磁盘数据</div>';
    }

    const entries = Object.entries(disk);
    const total = entries.reduce((sum, [, v]) => sum + parseSize(v), 0);

    const CELLAR_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
    const CASK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>';
    const CACHE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    return entries.map(([label, size]) => {
        const bytes = parseSize(size);
        const pct = total > 0 ? Math.round((bytes / total) * 100) : 0;
        const kind = label.includes('Cellar') ? 'box' : label.includes('Caskroom') ? 'app' : 'trash';
        const iconSvg = kind === 'box' ? CELLAR_SVG : kind === 'app' ? CASK_SVG : CACHE_SVG;
        const sub = kind === 'box' ? '软件包安装目录' : kind === 'app' ? '图形应用目录' : '下载缓存';
        return `<div class="disk-usage-item"><div class="disk-icon disk-icon-${kind}">${iconSvg}</div><div class="disk-info"><div class="disk-line"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(size)}<span class="disk-pct">${pct}%</span></span></div><div class="sub">${sub}</div><div class="disk-bar"><div class="disk-bar-fill disk-bar-${kind}" style="width:${pct}%"></div></div></div></div>`;
    }).join('');
}

// ===== Quick action: run the vulnerability scan in a modal (no tab switch) =====
window.runVulnsQuick = function() {
    showModalLoading(
        '安全漏洞扫描',
        '将扫描已安装软件包的已知安全漏洞。\n扫描可能需要一些时间，请稍候。',
        async () => {
            try {
                const result = await Service.GetVulns();
                return result || '未发现已知安全漏洞';
            } catch (err) {
                throw new Error(`扫描失败: ${err.message}`);
            }
        },
        'modal-lg'
    );
};

// ===== Pin / Unpin =====
window.togglePin = togglePin;
async function togglePin(name, pinned) {
    if (pinned) {
        await unpinPackage(name);
    } else {
        await pinPackage(name);
    }
    // 就地翻转锁定状态即可更新按钮，无需重取整个列表
    patchInstalled(list => {
        const pkg = list.find(p => p.name === name);
        if (pkg) pkg.pinned = !pinned;
    });
}

window.pinPackage = pinPackage;
async function pinPackage(name) {
    try {
        await Service.Pin(name);
        showToast(`${name} 已锁定`, 'success');
    } catch (err) {
        showToast('锁定失败: ' + err.message, 'error');
    }
}

window.unpinPackage = unpinPackage;
async function unpinPackage(name) {
    try {
        await Service.Unpin(name);
        showToast(`${name} 已解锁`, 'success');
    } catch (err) {
        showToast('解锁失败: ' + err.message, 'error');
    }
}

// ===== Search Page =====
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => window.debounceSearch());
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') searchInput.blur();
        });
    }
});

// ===== Init =====
window.openBrewSite = () => {
    Runtime.BrowserOpenURL('https://brew.sh/');
};

function showBrewMissing(info) {
    const overlay = document.getElementById('brew-missing-overlay');
    const desc = document.getElementById('brew-missing-desc');
    if (!overlay) return;
    if (info && info.error) {
        desc.textContent = info.error;
    } else {
        desc.textContent = '未找到 Homebrew。请先安装 Homebrew 后点击"重新检测"。';
    }
    overlay.style.display = 'flex';
}

function hideBrewMissing() {
    const overlay = document.getElementById('brew-missing-overlay');
    if (overlay) overlay.style.display = 'none';
}

window.retryBrewCheck = async () => {
    try {
        await Service.ResetBrewDetection();
        const info = await Service.GetBrewInfo();
        if (info.available) {
            hideBrewMissing();
            const badge = document.getElementById('brew-version');
            if (badge) badge.textContent = info.version || 'Brew';
            refreshDashboard(true);
        } else {
            showBrewMissing(info);
        }
    } catch (err) {
        showBrewMissing(null);
    }
};

(async () => {
    // Check Homebrew availability first so a missing brew shows one clear
    // message instead of every tab failing with "加载失败".
    try {
        const info = await Service.GetBrewInfo();
        if (info.available) {
            const badge = document.getElementById('brew-version');
            if (badge && info.version) badge.textContent = info.version;
            refreshDashboard();
        } else {
            showBrewMissing(info);
        }
    } catch (err) {
        // Fall back to the old behavior if the binding is missing
        Service.GetVersion().then(version => {
            document.getElementById('brew-version').textContent = version;
        }).catch(() => {
            document.getElementById('brew-version').textContent = 'Brew 未安装';
        });
        refreshDashboard();
    }
})();
