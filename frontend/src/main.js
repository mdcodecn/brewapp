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
}

// ===== Package Detail Modal =====
let currentDetailPackage = null;

window.showDetailModal = showDetailModal;
function showDetailModal(pkg) {
    currentDetailPackage = pkg;
    document.getElementById('detail-modal-title').textContent = pkg.name;
    const body = document.getElementById('detail-modal-body');
    const actionBtn = document.getElementById('detail-modal-action');
    actionBtn.style.display = 'none';

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
    const actionBtn = document.getElementById('detail-modal-action');

    let html = `
        <div class="detail-info-grid">
            <div class="detail-info-item">
                <div class="label">名称</div>
                <div class="value">${escapeHtml(info.name)}</div>
            </div>
            <div class="detail-info-item">
                <div class="label">版本</div>
                <div class="value">${escapeHtml(info.version || '-')}</div>
            </div>
            <div class="detail-info-item">
                <div class="label">类型</div>
                <div class="value"><span class="type-badge ${info.type}">${info.type}</span></div>
            </div>
            <div class="detail-info-item">
                <div class="label">描述</div>
                <div class="value" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(info.description || '暂无描述')}</div>
            </div>
        </div>
    `;

    // Load dependencies (async, don't block the main info display)
    Service.GetDependencies(info.name).then(deps => {
        if (deps && deps.length > 0) {
            html += `<div style="margin-top:16px;"><strong>依赖 (${deps.length}):</strong>`;
            html += `<div class="detail-deps-list">`;
            deps.forEach(dep => {
                html += `<span class="dep-tag">${escapeHtml(dep)}</span>`;
            });
            html += `</div></div>`;
        } else {
            html += `<div style="margin-top:16px;color:var(--text-secondary);font-size:13px;">暂无依赖信息</div>`;
        }
        body.innerHTML = html;
    }).catch(() => {
        // Dependencies failed, still show basic info
        body.innerHTML = html;
    });

    // Set action buttons based on installed status (not dependent on deps loading)
    if (info.installed) {
        // Add pin/unpin button
        const pinBtn = document.createElement('button');
        pinBtn.textContent = '锁定';
        pinBtn.className = 'btn btn-secondary';
        pinBtn.onclick = () => {
            closeDetailModal();
            pinPackage(info.name);
        };
        actionBtn.parentNode.insertBefore(pinBtn, actionBtn);

        // Add reinstall button before the action button
        const reinstallBtn = document.createElement('button');
        reinstallBtn.textContent = '重装';
        reinstallBtn.className = 'btn btn-secondary';
        reinstallBtn.onclick = () => {
            closeDetailModal();
            reinstallPackage(info.name, info.type);
        };
        actionBtn.parentNode.insertBefore(reinstallBtn, actionBtn);

        // Add link/unlink button for casks
        if (info.type === 'cask') {
            const linkBtn = document.createElement('button');
            linkBtn.textContent = '链接';
            linkBtn.className = 'btn btn-secondary';
            linkBtn.onclick = () => {
                closeDetailModal();
                unlinkPackage(info.name);
            };
            actionBtn.parentNode.insertBefore(linkBtn, actionBtn);
        }

        actionBtn.textContent = '卸载';
        actionBtn.className = 'btn btn-danger';
        actionBtn.style.display = 'inline-flex';
        actionBtn.onclick = () => {
            closeDetailModal();
            uninstallPackage(info.name, info.type);
        };
    } else {
        actionBtn.textContent = '安装';
        actionBtn.className = 'btn btn-primary';
        actionBtn.style.display = 'inline-flex';
        actionBtn.onclick = () => {
            closeDetailModal();
            installPackage(info.name, info.type);
        };
    }

    body.innerHTML = html;
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
    // Config tab includes update, doctor, vulns
    if (tab === 'config' || tab === 'update' || tab === 'doctor' || tab === 'vulns') {
        tabCache.config.data = null;
        tabCache.config.timestamp = 0;
    }
}

