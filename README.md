# Brew Manager

一款基于 [Wails v2](https://wails.io) 的 macOS 桌面应用，用于可视化管理 [Homebrew](https://brew.sh) 包。使用 Go + 原生 HTML/CSS/JS（Vite 构建）开发，无需 Node 框架，前端零依赖。

## 功能特性

- **概览**：Homebrew 系统状态一览，包括版本、磁盘占用、推荐安装、漏洞告警等
- **搜索**：搜索 Formula 与 Cask，支持查看包详情、依赖关系（depends_on / uses）后安装
- **已安装**：管理已安装的 Formula 与 Cask，支持升级、重装、卸载、pin/unpin
- **服务**：管理 `brew services` 后台服务（启动 / 停止 / 重启 / 强杀）
- **仓库**：管理 Tap，支持添加、信任（trust）、移除、检查未使用的 Tap
- **更新**：查看过时包并批量升级，支持 `brew update` / `brew cleanup` / `brew autoremove`
- **配置**：
  - 切换国内镜像源（官方 GitHub、清华 TUNA、阿里云、中科大 USTC、北外 BFSU，支持自定义），写入并清理 shell profile 中的 `HOMEBREW_*` 环境变量
  - 跟随 macOS 系统代理（通过 `scutil --proxy` 检测），可开关是否让 brew 走系统代理
  - 导入 / 导出 Brewfile 配置
- **交互式终端**：长时操作（安装、升级等）通过 PTY 运行，可实时查看输出并交互输入
- 原生无边框窗口、自定义红绿灯按钮，Apple 风格 UI

## 环境要求

- macOS（Apple Silicon 优先）
- Go 1.26+
- [Wails v2 CLI](https://wails.io/docs/gettingstarted/installing)：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Node.js + npm（仅用于安装 Vite 与 ESLint）

## 开发

```bash
# 安装前端依赖（Wails 也会自动执行）
cd frontend && npm install && cd ..

# 以开发模式启动（热重载）
wails dev
```

也可以使用 Makefile：

```bash
make dev
```

## 构建

```bash
# 打包生产版本（darwin/arm64），产物位于 build/bin/brew-manager.app
wails build -platform darwin/arm64
# 或
make build
```

## 运行测试

```bash
go test ./...
```

测试覆盖包解析、镜像源配置、系统代理、PTY 流式输出等模块，配置目录可通过 `BREW_MANAGER_CONFIG_DIR` 环境变量隔离。

## 项目结构

```
.
├── main.go              # Wails 应用入口，绑定 Service
├── brew.go              # 核心能力：包安装/搜索/升级/服务/Tap/磁盘占用等（brew 命令封装）
├── mirror.go            # 镜像源预设、切换与测速（写入 shell profile）
├── proxy.go             # macOS 系统代理检测与 brew 代理开关
├── macwindow.go         # Cocoa 桥接：隐藏红绿灯、窗口透明度等
├── *_test.go            # Go 单元测试
├── wails.json           # Wails 配置
├── Makefile             # dev / build / clean 快捷命令
├── DESIGN.md            # UI 设计规范（Apple 风格设计系统）
└── frontend/
    ├── index.html       # 页面结构（侧边栏 + 各功能 Tab）
    ├── src/main.js      # 前端交互逻辑（原生 JS，调用 Wails 绑定）
    └── src/style.css    # 样式
```

## 技术要点

- 后端通过 Wails 将 `Service` 绑定到前端，所有 brew 能力（含镜像源、系统代理）均在该结构体上
- 长时命令通过 [creack/pty](https://github.com/creack/pty) 伪终端执行，输出实时流式推送到前端
- 应用配置持久化于 `~/Library/Application Support/brew-manager/config.json`

## 作者

许强（66301802@qq.com）
