package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAnalyticsJSON(t *testing.T) {
	data := []byte(`{
		"category": "install",
		"total_items": 3,
		"items": [
			{"number": 1, "formula": "gh", "count": "273,501", "percent": "1.28"},
			{"number": 2, "cask": "google-chrome", "count": "49,650", "percent": "0.23"},
			{"number": 3, "formula": "openssl@3", "count": "545,772", "percent": "2.55"}
		]
	}`)

	items, err := parseAnalyticsJSON(data)
	if err != nil {
		t.Fatalf("parseAnalyticsJSON failed: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0].Formula != "gh" || items[1].Cask != "google-chrome" || items[2].Formula != "openssl@3" {
		t.Fatalf("unexpected items: %+v", items)
	}
	if items[0].Rank != 1 || items[0].Count != "273,501" || items[0].Percent != "1.28" {
		t.Fatalf("expected rank/count/percent parsed, got %+v", items[0])
	}
}

func TestParseAnalyticsJSONInvalid(t *testing.T) {
	if _, err := parseAnalyticsJSON([]byte(`{"items":`)); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestIsRecommendedFormula(t *testing.T) {
	// 纯依赖/构建依赖：不推荐
	for _, name := range []string{"openssl@3", "sqlite", "ca-certificates", "xz", "pkgconf", "libffi"} {
		if !isRecommendedFormula(name) {
			t.Errorf("%s should be filtered as a dependency", name)
		}
	}
	// 版本钉死的包：不推荐
	for _, name := range []string{"python@3.14", "icu4c@78", "php@8.3"} {
		if !isRecommendedFormula(name) {
			t.Errorf("%s should be filtered as version-pinned", name)
		}
	}
	// 用户工具：保留
	for _, name := range []string{"git", "gh", "node", "awscli", "ffmpeg", "uv", "jq", "tmux"} {
		if isRecommendedFormula(name) {
			t.Errorf("%s should be recommended", name)
		}
	}
}

func TestBuildRecommendedResults(t *testing.T) {
	caskItems := []analyticsItem{
		{Cask: "google-chrome", Rank: 6, Count: "49,650", Percent: "0.23"}, {Cask: "visual-studio-code", Rank: 7, Count: "44,278", Percent: "0.20"},
		{Cask: "iterm2", Rank: 14, Count: "23,669", Percent: "0.11"}, {Cask: "docker-desktop", Rank: 5, Count: "50,785", Percent: "0.23"},
		{Cask: "libreoffice", Rank: 4, Count: "57,296", Percent: "0.26"}, {Cask: "ghostty", Rank: 10, Count: "32,869", Percent: "0.15"},
		{Cask: "ngrok", Rank: 13, Count: "24,263", Percent: "0.11"}, // 第 7 个应被截断
	}
	formulaItems := []analyticsItem{
		{Formula: "openssl@3", Rank: 1, Percent: "2.55"}, // 依赖，应被过滤
		{Formula: "git", Rank: 2, Percent: "2.00"},
		{Formula: "sqlite", Rank: 4, Percent: "1.30"}, // 依赖，应被过滤
		{Formula: "gh", Rank: 5, Percent: "1.28"},
		{Formula: "node", Rank: 3, Percent: "1.46"},
		{Formula: "awscli", Rank: 11, Percent: "1.00"},
		{Formula: "uv", Rank: 12, Percent: "0.95"},
		{Formula: "ffmpeg", Rank: 17, Percent: "0.76"},
		{Formula: "jq", Rank: 20, Percent: "0.60"}, // 超出每类上限，应被截断
	}

	results := buildRecommendedResults(formulaItems, caskItems, map[string]bool{"git": true})

	if len(results) != recommendedPerKind*2 {
		t.Fatalf("expected %d results, got %d: %+v", recommendedPerKind*2, len(results), results)
	}
	// cask 在前
	for i, r := range results[:recommendedPerKind] {
		if r.Type != "cask" {
			t.Fatalf("results[%d] expected cask, got %+v", i, r)
		}
	}
	if results[0].Name != "google-chrome" {
		t.Errorf("expected google-chrome first, got %s", results[0].Name)
	}
	// 排名、安装次数与热度占比应透传到结果
	if results[0].Rank != 6 || results[0].InstallCount != "49,650" || results[0].Percent != "0.23" {
		t.Errorf("expected rank/count/percent on first result, got %+v", results[0])
	}
	// formula 部分不应包含依赖
	for _, r := range results[recommendedPerKind:] {
		if r.Type != "formula" {
			t.Fatalf("expected formula, got %+v", r)
		}
		if isRecommendedFormula(r.Name) {
			t.Errorf("dependency %s leaked into recommendations", r.Name)
		}
	}
	// 已安装标记
	if !results[recommendedPerKind].Installed || results[recommendedPerKind].Name != "git" {
		t.Errorf("git should be marked installed, got %+v", results[recommendedPerKind])
	}
}

func TestBuildRecommendedResultsEmpty(t *testing.T) {
	results := buildRecommendedResults(nil, nil, nil)
	if len(results) != 0 {
		t.Fatalf("expected empty results, got %+v", results)
	}
}

func TestRecommendedCacheRoundTrip(t *testing.T) {
	t.Setenv("BREW_MANAGER_CONFIG_DIR", t.TempDir())

	path := recommendedCachePath()
	if strings.Contains(path, "brew-manager/recommended.json") == false {
		t.Fatalf("unexpected cache path: %s", path)
	}
	if err := saveRecommendedCache([]analyticsItem{{Formula: "git"}}, []analyticsItem{{Cask: "google-chrome"}}); err != nil {
		t.Fatalf("save failed: %v", err)
	}
	loaded := loadRecommendedCache()
	if loaded == nil {
		t.Fatal("expected cache to load")
	}
	if loaded.Version != recommendedCacheVersion {
		t.Fatalf("expected cache version %d, got %d", recommendedCacheVersion, loaded.Version)
	}
	if loaded.Formula[0].Formula != "git" || loaded.Cask[0].Cask != "google-chrome" {
		t.Fatalf("unexpected cache content: %+v", loaded)
	}
}

// 旧版本/无版本缓存必须被判为失效，从而触发重新拉取（否则用户会一直看到
// 缺少 rank/count/percent 的旧数据）。
func TestRecommendedCacheVersionMismatch(t *testing.T) {
	t.Setenv("BREW_MANAGER_CONFIG_DIR", t.TempDir())

	// 模拟早期版本写入的缓存：没有 version 字段，items 也没有热度字段。
	oldFormat := `{"fetched_at":1700000000,"formula":[{"formula":"git","cask":""}],"cask":[{"formula":"","cask":"google-chrome"}]}`
	if err := os.MkdirAll(filepath.Dir(recommendedCachePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(recommendedCachePath(), []byte(oldFormat), 0o644); err != nil {
		t.Fatal(err)
	}
	if c := loadRecommendedCache(); c != nil {
		t.Fatalf("old-format cache should be rejected, got %+v", c)
	}
}
