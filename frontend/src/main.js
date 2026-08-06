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
    else if (tab === 'installed-cask' || tab === 'installed-formula') loadInstalled(tab);
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
function showModal(title, body, onConfirm) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-overlay').style.display = 'flex';
    const confirmBtn = document.getElementById('modal-confirm');
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', () => {
        onConfirm();
        closeModal();
    });
}

window.closeModal = closeModal;
function closeModal() {
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

    // Load full package info
    Service.GetPackageInfo(pkg.name, pkg.type).then(info => {
        renderDetailModal(info);
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

    // Load install time
    Service.GetPackageInstallTime(info.name).then(t => {
        const el = document.getElementById('detail-install-time');
        if (el) { el.className = ''; el.textContent = t || '未知'; }
    }).catch(() => {
        const el = document.getElementById('detail-install-time');
        if (el) { el.className = ''; el.textContent = '未知'; }
    });

    // Load dependencies and dependents in parallel; each fills its own column
    Service.GetDependencies(info.name).then(deps => {
        renderRelationList('deps-count', 'detail-deps', deps, '暂无依赖');
    }).catch(() => {
        renderRelationList('deps-count', 'detail-deps', null, '获取失败');
    });

    Service.GetUses(info.name).then(uses => {
        renderRelationList('uses-count', 'detail-uses', uses, '暂无被依赖信息');
    }).catch(() => {
        renderRelationList('uses-count', 'detail-uses', null, '获取失败');
    });
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

function markCacheDirty(tab) {
    // When a user action changes data, invalidate the cache for affected tabs
    if ((tab === 'installed-cask' || tab === 'installed-formula') || tab === 'dashboard') {
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        tabCache.installed.data = null;
        tabCache.installed.timestamp = 0;
    }
    if (tab === 'outdated' || tab === 'dashboard') {
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        tabCache.outdated.data = null;
        tabCache.outdated.timestamp = 0;
    }

    if (tab === 'taps') {
        tabCache.taps.data = null;
        tabCache.taps.timestamp = 0;
    }
    if (tab === 'services') {
        tabCache.services.data = null;
        tabCache.services.timestamp = 0;
        // Service actions change the dashboard stat too
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
    }
    // Config tab includes update, doctor, vulns
    if (tab === 'config' || tab === 'update' || tab === 'doctor' || tab === 'vulns') {
        tabCache.config.data = null;
        tabCache.config.timestamp = 0;
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

    // Slow outdated check renders on its own when it finishes
    Service.GetOutdated().then(outdated => {
        quickData.outdated = outdated;
        quickData._outdatedLoaded = true;
        tabCache.dashboard.timestamp = Date.now();
        if (currentTab === 'dashboard') {
            renderDashboard(quickData);
        }
    }).catch(() => {});
}

// Background refresh used when the dashboard cache is already valid:
// re-fetch disk / taps / outdated, then render ONCE when all settle
async function refreshDashboardInBackground() {
    const data = tabCache.dashboard.data;
    if (!data) return;
    const [taps, outdated, services, disk] = await Promise.allSettled([
        Service.GetTaps(),
        Service.GetOutdated(),
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
        if (card && card.dataset.tabTarget) switchTab(card.dataset.tabTarget);
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

let leavesOnly = true;
let cachedLeaves = null;

// Pre-fetch leaves on startup so dashboard/formula counts are correct immediately
(async () => {
    try {
        cachedLeaves = await Service.GetLeaves();
        if (installedPackages.length > 0) {
            updateFormulaStat();
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
            renderInstalled('formula', installedPackages);
            updateFormulaStat();
        }).catch(err => {
            showToast('获取顶层包列表失败: ' + err.message, 'error');
            leavesOnly = false;
            if (cb) cb.checked = false;
        });
        return;
    }
    renderInstalled('formula', installedPackages);
    updateFormulaStat();
    // Also refresh outdated/dashboard if on those tabs
    if (currentTab === 'outdated' && tabCache.outdated.data) {
        renderOutdated(tabCache.outdated.data);
    }
    if (currentTab === 'dashboard') {
        refreshDashboard();
    }
}

function updateFormulaStat() {
    const formulas = installedPackages.filter(p => p.type === 'formula');
    const count = leavesOnly && cachedLeaves
        ? formulas.filter(f => cachedLeaves.includes(f.name)).length
        : formulas.length;
    setStatValue(document.getElementById('stat-formulas'), count);
    const badge = document.getElementById('formula-count-badge');
    if (badge) {
        badge.style.display = count > 0 ? 'inline' : 'none';
        badge.textContent = count;
    }
}

function outdatedTopLevelCount(outdated) {
    if (!leavesOnly || !cachedLeaves) return outdated.length;
    return outdated.filter(p => p.type !== 'formula' || cachedLeaves.includes(p.name)).length;
}

function renderDashboard(data) {
    const { packages, outdated } = data;

    const casks = packages.filter(p => p.type === 'cask');

    // Stats cards — formula stat respects leaves filter
    updateFormulaStat();
    setStatValue(document.getElementById('stat-casks'), casks.length);
    setStatValue(document.getElementById('stat-taps'), (data.taps || []).length);

    // Disk stat: total Homebrew directory usage (Cellar + Caskroom + Cache)
    updateDiskStat();

    // Outdated badge (sidebar) — respects leaves filter
    const outdatedCount = outdatedTopLevelCount(outdated);
    const badge = document.getElementById('outdated-badge');
    if (outdatedCount > 0) {
        badge.style.display = 'inline';
        badge.textContent = outdatedCount;
    } else {
        badge.style.display = 'none';
    }

    // Sidebar badges for cask (formula badge is handled by updateFormulaStat)
    const caskBadge = document.getElementById('cask-count-badge');
    if (casks.length > 0) {
        caskBadge.style.display = 'inline';
        caskBadge.textContent = casks.length;
    } else {
        caskBadge.style.display = 'none';
    }

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

    if (countEl) countEl.textContent = outdated.length;

    // Apply leaves filter to the preview as well
    const visible = leavesOnly && cachedLeaves
        ? outdated.filter(p => p.type !== 'formula' || cachedLeaves.includes(p.name))
        : outdated;

    if (visible.length === 0) {
        container.innerHTML = `
            <div class="outdated-empty">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>所有包都是最新的</span>
            </div>`;
        return;
    }

    const top = visible.slice(0, 5);
    const remainder = visible.length - 5;
    container.innerHTML = top.map(p => {
        const icon = p.type === 'cask' ? CASK_ICON : FORMULA_ICON;
        const iconCls = p.type === 'cask' ? 'pkg-icon-cask' : 'pkg-icon-formula';
        return `
        <div class="outdated-item">
            <div class="pkg-icon ${iconCls} pkg-icon-sm">${icon}</div>
            <span class="outdated-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            ${p.version ? `<span class="outdated-version" title="${escapeHtml(p.version)}">${escapeHtml(p.version)}</span>` : ''}
            ${p.latest_version && p.latest_version !== p.version ? `<span class="version-arrow">→</span><span class="outdated-version outdated-version-latest" title="${escapeHtml(p.latest_version)}">${escapeHtml(p.latest_version)}</span>` : ''}
            <button class="btn btn-primary btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
        </div>`;
    }).join('')
    + (remainder > 0 ? `<div class="outdated-more">还有 ${remainder} 个</div>` : '');
}

// ===== Installed =====
async function loadInstalled(tab) {
    const type = tab === 'installed-cask' ? 'cask' : 'formula';
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
        if (currentTab === 'installed-cask' || currentTab === 'installed-formula') {
            renderInstalled(type, packages);
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
async function refreshInstalled(type) {
    const btn = document.getElementById(type === 'cask' ? 'installed-cask-refresh' : 'installed-formula-refresh');
    spinRefreshBtn(btn, true);
    try {
        const packages = await Service.ListInstalled();
        installedPackages = packages;
        installedLoaded = true;
        tabCache.installed.data = packages;
        tabCache.installed.timestamp = Date.now();
        renderInstalled(type, packages);
        showToast(type === 'cask' ? '应用列表已刷新' : '命令行列表已刷新', 'success');
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
        showToast('更新列表已刷新', 'success');
    } catch (err) {
        showToast('刷新失败: ' + err.message, 'error');
    }
    spinRefreshBtn(btn, false);
}

function renderInstalled(type, packages) {
    const searchInputId = type === 'cask' ? 'installed-cask-search' : 'installed-formula-search';
    const containerId = type === 'cask' ? 'cask-list' : 'formula-list';
    const countId = type === 'cask' ? 'cask-page-count' : 'formula-page-count';
    const isCask = type === 'cask';
    const search = document.getElementById(searchInputId).value.toLowerCase();
    const filtered = packages.filter(p => {
        if (p.type !== type) return false;
        if (leavesOnly && type === 'formula' && cachedLeaves && !cachedLeaves.includes(p.name)) return false;
        if (!search) return true;
        return p.name.toLowerCase().includes(search) ||
               (p.description && p.description.toLowerCase().includes(search));
    });

    // Live count pill next to the heading
    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = filtered.length + ' 个';

    const container = document.getElementById(containerId);
    if (filtered.length === 0) {
        if (packages.length === 0 && !installedLoaded) {
            // Still loading — show skeletons
            container.innerHTML = Array.from({length: 5}, () => `
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
            `).join('');
        } else if (search) {
            container.innerHTML = emptyStateHTML(
                SEARCH_OFF_ICON,
                '未找到匹配的包',
                `没有名称或描述包含「${search}」的${isCask ? '应用' : '命令行'}`
            );
        } else {
            container.innerHTML = emptyStateHTML(
                isCask ? CASK_ICON : FORMULA_ICON,
                isCask ? '尚未安装任何应用' : '尚未安装任何命令行',
                '前往「搜索」页面查找并安装软件包'
            );
        }
        return;
    }
    container.innerHTML = filtered.map(p => `
        <div class="pkg-item">
            <div class="pkg-icon pkg-icon-${type}">${isCask ? CASK_ICON : FORMULA_ICON}</div>
            <div class="pkg-main">
                <div class="pkg-name-row">
                    <span class="pkg-name">${escapeHtml(p.name)}</span>
                    <span class="pkg-version">${escapeHtml(p.version || '-')}</span>
                </div>
                <span class="pkg-desc">${escapeHtml(p.description || '暂无描述')}</span>
            </div>
            <div class="pkg-actions">
                <button class="btn btn-secondary btn-sm" onclick="showDetailModal(${jsonInline({name: p.name, type: p.type})})">详情</button>
                ${type === 'formula' ? `<button class="btn btn-secondary btn-sm${p.pinned ? ' btn-pinned' : ''}" onclick="togglePin('${escapeHtml(p.name)}', ${p.pinned})">${p.pinned ? '解锁' : '锁定'}</button><button class="btn btn-secondary btn-sm" onclick="linkPackage('${escapeHtml(p.name)}')" title="链接到 /usr/local">链接</button><button class="btn btn-secondary btn-sm" onclick="unlinkPackage('${escapeHtml(p.name)}')" title="取消链接">断开</button>` : ''}
                <button class="btn btn-warning btn-sm" onclick="reinstallPackage('${escapeHtml(p.name)}', '${type}')">重装</button>
                <button class="btn btn-danger btn-sm" onclick="uninstallPackage('${escapeHtml(p.name)}', '${type}')">卸载</button>
            </div>
        </div>
    `).join('');
}

window.filterInstalled = filterInstalled;
function filterInstalled(type) {
    renderInstalled(type, installedPackages);
}

window.reinstallPackage = reinstallPackage;
async function reinstallPackage(name, type) {
    showModalLoading(
        '确认重装',
        `确定要重装 <strong>${escapeHtml(name)}</strong> 吗？这将重新下载并安装该包。`,
        async () => {
            try {
                await Service.Reinstall(name, type);
                // Reload after a short delay
                setTimeout(() => {
                    markCacheDirty('installed');
                    tabCache.installed.data = null;
                    tabCache.installed.timestamp = 0;
                    installedPackages = [];
                    loadInstalled(currentTab);
                }, 500);
                return `${name} 重装成功`;
            } catch (err) {
                throw new Error(`重装失败: ${err.message}`);
            }
        }
    );
}

window.uninstallPackage = uninstallPackage;
async function uninstallPackage(name, type) {
    showModalLoading(
        '确认卸载',
        `确定要卸载 <strong>${escapeHtml(name)}</strong> 吗？`,
        async () => {
            try {
                await Service.Uninstall(name, type);
                markCacheDirty('installed');
                // Clear cache and reload
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
                loadInstalled(currentTab);
                return `${name} 已卸载`;
            } catch (err) {
                throw new Error(`卸载失败: ${err.message}`);
            }
        }
    );
}

// ===== Search Page =====
let searchTimeout = null;

function renderSearchResults(results, warnings) {
    const container = document.getElementById('search-results');
    const countEl = document.getElementById('search-result-count');
    if (!container) return;

    // Show non-fatal warnings (e.g. untrusted tap) above the results
    const warnHTML = (warnings && warnings.length > 0)
        ? warnings.map(w => `<div class="search-warning">${SEARCH_WARN_ICON}<span>${escapeHtml(w)}</span></div>`).join('')
        : '';

    if (!results || results.length === 0) {
        container.innerHTML = warnHTML || emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的包', '换个关键词试试，如 git、google-chrome');
        if (countEl) countEl.style.display = 'none';
        return;
    }

    if (countEl) {
        countEl.style.display = 'inline-flex';
        countEl.textContent = results.length > 50
            ? `共 ${results.length} 个结果，显示前 50`
            : `${results.length} 个结果`;
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
    const countEl = document.getElementById('search-result-count');
    if (countEl) countEl.style.display = 'none';

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
        const countEl = document.getElementById('search-result-count');
        if (countEl) countEl.style.display = 'none';
        return;
    }
    searchTimeout = setTimeout(() => doSearch(query), 300);
};

window.installPackage = installPackage;
async function installPackage(name, type) {
    showModalLoading(
        '确认安装',
        `确定要安装 <strong>${escapeHtml(name)}</strong> 吗？`,
        async () => {
            try {
                await Service.Install(name, type);
                markCacheDirty('installed');
                markCacheDirty('dashboard');
                // Clear cache and reload
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
                return `${name} 安装成功`;
            } catch (err) {
                throw new Error(`安装失败: ${err.message}`);
            }
        }
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

    // Live count pill + enable/disable bulk upgrade
    const countEl = document.getElementById('outdated-page-count');
    if (countEl) countEl.textContent = filtered.length + ' 个';
    const upgradeAllBtn = document.getElementById('upgrade-all-btn');
    if (upgradeAllBtn) upgradeAllBtn.disabled = outdated.length === 0;

    if (filtered.length === 0) {
        container.innerHTML = outdated.length === 0
            ? emptyStateHTML(CHECK_ICON, '所有包都是最新的', '没有可用的更新')
            : emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的包', '换个关键词试试');
        return;
    }

    container.innerHTML = filtered.map(p => {
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
                <button class="btn btn-primary btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
            </div>
        </div>`;
    }).join('');
}

async function upgradePackage(name) {
    // Find the button for this package (works from the outdated tab or the dashboard preview)
    const items = document.querySelectorAll('#outdated-list .pkg-item, #outdated-preview .outdated-item');
    let targetBtn = null;
    for (const item of items) {
        const nameEl = item.querySelector('.pkg-name, .outdated-name');
        if (nameEl && nameEl.textContent === name) {
            targetBtn = item.querySelector('.btn');
            break;
        }
    }
    try {
        setButtonLoading(targetBtn, true, '更新');
        await Service.Upgrade([name]);
        showToast(`${name} 更新成功`, 'success');
        markCacheDirty('outdated');
        markCacheDirty('dashboard');
        tabCache.outdated.data = null;
        tabCache.outdated.timestamp = 0;
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        if (currentTab === 'dashboard') {
            refreshDashboard();
        } else {
            loadOutdated();
        }
    } catch (err) {
        showToast('更新失败: ' + err.message, 'error');
    }
    setButtonLoading(targetBtn, false, '更新');
}

window.upgradeAll = upgradeAll;
async function upgradeAll() {
    showModal(
        '全部更新',
        '确定要更新所有待更新的包吗？这可能需要较长时间。',
        async () => {
            const btn = document.getElementById('upgrade-all-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 更新中...';
            try {
                await Service.Upgrade([]);
                showToast('全部更新完成', 'success');
                markCacheDirty('outdated');
                markCacheDirty('dashboard');
                tabCache.outdated.data = null;
                tabCache.outdated.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                loadOutdated();
            } catch (err) {
                showToast('更新失败: ' + err.message, 'error');
            }
            btn.disabled = false;
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
            </svg> 全部更新`;
        }
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
        showToast('配置已导出: ' + path, 'success');
        setInlineResult('export-config-result', '✓ 配置已导出至：' + path, true);
    } catch (err) {
        showToast('导出失败: ' + err.message, 'error');
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

        showToast(ok ? '导入完成' : '导入完成，部分软件包失败', ok ? 'success' : 'error');
        setInlineResult('import-config-result', (ok ? '✓ ' : '✗ ') + message, ok);

        // Packages changed -> refresh caches
        markCacheDirty('installed');
        markCacheDirty('dashboard');
        markCacheDirty('outdated');
        tabCache.installed.data = null;
        tabCache.installed.timestamp = 0;
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        tabCache.outdated.data = null;
        tabCache.outdated.timestamp = 0;
        installedPackages = [];
    } catch (err) {
        showToast('导入失败: ' + err.message, 'error');
        setInlineResult('import-config-result', '✗ 导入失败：' + err.message, false);
    } finally {
        if (card) card.classList.remove('is-busy');
    }
};

window.cleanupBrew = cleanupBrew;
async function cleanupBrew() {
    const btn = document.getElementById('cleanup-btn');
    showModalLoading(
        '清理缓存',
        '确定要清理 Homebrew 缓存和旧版本吗？',
        async () => {
            setButtonLoading(btn, true, '清理缓存');
            try {
                await Service.Cleanup();
                markCacheDirty('dashboard');
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                refreshDashboard();
                return '清理完成';
            } catch (err) {
                throw new Error(`清理失败: ${err.message}`);
            } finally {
                setButtonLoading(btn, false, '清理缓存');
            }
        }
    );
}

window.autoremoveDeps = autoremoveDeps;
async function autoremoveDeps() {
    const btn = document.getElementById('autoremove-btn');
    showModalLoading(
        '清理孤立依赖',
        '确定要清理不再被任何包依赖的孤立依赖吗？这将释放磁盘空间。',
        async () => {
            setButtonLoading(btn, true, '执行清理');
            try {
                await Service.Autoremove();
                markCacheDirty('dashboard');
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                refreshDashboard();
                return '清理完成';
            } catch (err) {
                throw new Error(`清理失败: ${err.message}`);
            } finally {
                setButtonLoading(btn, false, '执行清理');
            }
        }
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

    const pageCount = document.getElementById('tap-page-count');
    if (pageCount) pageCount.textContent = taps.length + ' 个';

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
        markCacheDirty('taps');
        tabCache.taps.data = null;
        tabCache.taps.timestamp = 0;
        loadTaps();
    } catch (err) {
        showToast('添加仓库失败: ' + err.message, 'error');
    }
    setButtonLoading(btn, false, '添加仓库');
}

window.removeTap = removeTap;
async function removeTap(tap) {
    showModalLoading(
        '确认移除仓库',
        `确定要移除仓库 <strong>${escapeHtml(tap)}</strong> 吗？`,
        async () => {
            try {
                await Service.RemoveTap(tap);
                markCacheDirty('taps');
                tabCache.taps.data = null;
                tabCache.taps.timestamp = 0;
                loadTaps();
                return `仓库 ${tap} 已移除`;
            } catch (err) {
                throw new Error(`移除失败: ${err.message}`);
            }
        }
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
        showToast('服务列表已刷新', 'success');
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

    const countEl = document.getElementById('service-page-count');
    if (countEl) countEl.textContent = filtered.length + ' 个';

    const container = document.getElementById('services-list');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = services.length === 0
            ? emptyStateHTML(SERVICE_ICON, '暂无服务', '当 Formula 提供后台守护进程（如 mysql、redis）时，这里会显示服务')
            : emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的服务', '换个关键词试试');
        return;
    }

    container.innerHTML = filtered.map(sv => {
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
    }).join('');
}

window.restartService = restartService;
async function restartService(name, btn) {
    if (servicesBusy) return;
    servicesBusy = true;
    const actions = document.querySelectorAll('.service-action-btn');
    actions.forEach(b => { b.disabled = true; });
    if (btn) btn.classList.add('is-busy');
    showToast(`正在重启 ${name}...`, 'info');
    try {
        await Service.RestartService(name);
        showToast(`服务 ${name} 已重启`, 'success');
        reloadServices();
    } catch (err) {
        actions.forEach(b => { b.disabled = false; });
        if (btn) btn.classList.remove('is-busy');
        showToast(`重启失败: ${err.message}`, 'error');
    }
    servicesBusy = false;
}

// After a service action, invalidate caches and reload the list
function reloadServices() {
    markCacheDirty('services');
    tabCache.services.data = null;
    tabCache.services.timestamp = 0;
    setTimeout(() => {
        if (currentTab === 'dashboard') {
            refreshDashboard();
        } else {
            loadServices();
        }
    }, 400);
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
                <button class="service-action-btn service-action-sm ${isRunning ? 'service-action-running' : 'service-action-stopped'}" onclick="toggleService('${escapeHtml(sv.name)}', ${isRunning})" title="${isRunning ? '运行中 · 点击停止' : '已停止 · 点击启动'}">
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

    showToast(`正在${on ? '启动' : '停止'} ${name}...`, 'info');
    try {
        if (on) {
            await Service.StartService(name);
        } else {
            await Service.StopService(name);
        }
        showToast(`服务 ${name} 已${on ? '启动' : '停止'}`, 'success');
        reloadServices();
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
    return div.innerHTML;
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
function showModalLoading(title, bodyHTML, onConfirm, modalClassName) {
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
        '将执行 <code>brew update</code> 更新 Homebrew 本体与各仓库索引，建议定期执行。\n更新可能需要一些时间，请稍候。',
        async () => {
            try {
                const result = await Service.UpdateWithOutput();
                // Invalidate affected caches after a successful update
                markCacheDirty('config');
                markCacheDirty('dashboard');
                markCacheDirty('outdated');
                tabCache.config.data = null;
                tabCache.config.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                tabCache.outdated.data = null;
                tabCache.outdated.timestamp = 0;
                if (currentTab === 'dashboard') refreshDashboard();
                return result.trim() || '✓ brew update 完成！';
            } catch (err) {
                throw new Error(`更新失败: ${err.message}`);
            }
        },
        'modal-lg'
    );
};

// ===== Doctor / Vulnerabilities (opened as modals from the dashboard) =====
// 系统诊断：直接弹框运行 brew doctor，不再跳转配置页
window.runDoctorQuick = function() {
    showModalLoading(
        '系统诊断',
        '将运行 <code>brew doctor</code> 检查 Homebrew 环境健康状况。\n诊断可能需要一些时间，请稍候。',
        async () => {
            try {
                const result = await Service.Doctor();
                return result || '✓ 系统健康，未发现异常';
            } catch (err) {
                throw new Error(`诊断失败: ${err.message}`);
            }
        },
        'modal-lg'
    );
};

// ===== Config =====
async function loadConfig() {
    // Disk usage
    renderConfigDiskUsage();
}

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
        const barCls = label.includes('Cellar') ? 'disk-bar-box' : label.includes('Caskroom') ? 'disk-bar-app' : 'disk-bar-trash';
        const iconCls = label.includes('Cellar') ? 'disk-icon-box' : label.includes('Caskroom') ? 'disk-icon-app' : 'disk-icon-trash';
        const iconSvg = label.includes('Cellar') ? CELLAR_SVG : label.includes('Caskroom') ? CASK_SVG : CACHE_SVG;
        return `<div class="disk-usage-item"><div class="disk-icon ${iconCls}">${iconSvg}</div><div class="disk-info"><div class="disk-line"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(size)}</span></div><div class="disk-bar"><div class="disk-bar-fill ${barCls}" style="width:${pct}%"></div></div></div></div>`;
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
                return result || '✓ 未发现已知安全漏洞';
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
    // Refresh the installed list so the button state (锁定/解锁) updates
    setTimeout(() => {
        markCacheDirty('installed');
        tabCache.installed.data = null;
        tabCache.installed.timestamp = 0;
        installedPackages = [];
        loadInstalled(currentTab);
    }, 300);
}

window.pinPackage = pinPackage;
async function pinPackage(name) {
    showToast(`${name} 正在锁定...`, 'info');
    try {
        await Service.Pin(name);
        showToast(`${name} 已锁定`, 'success');
    } catch (err) {
        showToast('锁定失败: ' + err.message, 'error');
    }
}

window.unpinPackage = unpinPackage;
async function unpinPackage(name) {
    showToast(`${name} 正在解锁...`, 'info');
    try {
        await Service.Unpin(name);
        showToast(`${name} 已解锁`, 'success');
    } catch (err) {
        showToast('解锁失败: ' + err.message, 'error');
    }
}

window.linkPackage = linkPackage;
async function linkPackage(name) {
    showToast(`${name} 正在链接...`, 'info');
    try {
        await Service.Link(name);
        showToast(`${name} 已链接`, 'success');
    } catch (err) {
        showToast(`链接失败: ${err.message}`, 'error');
    }
}

window.unlinkPackage = unlinkPackage;
async function unlinkPackage(name) {
    showToast(`${name} 正在断开链接...`, 'info');
    try {
        await Service.Unlink(name);
        showToast(`${name} 已断开链接`, 'success');
    } catch (err) {
        showToast(`断开链接失败: ${err.message}`, 'error');
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
(async () => {
    // GetVersion is non-critical, don't block the dashboard render
    Service.GetVersion().then(version => {
        document.getElementById('brew-version').textContent = version;
    }).catch(() => {
        document.getElementById('brew-version').textContent = 'Brew 未安装';
    });
    // Load dashboard immediately (first load, no cache)
    refreshDashboard();


})();