// ===== Dashboard =====
window.refreshDashboard = refreshDashboard;
async function refreshDashboard(force) {
    if (force) {
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
    }

    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.dashboard)) {
        renderDashboard(tabCache.dashboard.data);
        // Still refresh disk usage and outdated in background
        Promise.allSettled([
            Service.GetDiskUsage().then(diskUsage => {
                if (currentTab === 'dashboard' && tabCache.dashboard.data) {
                    tabCache.dashboard.data.diskUsage = diskUsage;
                    tabCache.dashboard.data._diskLoaded = true;
                    renderDashboard(tabCache.dashboard.data);
                }
            }).catch(() => {}),
            refreshDashboardInBackground(),
        ]);
        return;
    }

    // Always render immediately with pre-loaded data (zero wait)
    const quickData = {
        packages: installedPackages,
        diskUsage: {},
        outdated: tabCache.outdated.data || [],
        _outdatedLoaded: !!tabCache.outdated.data,
        _diskLoaded: false,
    };
    tabCache.dashboard.data = quickData;
    tabCache.dashboard.timestamp = Date.now();
    renderDashboard(quickData);
    setDashboardRefreshing(true);

    // Fetch everything in background (don't block initial render)
    Promise.allSettled([
        Service.ListInstalled().then(packages => {
            if (currentTab === 'dashboard' && tabCache.dashboard.data) {
                tabCache.dashboard.data.packages = packages;
                installedPackages = packages;
                renderDashboard(tabCache.dashboard.data);
            }
        }).catch(() => {}),
        Service.GetDiskUsage().then(diskUsage => {
            if (currentTab === 'dashboard' && tabCache.dashboard.data) {
                tabCache.dashboard.data.diskUsage = diskUsage;
                tabCache.dashboard.data._diskLoaded = true;
                renderDashboard(tabCache.dashboard.data);
            }
        }).catch(() => {}),
        refreshDashboardInBackground(),
    ]).finally(() => {
        if (currentTab === 'dashboard') setDashboardRefreshing(false);
    });
}

async function refreshDashboardInBackground() {
    try {
        const outdated = await Service.GetOutdated();
        tabCache.dashboard.data.outdated = outdated;
        tabCache.dashboard.data._outdatedLoaded = true;
        tabCache.dashboard.timestamp = Date.now();
        // Only re-render if still on dashboard tab
        if (currentTab === 'dashboard') {
            renderDashboard(tabCache.dashboard.data);
        }
    } catch (err) {
        // Silently fail for background refresh
    }
}

