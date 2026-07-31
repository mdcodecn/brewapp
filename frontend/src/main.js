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
    else if (tab === 'settings') loadSettings();
    else if (tab === 'dependencies') loadDependencies();
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

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

// ===== Package Detail Modal =====
let currentDetailPackage = null;

function showDetailModal(pkg) {
    currentDetailPackage = pkg;
    document.getElementById('detail-modal-title').textContent = pkg.name;
    const body = document.getElementById('detail-modal-body');
    const actionBtn = document.getElementById('detail-modal-action');
    actionBtn.style.display = 'none';

    body.innerHTML = '<div class="loading-state"><span class="spinner"></span> 加载详情...</div>';
    document.getElementById('detail-modal-overlay').style.display = 'flex';

    // Load full package info
    window.go.main.Service.GetPackageInfo(pkg.name, pkg.type).then(info => {
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

    // Load dependencies
    window.go.main.Service.GetDependencies(info.name).then(deps => {
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

        // Set action buttons based on installed status
        if (info.installed) {
            // Add reinstall button before the action button
            const reinstallBtn = document.createElement('button');
            reinstallBtn.textContent = '重装';
            reinstallBtn.className = 'btn btn-secondary';
            reinstallBtn.onclick = () => {
                closeDetailModal();
                reinstallPackage(info.name, info.type);
            };
            actionBtn.parentNode.insertBefore(reinstallBtn, actionBtn);

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
    }).catch(() => {
        // Dependencies failed, still show basic info
        body.innerHTML = html + `<div style="margin-top:16px;color:var(--text-muted);font-size:12px;">依赖信息加载失败</div>`;
    });
}

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
    settings:    { data: null, timestamp: 0 },
    taps:        { data: null, timestamp: 0 },
};

// Pre-load installed packages on startup for instant tab switch
let installedPackages = [];
(async () => {
    try {
        installedPackages = await window.go.main.Service.ListInstalled();
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
    if (tab === 'settings') {
        tabCache.settings.data = null;
        tabCache.settings.timestamp = 0;
    }
    if (tab === 'taps') {
        tabCache.taps.data = null;
        tabCache.taps.timestamp = 0;
    }
}

// ===== Dashboard =====
async function refreshDashboard() {
    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.dashboard)) {
        renderDashboard(tabCache.dashboard.data);
        // Still refresh in background
        refreshDashboardInBackground();
        return;
    }

    try {
        // Quick: ListInstalled + GetDiskUsage (local, fast)
        const [packages, diskUsage] = await Promise.all([
            window.go.main.Service.ListInstalled(),
            window.go.main.Service.GetDiskUsage(),
        ]);
        const quickData = { packages, diskUsage, outdated: [] };
        tabCache.dashboard.data = quickData;
        tabCache.dashboard.timestamp = Date.now();
        renderDashboard(quickData);

        // Slow: GetOutdated (may need network, do in background)
        refreshDashboardInBackground();
    } catch (err) {
        showToast('加载失败: ' + err.message, 'error');
    }
}

async function refreshDashboardInBackground() {
    try {
        const outdated = await window.go.main.Service.GetOutdated();
        tabCache.dashboard.data.outdated = outdated;
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
        window.go.main.Service.ListInstalled(),
        window.go.main.Service.GetOutdated(),
        window.go.main.Service.GetDiskUsage(),
    ]);
    return { packages, outdated, diskUsage };
}

function renderDashboard(data) {
    const { packages, outdated, diskUsage } = data;

    const casks = packages.filter(p => p.type === 'cask');
    const formulas = packages.filter(p => p.type === 'formula');

    // Stats - immediate
    document.getElementById('stat-total').textContent = packages.length;
    document.getElementById('stat-total').classList.remove('skeleton-text');
    document.getElementById('stat-casks').textContent = casks.length;
    document.getElementById('stat-casks').classList.remove('skeleton-text');
    document.getElementById('stat-outdated').textContent = outdated.length;
    document.getElementById('stat-outdated').classList.remove('skeleton-text');

    // Sidebar badges
    const totalBadge = document.getElementById('dashboard-badge');
    totalBadge.style.display = packages.length > 0 ? 'inline' : 'none';
    totalBadge.textContent = packages.length;

    const caskBadge = document.getElementById('cask-badge');
    caskBadge.style.display = casks.length > 0 ? 'inline' : 'none';
    caskBadge.textContent = casks.length;

    const formulaBadge = document.getElementById('formula-badge');
    formulaBadge.style.display = formulas.length > 0 ? 'inline' : 'none';
    formulaBadge.textContent = formulas.length;

    // Outdated badge
    const badge = document.getElementById('outdated-badge');
    if (outdated.length > 0) {
        badge.style.display = 'inline';
        badge.textContent = outdated.length;
    } else {
        badge.style.display = 'none';
    }

    // Disk usage - immediate
    const diskGrid = document.getElementById('disk-usage-grid');
    diskGrid.innerHTML = '';
    for (const [label, value] of Object.entries(diskUsage)) {
        diskGrid.innerHTML += `
            <div class="disk-usage-item">
                <span class="label">${escapeHtml(label)}</span>
                <span class="value">${escapeHtml(value)}</span>
            </div>`;
    }

    // Recent actions - async, don't block the initial render
    loadRecentActions();
}

// ===== Installed =====
async function loadInstalled(tab) {
    const type = tab === 'installed-cask' ? 'cask' : 'formula';
    // Use pre-loaded data immediately, refresh in background
    renderInstalled(type, installedPackages);
    loadInstalledInBackground(type);
}

async function loadInstalledInBackground(type) {
    try {
        const packages = await window.go.main.Service.ListInstalled();
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
                <button class="btn btn-secondary btn-sm" onclick="showDetailModal(installedPackages.find(x => x.name === '${escapeHtml(p.name)}' && x))">详情</button>
                <button class="btn btn-warning btn-sm" onclick="reinstallPackage('${escapeHtml(p.name)}', '${type}')">重装</button>
                <button class="btn btn-danger btn-sm" onclick="uninstallPackage('${escapeHtml(p.name)}', '${type}')">卸载</button>
            </div>
        </div>
    `).join('');
}

function filterInstalled(type) {
    renderInstalled(type, installedPackages);
}

async function reinstallPackage(name, type) {
    showModal(
        '确认重装',
        `确定要重装 <strong>${escapeHtml(name)}</strong> 吗？这将重新下载并安装该包。`,
        async () => {
            try {
                await window.go.main.Service.Reinstall(name, type);
                showToast(`${name} 重装成功`, 'success');
                addRecentAction('reinstall', name);
                // Reload after a short delay
                setTimeout(() => {
                    markCacheDirty('installed');
                    tabCache.installed.data = null;
                    tabCache.installed.timestamp = 0;
                    installedPackages = [];
                    loadInstalled();
                }, 500);
            } catch (err) {
                showToast('重装失败: ' + err.message, 'error');
            }
        }
    );
}

async function uninstallPackage(name, type) {
    showModal(
        '确认卸载',
        `确定要卸载 <strong>${escapeHtml(name)}</strong> 吗？`,
        async () => {
            try {
                await window.go.main.Service.Uninstall(name, type);
                showToast(`${name} 已卸载`, 'success');
                markCacheDirty('installed');
                // Clear cache and reload
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
                loadInstalled();
                addRecentAction('uninstall', name);
            } catch (err) {
                showToast('卸载失败: ' + err.message, 'error');
            }
        }
    );
}

// ===== Search =====
let searchTimeout = null;

function debounceSearch() {
    clearTimeout(searchTimeout);
    const input = document.getElementById('search-input');
    searchTimeout = setTimeout(() => doSearch(input.value), 300);
}

async function doSearch(query) {
    const container = document.getElementById('search-results');
    if (!query || query.trim() === '') {
        container.innerHTML = '<p class="empty-state">输入关键词搜索 Homebrew 包</p>';
        return;
    }

    container.innerHTML = '<div class="loading-state"><span class="spinner"></span> 搜索中...</div>';

    try {
        const results = await window.go.main.Service.Search(query);
        if (!results || results.length === 0) {
            container.innerHTML = '<p class="empty-state">未找到匹配的结果</p>';
            return;
        }

        container.innerHTML = results.map(r => `
            <div class="result-item">
                <span class="result-name">${escapeHtml(r.name)}</span>
                <span class="type-badge ${r.type}">${r.type === 'cask' ? '应用' : '公式'}</span>
                ${r.installed ? '<span class="installed-tag">✓ 已安装</span>' : ''}
                <div class="result-actions">
                    ${!r.installed ? `<button class="btn btn-primary btn-sm" onclick="installPackage('${escapeHtml(r.name)}', '${r.type}')">安装</button>` : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<p class="empty-state">搜索失败: ${err.message}</p>`;
    }
}

async function installPackage(name, type) {
    showModal(
        '确认安装',
        `确定要安装 <strong>${escapeHtml(name)}</strong> 吗？`,
        async () => {
            try {
                await window.go.main.Service.Install(name, type);
                showToast(`${name} 安装成功`, 'success');
                markCacheDirty('installed');
                markCacheDirty('dashboard');
                // Clear cache and reload
                tabCache.installed.data = null;
                tabCache.installed.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                installedPackages = [];
                addRecentAction('install', name);
                doSearch(document.getElementById('search-input').value);
            } catch (err) {
                showToast('安装失败: ' + err.message, 'error');
            }
        }
    );
}

// ===== Outdated =====
async function loadOutdated() {
    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.outdated)) {
        renderOutdated(tabCache.outdated.data);
        // Still refresh in background
        loadOutdatedInBackground();
        return;
    }

    try {
        const outdated = await window.go.main.Service.GetOutdated();
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
        const outdated = await window.go.main.Service.GetOutdated();
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
            <td><span class="type-badge ${p.type}">${p.type === 'cask' ? '应用' : '公式'}</span></td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="upgradePackage('${escapeHtml(p.name)}')">更新</button>
            </td>
        </tr>
    `).join('');
}

async function upgradePackage(name) {
    try {
        await window.go.main.Service.Upgrade([name]);
        showToast(`${name} 更新成功`, 'success');
        markCacheDirty('outdated');
        markCacheDirty('dashboard');
        tabCache.outdated.data = null;
        tabCache.outdated.timestamp = 0;
        tabCache.dashboard.data = null;
        tabCache.dashboard.timestamp = 0;
        addRecentAction('upgrade', name);
        loadOutdated();
    } catch (err) {
        showToast('更新失败: ' + err.message, 'error');
    }
}

async function upgradeAll() {
    showModal(
        '全部更新',
        '确定要更新所有可更新的包吗？这可能需要较长时间。',
        async () => {
            const btn = document.getElementById('upgrade-all-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 更新中...';
            try {
                await window.go.main.Service.Upgrade([]);
                showToast('全部更新完成', 'success');
                markCacheDirty('outdated');
                markCacheDirty('dashboard');
                tabCache.outdated.data = null;
                tabCache.outdated.timestamp = 0;
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                addRecentAction('upgrade', 'all packages');
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

// ===== Settings =====
async function loadSettings() {
    // If cache is valid, render immediately from cache
    if (isCacheValid(tabCache.settings)) {
        renderSettings(tabCache.settings.data);
        // Still refresh in background
        loadSettingsInBackground();
        return;
    }

    try {
        const data = await fetchSettingsData();
        tabCache.settings.data = data;
        tabCache.settings.timestamp = Date.now();
        renderSettings(data);
    } catch (err) {
        showToast('加载设置失败: ' + err.message, 'error');
    }
}

async function fetchSettingsData() {
    // Parallel: all three Go calls run simultaneously
    const [version, diskUsage, stats] = await Promise.all([
        window.go.main.App.Version(),
        window.go.main.Service.GetDiskUsage(),
        window.go.main.Service.GetStats(),
    ]);
    return { version, diskUsage, stats };
}

async function loadSettingsInBackground() {
    try {
        const data = await fetchSettingsData();
        tabCache.settings.data = data;
        tabCache.settings.timestamp = Date.now();

        // Only re-render if still on settings tab
        if (currentTab === 'settings') {
            renderSettings(data);
        }
    } catch (err) {
        // Silently fail for background refresh
    }
}

function renderSettings(data) {
    const { version, diskUsage, stats } = data;

    // Brew info
    document.getElementById('brew-info-list').innerHTML = `
        <div class="info-item"><span class="label">版本</span><span class="value">${escapeHtml(version)}</span></div>
        ${stats && stats.stats ? stats.stats.split('\n').filter(l => l.trim()).map(l => {
            const parts = l.split(':');
            if (parts.length === 2) return `<div class="info-item"><span class="label">${escapeHtml(parts[0].trim())}</span><span class="value">${escapeHtml(parts[1].trim())}</span></div>`;
            return '';
        }).join('') : ''}
    `;

    // Disk usage detailed
    document.getElementById('disk-usage-detailed').innerHTML = Object.entries(diskUsage).map(([label, value]) => `
        <div class="disk-usage-item">
            <span class="label">${escapeHtml(label)}</span>
            <span class="value">${escapeHtml(value)}</span>
        </div>
    `).join('');
}

async function exportConfig() {
    try {
        const content = await window.go.main.Service.ExportConfig();
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

async function cleanupBrew() {
    showModal(
        '清理缓存',
        '确定要清理 Homebrew 缓存和旧版本吗？',
        async () => {
            try {
                await window.go.main.Service.Cleanup();
                showToast('清理完成', 'success');
                markCacheDirty('dashboard');
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                refreshDashboard();
            } catch (err) {
                showToast('清理失败: ' + err.message, 'error');
            }
        }
    );
}

// ===== Dependency Management =====
async function loadDependencies() {
    const input = document.getElementById('dep-search-input');
    const name = input.value.trim();
    if (!name) {
        document.getElementById('dependency-results').innerHTML = '<p class="empty-state">请输入包名</p>';
        return;
    }

    const container = document.getElementById('dependency-results');
    container.innerHTML = '<div class="loading-state"><span class="spinner"></span> 查询中...</div>';

    try {
        const deps = await window.go.main.Service.GetDependencies(name);
        if (!deps || deps.length === 0) {
            container.innerHTML = '<p class="empty-state">未找到依赖信息（该包可能没有依赖或不存在）</p>';
            return;
        }

        const installedSet = new Set(installedPackages.map(p => p.name));

        container.innerHTML = deps.map(dep => {
            const isInstalled = installedSet.has(dep);
            return `
                <div class="dependency-item">
                    <span class="dep-name">${escapeHtml(dep)}</span>
                    <span class="dep-status ${isInstalled ? 'installed' : ''}">${isInstalled ? '✓ 已安装' : '未安装'}</span>
                </div>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p class="empty-state">查询失败: ${err.message}</p>`;
    }
}

// Allow Enter key to trigger dependency search
document.addEventListener('DOMContentLoaded', () => {
    const depInput = document.getElementById('dep-search-input');
    if (depInput) {
        depInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadDependencies();
        });
    }
});

async function autoremoveDeps() {
    showModal(
        '清理孤立依赖',
        '确定要清理不再被任何包依赖的孤立依赖吗？这将释放磁盘空间。',
        async () => {
            const resultDiv = document.getElementById('autoremove-result');
            resultDiv.className = 'autoremove-result';
            resultDiv.style.display = 'block';
            resultDiv.textContent = '正在清理...';

            try {
                await window.go.main.Service.Autoremove();
                resultDiv.className = 'autoremove-result success';
                resultDiv.textContent = '✓ 孤立依赖清理完成！';
                showToast('清理完成', 'success');
                markCacheDirty('dashboard');
                tabCache.dashboard.data = null;
                tabCache.dashboard.timestamp = 0;
                refreshDashboard();
            } catch (err) {
                resultDiv.className = 'autoremove-result error';
                resultDiv.textContent = '✗ 清理失败: ' + err.message;
                showToast('清理失败: ' + err.message, 'error');
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
        const taps = await window.go.main.Service.GetTaps();
        tabCache.taps.data = taps;
        tabCache.taps.timestamp = Date.now();
        renderTaps(taps);
    } catch (err) {
        document.getElementById('taps-list').innerHTML = `<p class="empty-state">加载失败: ${err.message}</p>`;
    }
}

async function loadTapsInBackground() {
    try {
        const taps = await window.go.main.Service.GetTaps();
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

async function addTap() {
    const input = document.getElementById('tap-input');
    const tap = input.value.trim();
    if (!tap) {
        showToast('请输入 tap 名称', 'error');
        return;
    }

    try {
        await window.go.main.Service.AddTap(tap);
        showToast(`Tap ${tap} 添加成功`, 'success');
        input.value = '';
        markCacheDirty('taps');
        tabCache.taps.data = null;
        tabCache.taps.timestamp = 0;
        loadTaps();
    } catch (err) {
        showToast('添加 Tap 失败: ' + err.message, 'error');
    }
}

async function removeTap(tap) {
    showModal(
        '确认移除 Tap',
        `确定要移除 tap <strong>${escapeHtml(tap)}</strong> 吗？`,
        async () => {
            try {
                await window.go.main.Service.RemoveTap(tap);
                showToast(`Tap ${tap} 已移除`, 'success');
                markCacheDirty('taps');
                tabCache.taps.data = null;
                tabCache.taps.timestamp = 0;
                loadTaps();
            } catch (err) {
                showToast('移除失败: ' + err.message, 'error');
            }
        }
    );
}

// ===== Recent Actions =====
function getRecentActions() {
    try {
        return JSON.parse(localStorage.getItem('brew-actions') || '[]');
    } catch { return []; }
}

function addRecentAction(type, name) {
    const actions = getRecentActions();
    actions.unshift({
        type,
        name,
        time: new Date().toISOString()
    });
    if (actions.length > 20) actions.pop();
    localStorage.setItem('brew-actions', JSON.stringify(actions));
    loadRecentActions();
}

function loadRecentActions() {
    const actions = getRecentActions();
    const container = document.getElementById('recent-actions');

    if (actions.length === 0) {
        container.innerHTML = '<p class="empty-state">暂无操作记录</p>';
        return;
    }

    const icons = { install: '📦', uninstall: '🗑️', upgrade: '⬆️', reinstall: '🔄' };
    const labels = { install: '安装', uninstall: '卸载', upgrade: '更新', reinstall: '重装' };

    container.innerHTML = actions.slice(0, 10).map(a => {
        const time = new Date(a.time);
        const timeStr = time.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `
            <div class="action-item">
                <span class="action-icon ${a.type}">${icons[a.type] || '•'}</span>
                <span>${labels[a.type]} <strong>${escapeHtml(a.name)}</strong></span>
                <span class="action-time">${timeStr}</span>
            </div>`;
    }).join('');
}

// ===== Utility =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + S = Search
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        switchTab('search');
        setTimeout(() => document.getElementById('search-input').focus(), 100);
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

// ===== Init =====
(async () => {
    try {
        const version = await window.go.main.App.Version();
        document.getElementById('brew-version').textContent = version;
    } catch (err) {
        document.getElementById('brew-version').textContent = 'Brew 未安装';
    }
    // Load dashboard immediately (first load, no cache)
    refreshDashboard();
})();
