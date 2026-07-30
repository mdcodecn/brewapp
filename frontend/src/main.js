import * as ServiceAPI from '../wailsjs/go/main/Service';
import * as AppAPI from '../wailsjs/go/main/App';

// ===== Tab Navigation =====
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');

        // Load data for the tab
        if (tab === 'dashboard') refreshDashboard();
        else if (tab === 'installed') loadInstalled();
        else if (tab === 'outdated') loadOutdated();
        else if (tab === 'settings') loadSettings();
    });
});

// ===== Toast =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
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

// ===== Dashboard =====
async function refreshDashboard() {
    try {
        console.log('[Dashboard] Starting...');
        const packages = await ServiceAPI.ListInstalled();
        console.log('[Dashboard] packages:', packages);
        const outdated = await ServiceAPI.GetOutdated();
        console.log('[Dashboard] outdated:', outdated);
        const diskUsage = await ServiceAPI.GetDiskUsage();
        console.log('[Dashboard] diskUsage:', diskUsage);

        const casks = packages.filter(p => p.type === 'cask');
        const formulas = packages.filter(p => p.type === 'formula');

        document.getElementById('stat-total').textContent = packages.length;
        document.getElementById('stat-casks').textContent = casks.length;
        document.getElementById('stat-outdated').textContent = outdated.length;

        // Outdated badge
        const badge = document.getElementById('outdated-badge');
        if (outdated.length > 0) {
            badge.style.display = 'inline';
            badge.textContent = outdated.length;
        } else {
            badge.style.display = 'none';
        }

        // Disk usage
        const diskGrid = document.getElementById('disk-usage-grid');
        diskGrid.innerHTML = '';
        for (const [label, value] of Object.entries(diskUsage)) {
            diskGrid.innerHTML += `
                <div class="disk-usage-item">
                    <span class="label">${label}</span>
                    <span class="value">${value}</span>
                </div>`;
        }

        // Recent actions (from localStorage)
        loadRecentActions();

    } catch (err) {
        showToast('加载失败: ' + err.message, 'error');
    }
}

// ===== Installed =====
let allInstalledPackages = [];

async function loadInstalled() {
    if (allInstalledPackages.length > 0) {
        renderInstalled(allInstalledPackages);
        return;
    }
    try {
        console.log('[Installed] Loading...');
        const packages = await ServiceAPI.ListInstalled();
        console.log('[Installed] loaded:', packages.length, 'packages');

        // Batch fetch descriptions for all packages (up to 20 at a time to avoid too many concurrent calls)
        const BATCH_SIZE = 20;
        for (let i = 0; i < packages.length; i += BATCH_SIZE) {
            const batch = packages.slice(i, i + BATCH_SIZE);
            const promises = batch.map(async (pkg) => {
                if (!pkg.description) {
                    try {
                        const info = await ServiceAPI.GetPackageInfo(pkg.name, pkg.type);
                        Object.assign(pkg, info);
                    } catch {
                        // Keep empty description if fetch fails
                    }
                }
            });
            await Promise.all(promises);
        }

        allInstalledPackages = packages;
        renderInstalled(allInstalledPackages);
    } catch (err) {
        document.getElementById('installed-tbody').innerHTML =
            `<tr><td colspan="5" class="empty-state">加载失败: ${err.message}</td></tr>`;
    }
}

function renderInstalled(packages) {
    const tbody = document.getElementById('installed-tbody');
    if (packages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无数据</td></tr>';
        return;
    }
    tbody.innerHTML = packages.map(p => `
        <tr>
            <td class="name-cell">${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.version || '-')}</td>
            <td><span class="type-badge ${p.type}">${p.type === 'cask' ? '应用' : '公式'}</span></td>
            <td style="color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.description || '-')}</td>
            <td>
                <button class="btn btn-danger btn-sm" onclick="uninstallPackage('${escapeHtml(p.name)}', '${p.type}')">卸载</button>
            </td>
        </tr>
    `).join('');
}

function filterInstalled() {
    const search = document.getElementById('installed-search').value.toLowerCase();
    const filter = document.getElementById('installed-filter').value;

    const filtered = allInstalledPackages.filter(p => {
        const matchSearch = !search || p.name.toLowerCase().includes(search) || (p.description && p.description.toLowerCase().includes(search));
        const matchFilter = filter === 'all' || p.type === filter;
        return matchSearch && matchFilter;
    });
    renderInstalled(filtered);
}