async function fetchDashboardData() {
    // Parallel: all three Go calls run simultaneously
    const [packages, outdated, diskUsage] = await Promise.all([
        Service.ListInstalled(),
        Service.GetOutdated(),
        Service.GetDiskUsage(),
    ]);
    return { packages, outdated, diskUsage };
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

// Set a stat value with a subtle count-up animation (skipped on first paint)
function setStatValue(el, value) {
    if (!el) return;
    const prev = parseInt(el.dataset.value || '-1', 10);
    el.classList.remove('skeleton-text');
    if (prev >= 0 && prev !== value) {
        animateNumber(el, prev, value);
    } else {
        el.textContent = value;
    }
    el.dataset.value = value;
}

function animateNumber(el, from, to) {
    const startTime = performance.now();
    const duration = 450;
    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
        el.textContent = Math.round(from + (to - from) * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

// Parse "1.2G" / "345M" / "12K" / "1.2 GB" style sizes into bytes
function parseSize(str) {
    if (!str) return 0;
    const m = String(str).trim().match(/^([\d.]+)\s*([KMGTP]?)(?:i?B)?$/i);
    if (!m) return 0;
    const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }[m[2].toUpperCase()] || 1;
    return parseFloat(m[1]) * mult;
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

function computeTotalDisk(diskUsage) {
    return Object.keys(diskUsage || {}).reduce((sum, k) => sum + parseSize(diskUsage[k]), 0);
}

const DISK_ICONS = {
    box: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    app: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
};
const DISK_INFO = {
    'Cellar':           { name: 'Cellar 安装目录', sub: '命令行工具（Formula）存放位置', icon: 'box' },
    'Caskroom':         { name: 'Caskroom 安装目录', sub: '图形应用（Cask）存放位置', icon: 'app' },
    'Cache':            { name: '缓存目录', sub: 'Homebrew 下载缓存', icon: 'trash' },
    'Cellar (Intel)':   { name: 'Cellar 安装目录（Intel）', sub: '命令行工具（Formula）存放位置', icon: 'box' },
    'Caskroom (Intel)': { name: 'Caskroom 安装目录（Intel）', sub: '图形应用（Cask）存放位置', icon: 'app' },
    'Cache (Intel)':    { name: '缓存目录（Intel）', sub: 'Homebrew 下载缓存', icon: 'trash' },
};
// Go map 序列化后键顺序不固定，按固定顺序展示
const DISK_ORDER = ['Cellar', 'Caskroom', 'Cache', 'Cellar (Intel)', 'Caskroom (Intel)', 'Cache (Intel)'];

// ===== Shared icons (inline SVG, sized for list rows) =====
const CASK_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;
const FORMULA_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
const OUTDATED_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
const SEARCH_OFF_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="8" x2="14" y2="14"/><line x1="14" y1="8" x2="8" y2="14"/></svg>`;
const TAP_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

// Nicer empty-state block with an icon, title and optional hint
function emptyStateHTML(icon, title, sub) {
    return `<div class="empty-state-box">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${escapeHtml(title)}</div>
        ${sub ? `<div class="empty-state-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function renderDashboard(data) {
    const { packages, outdated, diskUsage } = data;

    const formulas = packages.filter(p => p.type === 'formula');
    const casks = packages.filter(p => p.type === 'cask');

    // Stats cards
    setStatValue(document.getElementById('stat-formulas'), formulas.length);
    setStatValue(document.getElementById('stat-casks'), casks.length);
    setStatValue(document.getElementById('stat-outdated'), outdated.length);

    const outdatedSub = document.getElementById('stat-outdated-sub');
    outdatedSub.textContent = data._outdatedLoaded
        ? (outdated.length === 0 ? '已是最新' : '点击查看')
        : '加载中…';

    const diskBytes = computeTotalDisk(diskUsage);
    const diskEl = document.getElementById('stat-disk');
    if (data._diskLoaded) {
        diskEl.classList.remove('skeleton-text');
        diskEl.textContent = formatBytes(diskBytes);
    }
    document.getElementById('stat-disk-sub').textContent =
        data._diskLoaded ? 'Homebrew 目录占用' : '正在统计…';

    // Outdated badge (sidebar)
    const badge = document.getElementById('outdated-badge');
    if (outdated.length > 0) {
        badge.style.display = 'inline';
        badge.textContent = outdated.length;
    } else {
        badge.style.display = 'none';
    }

    // Sidebar badges for cask and formula counts
    const caskBadge = document.getElementById('cask-count-badge');
    const formulaBadge = document.getElementById('formula-count-badge');
    if (casks.length > 0) {
        caskBadge.style.display = 'inline';
        caskBadge.textContent = casks.length;
    } else {
        caskBadge.style.display = 'none';
    }
    if (formulas.length > 0) {
        formulaBadge.style.display = 'inline';
        formulaBadge.textContent = formulas.length;
    } else {
        formulaBadge.style.display = 'none';
    }

    renderDiskUsage(diskUsage, data._diskLoaded);
    renderOutdatedPreview(outdated, data._outdatedLoaded);
}

// ===== Disk Usage =====
function renderDiskUsage(diskUsage, loaded) {
    const grid = document.getElementById('disk-usage-grid');
    if (!grid) return;

    // Not loaded yet - show skeleton rows
    if (!loaded || !diskUsage || Object.keys(diskUsage).length === 0) {
        grid.innerHTML = Array.from({ length: 3 }, () => `
            <div class="disk-usage-item">
                <div class="skeleton" style="width:36px;height:36px;border-radius:10px;flex-shrink:0;"></div>
                <div class="disk-info">
                    <div class="skeleton" style="width:55%;height:13px;"></div>
                    <div class="skeleton" style="width:100%;height:5px;"></div>
                    <div class="skeleton" style="width:45%;height:10px;"></div>
                </div>
            </div>`).join('');
        return;
    }

    const labels = DISK_ORDER.filter(k => diskUsage[k] !== undefined);
    Object.keys(diskUsage).forEach(k => { if (!labels.includes(k)) labels.push(k); });
    if (labels.length === 0) {
        grid.innerHTML = '<div class="disk-empty">暂无磁盘数据</div>';
        return;
    }

    const items = labels.map(label => {
        const info = DISK_INFO[label] || { name: label, sub: '', icon: 'box' };
        return { label, name: info.name, sub: info.sub, icon: info.icon, size: diskUsage[label], bytes: parseSize(diskUsage[label]) };
    });
    const maxBytes = Math.max(...items.map(i => i.bytes), 1);

    grid.innerHTML = items.map(item => {
        const pct = Math.round(item.bytes / maxBytes * 100);
        return `
            <div class="disk-usage-item">
                <div class="disk-icon disk-icon-${item.icon}">${DISK_ICONS[item.icon]}</div>
                <div class="disk-info">
                    <div class="disk-line">
                        <span class="label">${escapeHtml(item.name)}</span>
                        <span class="value">${escapeHtml(item.size)}</span>
                    </div>
                    <div class="disk-bar"><div class="disk-bar-fill disk-bar-${item.icon}" style="width:${Math.max(pct, 4)}%"></div></div>
                    <span class="sub">${escapeHtml(item.sub)}</span>
                </div>
            </div>`;
    }).join('');
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
                <div class="skeleton" style="width:110px;height:12px;"></div>
                <div class="skeleton" style="width:38px;height:12px;"></div>
                <div class="skeleton" style="width:46px;height:22px;border-radius:8px;"></div>
            </div>`).join('');
        return;
    }

    if (countEl) countEl.textContent = outdated.length;

    if (outdated.length === 0) {
        container.innerHTML = `
            <div class="outdated-empty">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>所有包都是最新的</span>
            </div>`;
        return;
    }

    const top = outdated.slice(0, 5);
    container.innerHTML = top.map((p, i) => `
        <div class="outdated-item" style="animation-delay:${i * 0.05}s;">
            <span class="outdated-name" title="${escapeHtml(p.description || p.name)}">${escapeHtml(p.name)}</span>
            ${p.version ? `<span class="outdated-version">${escapeHtml(p.version)}</span>` : ''}
            <button class="btn btn-primary btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
        </div>`).join('')
        + (outdated.length > 5 ? `
        <button class="outdated-more" onclick="switchTab('outdated')">
            查看全部 ${outdated.length} 个
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>` : '');
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
        showToast(type === 'cask' ? '应用列表已刷新' : '工具列表已刷新', 'success');
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
        showToast('可更新列表已刷新', 'success');
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
                `没有名称或描述包含「${search}」的${isCask ? '应用' : '工具'}`
            );
        } else {
            container.innerHTML = emptyStateHTML(
                isCask ? CASK_ICON : FORMULA_ICON,
                isCask ? '尚未安装任何应用' : '尚未安装任何命令行工具',
                '前往「搜索」页面查找并安装软件包'
            );
        }
        return;
    }
    container.innerHTML = filtered.map((p, i) => `
        <div class="pkg-item" style="animation-delay:${Math.min(i * 0.03, 0.3)}s;">
            <div class="pkg-icon pkg-icon-${type}">${isCask ? CASK_ICON : FORMULA_ICON}</div>
            <div class="pkg-main">
                <div class="pkg-name-row">
                    <span class="pkg-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                    <span class="pkg-version">${escapeHtml(p.version || '-')}</span>
                </div>
                <span class="pkg-desc">${escapeHtml(p.description || '暂无描述')}</span>
            </div>
            <div class="pkg-actions">
                <button class="btn btn-secondary btn-sm" onclick="showDetailModal(${JSON.stringify(p).replace(/'/g, "&#39;")})">详情</button>
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

function renderSearchResults(results) {
    const container = document.getElementById('search-results');
    const countEl = document.getElementById('search-result-count');
    if (!container) return;

    if (!results || results.length === 0) {
        container.innerHTML = emptyStateHTML(SEARCH_OFF_ICON, '未找到匹配的包', '换个关键词试试，如 git、google-chrome');
        if (countEl) countEl.style.display = 'none';
        return;
    }

    if (countEl) {
        countEl.style.display = 'inline-flex';
        countEl.textContent = results.length > 50
            ? `共 ${results.length} 个结果，显示前 50`
            : `${results.length} 个结果`;
    }

    container.innerHTML = results.slice(0, 50).map((r, i) => `
        <div class="result-item" style="animation-delay:${Math.min(i * 0.03, 0.3)}s;">
            <div class="result-icon result-icon-${r.type}">${r.type === 'cask' ? CASK_ICON : FORMULA_ICON}</div>
            <div class="result-main">
                <div class="result-name-row">
                    <span class="result-name">${escapeHtml(r.name)}</span>
                    ${r.version ? `<span class="result-version">${escapeHtml(r.version)}</span>` : ''}
                    <span class="type-badge ${r.type}">${r.type === 'cask' ? '应用' : '公式'}</span>
                </div>
                <span class="result-desc">${escapeHtml(r.description || '暂无描述')}</span>
            </div>
            <div class="result-actions">
                ${r.installed
                    ? `<span class="installed-tag">✓ 已安装</span>
                       <button class="btn btn-sm btn-secondary" onclick="showDetailFromSearch('${escapeHtml(r.name)}','${r.type}')">详情</button>`
                    : `<button class="btn btn-sm btn-primary" onclick="installPackage('${escapeHtml(r.name)}', '${r.type}')">安装</button>`}
            </div>
        </div>
    `).join('');
}

window.showDetailFromSearch = function(name, type) {
    showDetailModal({ name, type });
};

async function doSearch(query) {
    const container = document.getElementById('search-results');
    if (!container) return;
    container.innerHTML = '<div class="loading-state"><span class="spinner"></span> 搜索中...</div>';
    const countEl = document.getElementById('search-result-count');
    if (countEl) countEl.style.display = 'none';

    try {
        const results = await Service.Search(query);
        renderSearchResults(results);
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

    container.innerHTML = filtered.map((p, i) => `
        <div class="pkg-item" style="animation-delay:${Math.min(i * 0.03, 0.3)}s;">
            <div class="pkg-icon pkg-icon-outdated">${OUTDATED_ICON}</div>
            <div class="pkg-main">
                <div class="pkg-name-row">
                    <span class="pkg-name">${escapeHtml(p.name)}</span>
                    <span class="pkg-version">当前 ${escapeHtml(p.version || '-')}</span>
                    <span class="type-badge ${escapeHtml(p.type)}">${escapeHtml(p.type === 'cask' ? '应用' : '公式')}</span>
                </div>
                <span class="pkg-desc">检测到可用更新，点击右侧按钮升级</span>
            </div>
            <div class="pkg-actions">
                <button class="btn btn-primary btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
            </div>
        </div>
    `).join('');
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
        '确定要更新所有可更新的包吗？这可能需要较长时间。',
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

window.exportConfig = exportConfig;
async function exportConfig() {
    try {
        // Go side opens a native save dialog and writes the file,
        // returning the saved path (empty if the user cancelled)
        const path = await Service.ExportConfig();
        if (!path) {
            showToast('已取消导出', 'info');
            return;
        }
        showToast('配置已导出: ' + path, 'success');
    } catch (err) {
        showToast('导出失败: ' + err.message, 'error');
    }
}

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

// ===== Taps Management =====
async function loadTaps() {
    if (isCacheValid(tabCache.taps)) {
        renderTaps(tabCache.taps.data);
        loadTapsInBackground();
        return;
    }

    try {
        const taps = await Service.GetTaps();
        tabCache.taps.data = taps;
        tabCache.taps.timestamp = Date.now();
        renderTaps(taps);
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
            renderTaps(taps);
        }
    } catch (err) {
        // Silently fail
    }
}

function renderTaps(taps) {
    // Update sidebar badge
    const tapBadge = document.getElementById('tap-count-badge');
    if (taps.length > 0) {
        tapBadge.style.display = 'inline';
        tapBadge.textContent = taps.length;
    } else {
        tapBadge.style.display = 'none';
    }

    const pageCount = document.getElementById('tap-page-count');
    if (pageCount) pageCount.textContent = taps.length + ' 个';

    document.getElementById('taps-list').innerHTML = taps.length > 0
        ? taps.map((t, i) => {
            const tapName = t.split(' ')[0];
            const rest = t.slice(tapName.length).trim();
            return `<div class="tap-item" style="animation-delay:${Math.min(i * 0.03, 0.3)}s;">
                <div class="tap-icon">${TAP_ICON}</div>
                <div class="tap-main">
                    <span class="tap-name" title="${escapeHtml(t)}">${escapeHtml(tapName)}</span>
                    ${rest ? `<span class="tap-desc">${escapeHtml(rest)}</span>` : ''}
                </div>
                <button class="btn btn-danger btn-sm" onclick="removeTap('${escapeHtml(tapName)}')">移除</button>
            </div>`;
        }).join('')
        : emptyStateHTML(TAP_ICON, '暂无 Taps', '在上方输入 tap 名称添加，如 homebrew/cask');
}

window.addTap = addTap;
async function addTap() {
    const input = document.getElementById('tap-input');
    const tap = input.value.trim();
    if (!tap) {
        showToast('请输入 tap 名称', 'error');
        return;
    }
    const btn = input.nextElementSibling;
    setButtonLoading(btn, true, '添加 Tap');
    try {
        await Service.AddTap(tap);
        showToast(`Tap ${tap} 添加成功`, 'success');
        input.value = '';
        markCacheDirty('taps');
        tabCache.taps.data = null;
        tabCache.taps.timestamp = 0;
        loadTaps();
    } catch (err) {
        showToast('添加 Tap 失败: ' + err.message, 'error');
    }
    setButtonLoading(btn, false, '添加 Tap');
}

window.removeTap = removeTap;
async function removeTap(tap) {
    showModalLoading(
        '确认移除 Tap',
        `确定要移除 tap <strong>${escapeHtml(tap)}</strong> 吗？`,
        async () => {
            try {
                await Service.RemoveTap(tap);
                markCacheDirty('taps');
                tabCache.taps.data = null;
                tabCache.taps.timestamp = 0;
                loadTaps();
                return `Tap ${tap} 已移除`;
            } catch (err) {
                throw new Error(`移除失败: ${err.message}`);
            }
        }
    );
}

// ===== Utility =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
function showModalLoading(title, bodyHTML, onConfirm) {
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    body.innerHTML = bodyHTML;
    document.getElementById('modal-overlay').style.display = 'flex';
    const confirmBtn = document.getElementById('modal-confirm');
    const newBtn = confirmBtn.cloneNode(true);
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
            if (result) renderModalResult(body, 'success', result);
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

// ===== Update (in config tab) =====
window.runUpdate = async function() {
    const btn = document.getElementById('update-btn');
    const output = document.getElementById('update-output');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 更新中...';
    output.textContent = '正在执行 brew update...\n';

    try {
        await Service.Update();
        output.textContent += '\n✓ brew update 完成！';
        showToast('更新完成', 'success');
        markCacheDirty('config');
        tabCache.config.data = output.textContent;
        tabCache.config.timestamp = Date.now();
        // Refresh dashboard and outdated
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        tabCache.outdated.data = null;
        tabCache.outdated.timestamp = 0;
    } catch (err) {
        output.textContent += '\n✗ 更新失败: ' + err.message;
        showToast('更新失败: ' + err.message, 'error');
    }
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg> 执行 brew update`;
}

