package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// SystemProxyStatus reports the macOS system proxy (detected via
// `scutil --proxy`) together with whether the app currently routes brew
// traffic through it.
type SystemProxyStatus struct {
	Enabled bool   `json:"enabled"`
	HTTP    string `json:"http,omitempty"`  // host:port
	HTTPS   string `json:"https,omitempty"` // host:port
	SOCKS   string `json:"socks,omitempty"` // host:port
}

// appConfig is the small JSON file persisted under the user config dir.
type appConfig struct {
	SystemProxyEnabled bool `json:"system_proxy_enabled"`
}

// proxyConfigPath returns the app config file location
// (~/Library/Application Support/brew-manager/config.json on macOS).
// BREW_MANAGER_CONFIG_DIR can override the base directory (used by tests,
// since os.UserConfigDir ignores XDG_CONFIG_HOME on darwin).
func proxyConfigPath() string {
	if dir := os.Getenv("BREW_MANAGER_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "brew-manager", "config.json")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.Getenv("HOME")
	}
	return filepath.Join(dir, "brew-manager", "config.json")
}

// loadAppConfig reads the persisted app config. The config file is only
// written once the user toggles the proxy, so a missing / unreadable /
// corrupt file means the user never made a choice — 系统代理默认开启.
// An explicit "system_proxy_enabled": false in the file still wins.
func loadAppConfig() appConfig {
	cfg := appConfig{SystemProxyEnabled: true} // 默认开启
	data, err := os.ReadFile(proxyConfigPath())
	if err != nil {
		return cfg
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg
	}
	return cfg
}

// saveAppConfig persists the app config, creating the directory as needed.
func saveAppConfig(cfg appConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := proxyConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// scutilProxyLineRe matches one "Key : value" line of `scutil --proxy`.
var scutilProxyLineRe = regexp.MustCompile(`(?m)^\s*(\w+)\s*:\s*(.+?)\s*$`)

// parseScutilProxy extracts HTTP/HTTPS/SOCKS proxies ("host:port") from
// `scutil --proxy` output. Returns empty strings for disabled/absent entries.
func parseScutilProxy(out string) (httpProxy, httpsProxy, socksProxy string) {
	m := make(map[string]string)
	for _, match := range scutilProxyLineRe.FindAllStringSubmatch(out, -1) {
		m[match[1]] = strings.TrimSpace(match[2])
	}
	entry := func(enableKey, hostKey, portKey string) string {
		if m[enableKey] != "1" || m[hostKey] == "" {
			return ""
		}
		host := m[hostKey]
		if port := m[portKey]; port != "" {
			host += ":" + port
		}
		return host
	}
	return entry("HTTPEnable", "HTTPProxy", "HTTPPort"),
		entry("HTTPSEnable", "HTTPSProxy", "HTTPSPort"),
		entry("SOCKSEnable", "SOCKSProxy", "SOCKSPort")
}

// detectSystemProxy reads the macOS system proxy settings.
func detectSystemProxy() SystemProxyStatus {
	out, err := exec.Command("scutil", "--proxy").Output()
	if err != nil {
		return SystemProxyStatus{}
	}
	http, https, socks := parseScutilProxy(string(out))
	return SystemProxyStatus{HTTP: http, HTTPS: https, SOCKS: socks}
}

// setOrUnset sets a process env var when v is non-empty, otherwise unsets it.
func setOrUnset(key, v string) {
	if v != "" {
		os.Setenv(key, v)
	} else {
		os.Unsetenv(key)
	}
}

// applyProxyEnv routes this process (and thus every brew subprocess) through
// the system proxy when enabled, and removes proxy env vars when disabled.
// localhost is always kept direct so local mirrors/services keep working.
func applyProxyEnv(status SystemProxyStatus) {
	if !status.Enabled {
		setOrUnset("HTTP_PROXY", "")
		setOrUnset("HTTPS_PROXY", "")
		setOrUnset("ALL_PROXY", "")
		setOrUnset("NO_PROXY", "localhost,127.0.0.1,::1")
		return
	}
	if status.HTTP != "" {
		setOrUnset("HTTP_PROXY", "http://"+status.HTTP)
	} else {
		setOrUnset("HTTP_PROXY", "")
	}
	if status.HTTPS != "" {
		setOrUnset("HTTPS_PROXY", "http://"+status.HTTPS)
	} else {
		setOrUnset("HTTPS_PROXY", "")
	}
	switch {
	case status.SOCKS != "":
		setOrUnset("ALL_PROXY", "socks5://"+status.SOCKS)
	case status.HTTP != "":
		setOrUnset("ALL_PROXY", "http://"+status.HTTP)
	default:
		setOrUnset("ALL_PROXY", "")
	}
	setOrUnset("NO_PROXY", "localhost,127.0.0.1,::1")
}

// applyPersistedSystemProxy loads the saved toggle and applies it to the
// current process so every brew command inherits the proxy (called on startup).
func applyPersistedSystemProxy() {
	status := detectSystemProxy()
	status.Enabled = loadAppConfig().SystemProxyEnabled
	applyProxyEnv(status)
}

// GetSystemProxy returns the detected macOS system proxy and whether the app
// has enabled routing brew traffic through it.
func (s *Service) GetSystemProxy() *SystemProxyStatus {
	status := detectSystemProxy()
	status.Enabled = loadAppConfig().SystemProxyEnabled
	return &status
}

// SetSystemProxyEnabled persists the toggle and applies/removes the proxy env
// for the current process. It returns the resulting status so the UI can show
// what is actually in effect (e.g. "on but no proxy detected").
func (s *Service) SetSystemProxyEnabled(enabled bool) (*SystemProxyStatus, error) {
	cfg := loadAppConfig()
	cfg.SystemProxyEnabled = enabled
	if err := saveAppConfig(cfg); err != nil {
		return nil, err
	}
	status := detectSystemProxy()
	status.Enabled = enabled
	applyProxyEnv(status)
	return &status, nil
}
