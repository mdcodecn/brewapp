package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const scutilSample = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7891
  SOCKSProxy : 127.0.0.1
}
`

// TestParseScutilProxy verifies host:port extraction from scutil --proxy output.
func TestParseScutilProxy(t *testing.T) {
	http, https, socks := parseScutilProxy(scutilSample)
	if http != "127.0.0.1:7890" {
		t.Errorf("http = %q", http)
	}
	if https != "127.0.0.1:7890" {
		t.Errorf("https = %q", https)
	}
	if socks != "127.0.0.1:7891" {
		t.Errorf("socks = %q", socks)
	}
}

// TestParseScutilProxyDisabled verifies disabled entries yield empty strings.
func TestParseScutilProxyDisabled(t *testing.T) {
	out := "<dictionary> { HTTPEnable : 0 HTTPProxy : 127.0.0.1 }"
	http, https, socks := parseScutilProxy(out)
	if http != "" || https != "" || socks != "" {
		t.Errorf("expected empty, got http=%q https=%q socks=%q", http, https, socks)
	}
}

// TestApplyProxyEnv verifies enabled/disabled env application and that
// localhost always bypasses the proxy.
func TestApplyProxyEnv(t *testing.T) {
	for _, k := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"} {
		t.Setenv(k, "")
	}

	// Disabled: proxy vars cleared, NO_PROXY still set for localhost.
	applyProxyEnv(SystemProxyStatus{Enabled: false})
	if v := os.Getenv("HTTP_PROXY"); v != "" {
		t.Errorf("HTTP_PROXY = %q, want empty when disabled", v)
	}
	if !strings.Contains(os.Getenv("NO_PROXY"), "localhost") {
		t.Error("NO_PROXY should always include localhost")
	}

	// Enabled with HTTP+HTTPS+SOCKS.
	applyProxyEnv(SystemProxyStatus{
		Enabled: true,
		HTTP:    "127.0.0.1:7890",
		HTTPS:   "127.0.0.1:7890",
		SOCKS:   "127.0.0.1:7891",
	})
	if v := os.Getenv("HTTP_PROXY"); v != "http://127.0.0.1:7890" {
		t.Errorf("HTTP_PROXY = %q", v)
	}
	if v := os.Getenv("HTTPS_PROXY"); v != "http://127.0.0.1:7890" {
		t.Errorf("HTTPS_PROXY = %q", v)
	}
	if v := os.Getenv("ALL_PROXY"); v != "socks5://127.0.0.1:7891" {
		t.Errorf("ALL_PROXY = %q", v)
	}

	// Enabled with HTTP only: ALL_PROXY falls back to HTTP.
	applyProxyEnv(SystemProxyStatus{Enabled: true, HTTP: "proxy.local:8080"})
	if v := os.Getenv("ALL_PROXY"); v != "http://proxy.local:8080" {
		t.Errorf("ALL_PROXY = %q, want http fallback", v)
	}
}

// TestProxyConfigDefaultEnabled verifies 系统代理默认开启: without any
// persisted config the toggle reads as enabled, and a corrupt file also
// falls back to enabled.
func TestProxyConfigDefaultEnabled(t *testing.T) {
	t.Setenv("BREW_MANAGER_CONFIG_DIR", t.TempDir())
	if !loadAppConfig().SystemProxyEnabled {
		t.Error("proxy should default to enabled when no config file exists")
	}

	// Corrupt file → still defaults to enabled
	cfgDir := filepath.Join(os.Getenv("BREW_MANAGER_CONFIG_DIR"), "brew-manager")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, "config.json"), []byte("{oops"), 0o644); err != nil {
		t.Fatalf("write corrupt config: %v", err)
	}
	if !loadAppConfig().SystemProxyEnabled {
		t.Error("proxy should default to enabled on corrupt config")
	}

	// Explicit false in the file still wins
	if err := os.WriteFile(filepath.Join(cfgDir, "config.json"), []byte(`{"system_proxy_enabled": false}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if loadAppConfig().SystemProxyEnabled {
		t.Error("explicit false should override the default")
	}
}

// TestProxyConfigRoundTrip verifies the toggle persists across save/load.
func TestProxyConfigRoundTrip(t *testing.T) {
	t.Setenv("BREW_MANAGER_CONFIG_DIR", t.TempDir())
	if err := saveAppConfig(appConfig{SystemProxyEnabled: true}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if !loadAppConfig().SystemProxyEnabled {
		t.Error("enabled flag did not round-trip")
	}
	if err := saveAppConfig(appConfig{SystemProxyEnabled: false}); err != nil {
		t.Fatalf("save false: %v", err)
	}
	if loadAppConfig().SystemProxyEnabled {
		t.Error("disabled flag did not round-trip")
	}
}