// ===== Doctor (in config tab) =====
window.runDoctor = async function() {
    const btn = document.getElementById('doctor-btn');
    const output = document.getElementById('doctor-output');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 诊断中...';
    output.textContent = '正在运行 brew doctor...\n';

    try {
        const result = await Service.Doctor();
        output.textContent = result || '✓ 系统健康，未发现异常';
        if (output.textContent.includes('Error') || output.textContent.includes('error')) {
            showToast('诊断发现警告', 'error');
        } else {
            showToast('诊断完成', 'success');
        }
        markCacheDirty('config');
        tabCache.config.data = output.textContent;
        tabCache.config.timestamp = Date.now();
    } catch (err) {
        output.textContent = '诊断失败: ' + err.message;
        showToast('诊断失败', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg> 运行 brew doctor`;
}

// ===== Config =====
async function loadConfig() {
    if (isCacheValid(tabCache.config)) {
        document.getElementById('config-output').textContent = tabCache.config.data || '';
        return;
    }
    try {
        const result = await Service.Config();
        document.getElementById('config-output').textContent = result || '暂无配置信息';
        tabCache.config.data = result;
        tabCache.config.timestamp = Date.now();
    } catch (err) {
        document.getElementById('config-output').textContent = '加载配置失败: ' + err.message;
    }
}

// ===== Vulnerabilities (in config tab) =====
window.runVulns = async function() {
    const btn = document.getElementById('vulns-btn');
    const output = document.getElementById('vulns-output');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 扫描中...';
    output.textContent = '正在扫描已知安全漏洞...\n';

    try {
        const result = await Service.GetVulns();
        output.textContent = result || '✓ 未发现已知安全漏洞';
        if (output.textContent.includes('Vulnerabilities') && !output.textContent.includes('No vulnerabilities')) {
            showToast('发现安全漏洞', 'error');
        } else {
            showToast('扫描完成，无漏洞', 'success');
        }
        markCacheDirty('config');
        tabCache.config.data = output.textContent;
        tabCache.config.timestamp = Date.now();
    } catch (err) {
        output.textContent = '扫描失败: ' + err.message;
        showToast('扫描失败', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg> 扫描漏洞`;
}

// ===== Quick action: jump to config tab and start the vulnerability scan =====
window.runVulnsQuick = function() {
    switchTab('config');
    setTimeout(() => {
        const section = document.getElementById('vulns-section');
        if (!section) return;
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const btn = section.querySelector('.btn-primary');
        if (btn && !btn.disabled) btn.click();
    }, 300);
};

// ===== Pin / Unpin =====
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

// ===== Link / Unlink =====
window.linkPackage = linkPackage;
async function linkPackage(name) {
    showToast(`${name} 正在链接...`, 'info');
    try {
        await Service.Link(name);
        showToast(`${name} 已链接`, 'success');
    } catch (err) {
        showToast('链接失败: ' + err.message, 'error');
    }
}

window.unlinkPackage = unlinkPackage;
async function unlinkPackage(name) {
    showToast(`${name} 正在取消链接...`, 'info');
    try {
        await Service.Unlink(name);
        showToast(`${name} 已取消链接`, 'success');
    } catch (err) {
        showToast('取消链接失败: ' + err.message, 'error');
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
