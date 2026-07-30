# Brew Manager - 软件设计文档

## 1. 项目概述

一个 macOS 桌面应用，用 Go + Wails 开发，提供 Homebrew 包管理的图形界面。

**技术栈：**
- 后端：Go 1.26 + Wails v2
- 前端：原生 HTML/CSS/JS（无框架，保持轻量）
- 样式：自定义 CSS，暗色主题

## 2. 功能模块

### 2.1 概览（Dashboard）
- 已安装包总数、Cask 数、Formula 数统计卡片
- 可更新包数量及入口
- Brew 版本信息
- 磁盘使用概览（Cellar、Caskroom、Cache）
- 最近操作记录

### 2.2 已安装列表（Installed）
- 表格展示所有已安装包：名称、版本、类型、描述
- 支持按类型筛选（全部/Cask/Formula）
- 支持搜索过滤
- 每行操作：卸载、查看详情

### 2.3 搜索（Search）
- 输入关键词搜索 Homebrew 仓库中的包
- 显示搜索结果：名称、版本、类型、描述、是否已安装
- 未安装的包可直接安装

### 2.4 可更新（Outdated）
- 列出所有可更新的包
- 支持单个更新和全部更新

### 2.5 设置（Settings）
- Brew 版本信息
- Taps 列表
- 磁盘使用详情
- 导出/导入配置
- 清理缓存

## 3. Go 后端设计

### 3.1 包结构
```
├── main.go          # Wails 入口，启动应用
├── app.go           # App 结构体，基础方法
├── brew.go          # BrewService，封装所有 brew 操作
├── go.mod
└── frontend/        # 前端资源
    ├── index.html
    └── src/
        ├── main.js   # 前端逻辑
        └── style.css # 样式
```

### 3.2 BrewService 暴露的方法

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `GetVersion()` | string | 获取 Brew 版本 |
| `ListInstalled()` | `[]Package` | 获取已安装包列表 |
| `Search(query)` | `[]SearchResult` | 搜索包 |
| `Install(name, type)` | error | 安装包 |
| `Uninstall(name, type)` | error | 卸载包 |
| `GetOutdated()` | `[]Package` | 获取可更新包 |
| `Upgrade(name)` | error | 更新指定包或全部 |
| `Cleanup()` | error | 清理缓存 |
| `GetStats()` | map | 获取统计信息 |
| `GetTaps()` | []string | 获取 taps |
| `GetDiskUsage()` | map | 磁盘使用 |
| `ExportConfig(path)` | error | 导出配置 |

### 3.3 数据结构

```go
type Package struct {
    Name        string `json:"name"`
    Version     string `json:"version"`
    Description string `json:"description"`
    Type        string `json:"type"` // "cask" | "formula"
    Outdated    bool   `json:"outdated"`
}

type SearchResult struct {
    Name        string `json:"name"`
    Version     string `json:"version"`
    Description string `json:"description"`
    Type        string `json:"type"`
    Installed   bool   `json:"installed"`
}
```

## 4. 前端设计

### 4.1 UI 布局
```
┌─────────────────────────────────────────┐
│  Sidebar (240px)    │  Main Content    │
│  ┌───────────────┐  │  ┌────────────┐  │
│  │ Logo + Title  │  │  │ Page Header│  │
│  ├───────────────┤  │  ├────────────┤  │
│  │ 导航菜单       │  │  │            │  │
│  │ · 概览         │  │  │  内容区域   │  │
│  │ · 已安装       │  │  │            │  │
│  │ · 搜索         │  │  │            │  │
│  │ · 可更新       │  │  │            │  │
│  │ · 设置         │  │  │            │  │
│  ├───────────────┤  │  │            │  │
│  │ Brew Version  │  │  └────────────┘  │
│  └───────────────┘  │                  │
└─────────────────────────────────────────┘
```

### 4.2 交互设计
- 左侧导航切换 Tab，无刷新
- 操作按钮触发后端方法，异步执行
- 操作结果通过 Toast 通知用户
- 危险操作（卸载、清理）弹出确认框
- 搜索有防抖处理

### 4.3 视觉设计
- 暗色主题：背景 #18181b (zinc-950)
- 主色：#6366f1 (indigo-500)
- 卡片式布局，圆角 8px
- 表格行 hover 高亮
- 响应式：最小宽度 900px

## 5. 开发顺序

1. 后端：BrewService 核心方法
2. 前端：CSS 样式 + 布局框架
3. 前端：各 Tab 页面实现
4. 前后端联调
5. 构建测试
