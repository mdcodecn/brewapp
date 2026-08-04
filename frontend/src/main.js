// ===== Wails Bindings =====
import * as App from '../wailsjs/go/main/App';
import * as Service from '../wailsjs/go/main/Service';

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
    else if (tab === 'config') loadConfig();
}

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
(async () => {
    try {
        installedPackages = await Service.ListInstalled();
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
async function refreshDashboard() {
    const btn = document.querySelector('#tab-dashboard .page-header .btn-primary');

    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.dashboard)) {
        setButtonLoading(btn, true, '刷新');
        renderDashboard(tabCache.dashboard.data);
        // Still refresh disk usage and outdated in background
        Promise.allSettled([
            Service.GetDiskUsage().then(diskUsage => {
                if (currentTab === 'dashboard' && tabCache.dashboard.data) {
                    tabCache.dashboard.data.diskUsage = diskUsage;
                    renderDashboard(tabCache.dashboard.data);
                }
            }).catch(() => {}),
            refreshDashboardInBackground(),
        ]).finally(() => setButtonLoading(btn, false, '刷新'));
        return;
    }

    // Always render immediately with pre-loaded data (zero wait)
    setButtonLoading(btn, true, '刷新');
    const quickData = { packages: installedPackages, diskUsage: {}, outdated: [], _outdatedLoaded: false };
    tabCache.dashboard.data = quickData;
    tabCache.dashboard.timestamp = Date.now();
    renderDashboard(quickData);

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
                renderDashboard(tabCache.dashboard.data);
            }
        }).catch(() => {}),
        refreshDashboardInBackground(),
    ]).finally(() => setButtonLoading(btn, false, '刷新'));
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

function renderDashboard(data) {
    const { packages, outdated, diskUsage } = data;

    const casks = packages.filter(p => p.type === 'cask');

    // Stats - always render immediately
    document.getElementById('stat-total').textContent = packages.length;
    document.getElementById('stat-total').classList.remove('skeleton-text');
    document.getElementById('stat-casks').textContent = casks.length;
    document.getElementById('stat-casks').classList.remove('skeleton-text');
    document.getElementById('stat-outdated').textContent = outdated.length;
    document.getElementById('stat-outdated').classList.remove('skeleton-text');

    // Outdated badge
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
    const formulas = packages.filter(p => p.type === 'formula');
    if (formulas.length > 0) {
        formulaBadge.style.display = 'inline';
        formulaBadge.textContent = formulas.length;
    } else {
        formulaBadge.style.display = 'none';
    }

    // Disk usage - render immediately (empty if no data yet)
    const diskGrid = document.getElementById('disk-usage-grid');
    diskGrid.innerHTML = '';
    for (const [label, value] of Object.entries(diskUsage)) {
        diskGrid.innerHTML += `
            <div class="disk-usage-item">
                <span class="label">${escapeHtml(label)}</span>
                <span class="value">${escapeHtml(value)}</span>
            </div>`;
    }
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
        tabCache.installed.data = packages;
        tabCache.installed.timestamp = Date.now();
        if (currentTab === 'installed-cask' || currentTab === 'installed-formula') {
            renderInstalled(type, packages);
        }
    } catch (err) {
        // Silently fail for background refresh
    }
}