async function uninstallPackage(name, type) {
    showModal(
        '确认卸载',
        `确定要卸载 <strong>${escapeHtml(name)}</strong> 吗？`,
        async () => {
            try {
                console.log('[Uninstall] Uninstalling', name, type);
                await ServiceAPI.Uninstall(name, type);
                showToast(`${name} 已卸载`, 'success');
                allInstalledPackages = allInstalledPackages.filter(p => p.name !== name);
                filterInstalled();
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

    container.innerHTML = '<p class="empty-state"><span class="spinner"></span> 搜索中...</p>';

    try {
        const results = await ServiceAPI.Search(query);
        if (!results || results.length === 0) {
            container.innerHTML = '<p class="empty-state">未找到匹配的结果</p>';
            return;
        }

        container.innerHTML = results.map(r => `
            <div class="result-item">
                <span class="result-name">${escapeHtml(r.name)}</span>
                <span class="result-version">${escapeHtml(r.version || '-')}</span>
                <span class="type-badge ${r.type}">${r.type === 'cask' ? '应用' : '公式'}</span>
                <span class="result-desc">${escapeHtml(r.description || '')}</span>
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
                console.log('[Install] Installing', name, type);
                await ServiceAPI.Install(name, type);
                showToast(`${name} 安装成功`, 'success');
                addRecentAction('install', name);
                doSearch(document.getElementById('search-input').value); // refresh search
            } catch (err) {
                showToast('安装失败: ' + err.message, 'error');
            }
        }
    );
}

// ===== Outdated =====
async function loadOutdated() {
    try {
        console.log('[Outdated] Loading...');
        const outdated = await ServiceAPI.GetOutdated();
        console.log('[Outdated] result:', outdated);
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
    } catch (err) {
        document.getElementById('outdated-tbody').innerHTML =
            `<tr><td colspan="4" class="empty-state">加载失败: ${err.message}</td></tr>`;
    }
}

async function upgradePackage(name) {
    try {
        console.log('[Upgrade] Upgrading', name);
        await ServiceAPI.Upgrade([name]);
        showToast(`${name} 更新成功`, 'success');
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
                console.log('[UpgradeAll] Upgrading all...');
                await ServiceAPI.Upgrade([]);
                showToast('全部更新完成', 'success');
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
    try {
        console.log('[Settings] Loading...');
        const version = await AppAPI.Version();
        console.log('[Settings] version:', version);
        const taps = await ServiceAPI.GetTaps();
        const diskUsage = await ServiceAPI.GetDiskUsage();
        const stats = await ServiceAPI.GetStats();

        // Brew info
        document.getElementById('brew-info-list').innerHTML = `
            <div class="info-item"><span class="label">版本</span><span class="value">${escapeHtml(version)}</span></div>
            ${stats && stats.stats ? stats.stats.split('\n').filter(l => l.trim()).map(l => {
                const parts = l.split(':');
                if (parts.length === 2) return `<div class="info-item"><span class="label">${escapeHtml(parts[0].trim())}</span><span class="value">${escapeHtml(parts[1].trim())}</span></div>`;
                return '';
            }).join('') : ''}
        `;

        // Taps
        document.getElementById('taps-list').innerHTML = taps.length > 0
            ? taps.map(t => `<div class="tap-item">${escapeHtml(t)}</div>`).join('')
            : '<p class="empty-state">暂无 taps</p>';

        // Disk usage detailed
        document.getElementById('disk-usage-detailed').innerHTML = Object.entries(diskUsage).map(([label, value]) => `
            <div class="disk-usage-item">
                <span class="label">${escapeHtml(label)}</span>
                <span class="value">${escapeHtml(value)}</span>
            </div>
        `).join('');

    } catch (err) {
        showToast('加载设置失败: ' + err.message, 'error');
    }
}

async function exportConfig() {
    try {
        console.log('[Export] Exporting config...');
        const content = await ServiceAPI.ExportConfig();
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
                console.log('[Cleanup] Cleaning...');
                await ServiceAPI.Cleanup();
                showToast('清理完成', 'success');
                refreshDashboard();
            } catch (err) {
                showToast('清理失败: ' + err.message, 'error');
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
    // Keep only last 20
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

    const icons = { install: '📦', uninstall: '🗑️', upgrade: '⬆️' };
    const labels = { install: '安装', uninstall: '卸载', upgrade: '更新' };

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

// ===== Init =====
(async () => {
    try {
        const version = await AppAPI.Version();
        document.getElementById('brew-version').textContent = version;
    } catch (err) {
        document.getElementById('brew-version').textContent = 'Brew 未安装';
    }
    refreshDashboard();
})();
