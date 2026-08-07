package main

import (
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
		{Cask: "google-chrome"}, {Cask: "visual-studio-code"}, {Cask: "iterm2"},
		{Cask: "docker-desktop"}, {Cask: "libreoffice"}, {Cask: "ghostty"},
		{Cask: "ngrok"}, // 第 7 个应被截断
	}
	formulaItems := []analyticsItem{
		{Formula: "openssl@3"}, // 依赖，应被过滤
		{Formula: "git"},
		{Formula: "sqlite"}, // 依赖，应被过滤
		{Formula: "gh"},
		{Formula: "node"},
		{Formula: "awscli"},
		{Formula: "uv"},
		{Formula: "ffmpeg"},
		{Formula: "jq"}, // 超出每类上限，应被截断
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
	if loaded.Formula[0].Formula != "git" || loaded.Cask[0].Cask != "google-chrome" {
		t.Fatalf("unexpected cache content: %+v", loaded)
	}
}