function renderInstalled(type, packages) {
    const searchInputId = type === 'cask' ? 'installed-cask-search' : 'installed-formula-search';
    const containerId = type === 'cask' ? 'cask-list' : 'formula-list';
    const search = document.getElementById(searchInputId).value.toLowerCase();
    const filtered = packages.filter(p => {
        if (p.type !== type) return false;
        if (!search) return true;
        return p.name.toLowerCase().includes(search) ||
               (p.description && p.description.toLowerCase().includes(search));
    });

    const container = document.getElementById(containerId);
    if (filtered.length === 0) {
        if (packages.length === 0) {
            // Still loading — show skeletons
            container.innerHTML = Array.from({length: 5}, () => `
                <div class="skeleton-row">
                    <div class="skeleton sk-name"></div>
                    <div class="skeleton sk-version"></div>
                    <div class="skeleton sk-desc"></div>
                    <div class="skeleton sk-badge"></div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p class="empty-state">暂无数据</p>';
        }
        return;
    }
    container.innerHTML = filtered.map(p => `
        <div class="pkg-item">
            <span class="pkg-name">${escapeHtml(p.name)}</span>
            <span class="pkg-version">${escapeHtml(p.version || '-')}</span>
            <span class="pkg-desc">${escapeHtml(p.description || '-')}</span>
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
        async (confirmBtn) => {
            try {
                await Service.Reinstall(name, type);
                showToast(`${name} 重装成功`, 'success');
                // Reload after a short delay
                setTimeout(() => {
                    markCacheDirty('installed');
                    tabCache.installed.data = null;
                    tabCache.installed.timestamp = 0;
                    installedPackages = [];
                    loadInstalled(currentTab);
                }, 500);
            } catch (err) {
                showToast('重装失败: ' + err.message, 'error');
            }
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认';
        }
    );
}

window.uninstallPackage = uninstallPackage;
async function uninstallPackage(name, type) {
    showModalLoading(
        '确认卸载',
        `确定要卸载 <strong>${escapeHtml(name)}</strong> 吗？`,
        async (confirmBtn) => {
            try {
                await Service.Uninstall(name, type);
                showToast(`${name} 已卸载`, 'success');
                markCacheDirty('installed');
                // Clear cache and reload
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
                loadInstalled(currentTab);
            } catch (err) {
                showToast('卸载失败: ' + err.message, 'error');
            }
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认';
        }
    );
}

// ===== Topbar Search =====
let searchTimeout = null;

function closeTopbarSearch() {
    const dropdown = document.getElementById('topbar-search-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    const input = document.getElementById('topbar-search-input');
    if (input) input.blur();
}

function renderTopbarSearchResults(results) {
    const dropdown = document.getElementById('topbar-search-dropdown');
    if (!dropdown) return;

    if (!results || results.length === 0) {
        dropdown.innerHTML = '<div class="empty-state">未找到匹配的结果</div>';
        return;
    }

    dropdown.innerHTML = results.slice(0, 12).map(r => `
        <div class="search-result-item" onclick="topbarInstallPackage('${escapeHtml(r.name)}', '${r.type}')">
            <span class="result-name">${escapeHtml(r.name)}</span>
            <span class="result-type ${r.type}">${r.type === 'cask' ? '应用' : '公式'}</span>
            ${r.installed ? '<span style="font-size:11px;color:var(--success);">✓ 已安装</span>' : ''}
            <span class="result-desc">${escapeHtml(r.description || '')}</span>
        </div>
    `).join('');
}

window.topbarInstallPackage = async function(name, type) {
    closeTopbarSearch();
    showModalLoading(
        '确认安装',
        `确定要安装 <strong>${escapeHtml(name)}</strong> 吗？`,
        async (confirmBtn) => {
            try {
                await Service.Install(name, type);
                showToast(`${name} 安装成功`, 'success');
                markCacheDirty('installed');
                markCacheDirty('dashboard');
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
            } catch (err) {
                showToast('安装失败: ' + err.message, 'error');
            }
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认';
        }
    );
};

async function topbarDoSearch(query) {
    const dropdown = document.getElementById('topbar-search-dropdown');
    if (!dropdown) return;
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="loading-state" style="padding:12px;"><span class="spinner"></span> 搜索中...</div>';

    try {
        const results = await Service.Search(query);
        renderTopbarSearchResults(results);
    } catch (err) {
        dropdown.innerHTML = `<div class="empty-state">搜索失败: ${err.message}</div>`;
    }
}

window.topbarDebounceSearch = function() {
    clearTimeout(searchTimeout);
    const input = document.getElementById('topbar-search-input');
    if (!input) return;
    searchTimeout = setTimeout(() => topbarDoSearch(input.value), 300);
};

window.installPackage = installPackage;
async function installPackage(name, type) {
    showModalLoading(
        '确认安装',
        `确定要安装 <strong>${escapeHtml(name)}</strong> 吗？`,
        async (confirmBtn) => {
            try {
                await Service.Install(name, type);
                showToast(`${name} 安装成功`, 'success');
                markCacheDirty('installed');
                markCacheDirty('dashboard');
                // Clear cache and reload
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
            } catch (err) {
                showToast('安装失败: ' + err.message, 'error');
            }
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认';
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
        document.getElementById('outdated-tbody').innerHTML =
            `<tr><td colspan="4" class="empty-state">加载失败: ${err.message}</td></tr>`;
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

window.upgradePackage = upgradePackage;
function renderOutdated(outdated) {
    const tbody = document.getElementById('outdated-tbody');

    if (outdated.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">所有包都是最新的 ✓</td></tr>';
        return;
    }

    tbody.innerHTML = outdated.map(p => `
        <tr>
            <td class="name-cell">${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.version || '-')}</td>
            <td><span class="type-badge ${p.type}">${escapeHtml(p.type)}</span></td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
            </td>
        </tr>
    `).join('');
}

async function upgradePackage(name) {
    // Find the button in the outdated table for this package
    const rows = document.querySelectorAll('#outdated-tbody tr');
    let targetBtn = null;
    for (const row of rows) {
        const nameCell = row.querySelector('.name-cell');
        if (nameCell && nameCell.textContent === name) {
            targetBtn = row.querySelector('.btn');
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
        loadOutdated();
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
        const content = await Service.ExportConfig();
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `brew-config-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('配置已导出', 'success');
    } catch (err) {
        showToast('导出失败: ' + err.message, 'error');
    }
}

window.cleanupBrew = cleanupBrew;
async function cleanupBrew() {
    const btn = document.querySelector('.dashboard-section .settings-actions .btn-secondary:nth-child(2)');
    showModalLoading(
        '清理缓存',
        '确定要清理 Homebrew 缓存和旧版本吗？',
        async (confirmBtn) => {
            try {
                setButtonLoading(btn, true, '清理缓存');
                await Service.Cleanup();
                showToast('清理完成', 'success');
                markCacheDirty('dashboard');
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                refreshDashboard();
            } catch (err) {
                showToast('清理失败: ' + err.message, 'error');
            }
            setButtonLoading(btn, false, '清理缓存');
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认';
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

    document.getElementById('taps-list').innerHTML = taps.length > 0
        ? taps.map(t => {
            const tapName = t.split(' ')[0];
            return `<div class="tap-item">
                <span class="tap-name">${escapeHtml(tapName)}</span>
                <button class="btn btn-danger btn-sm" onclick="removeTap('${escapeHtml(tapName)}')" style="padding:2px 8px;font-size:11px;">移除</button>
            </div>`;
        }).join('')
        : '<p class="empty-state" style="padding:12px;">暂无 taps</p>';
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
        async (confirmBtn) => {
            try {
                await Service.RemoveTap(tap);
                showToast(`Tap ${tap} 已移除`, 'success');
                markCacheDirty('taps');
                tabCache.taps.data = null;
                tabCache.taps.timestamp = 0;
                loadTaps();
            } catch (err) {
                showToast('移除失败: ' + err.message, 'error');
            }
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '确认';
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
    body.innerHTML = bodyHTML + '<div class="loading-state" style="padding:16px 0;"><span class="spinner"></span> 执行中...</div>';
    document.getElementById('modal-overlay').style.display = 'flex';
    const confirmBtn = document.getElementById('modal-confirm');
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', () => {
        newBtn.disabled = true;
        newBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 执行中...';
        onConfirm(newBtn);
    });
}

window.setButtonLoading = setButtonLoading;
window.showModalLoading = showModalLoading;

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + S = Focus topbar search
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        const input = document.getElementById('topbar-search-input');
        if (input) input.focus();
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
    const btn = document.querySelector('#tab-config .settings-section:nth-of-type(2) .btn-primary');
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
    const btn = document.querySelector('#tab-config .settings-section:nth-of-type(3) .btn-primary');
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

// ===== Topbar Search =====
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('topbar-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => window.topbarDebounceSearch());
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeTopbarSearch();
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('topbar-search-dropdown');
        const wrapper = document.querySelector('.topbar-search-wrapper');
        if (dropdown && wrapper && !wrapper.contains(e.target)) {
            closeTopbarSearch();
        }
    });
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
