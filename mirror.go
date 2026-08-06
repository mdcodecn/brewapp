package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// MirrorSource describes a Homebrew download mirror preset.
// Env holds the HOMEBREW_* variables that should be written to the shell
// profile when this source is activated (empty map = official default,
// i.e. remove every mirror variable).
type MirrorSource struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	URL         string            `json:"url"`
	Env         map[string]string `json:"env,omitempty"`
}

// MirrorSourcesResponse contains the mirror presets and the currently
// active source id ("official" when no mirror is configured, "custom" when
// the configured value matches none of the presets).
type MirrorSourcesResponse struct {
	Sources []MirrorSource `json:"sources"`
	Current string         `json:"current"`
}

// mirrorEnvKeys are the environment variables that control where Homebrew
// downloads its API data, bottles and git repositories. When switching
// sources we clean every existing line for these keys (including ones
// written by chsrc or manually) so the new configuration is the only one
// in effect, then append a fresh block.
var mirrorEnvKeys = []string{
	"HOMEBREW_API_DOMAIN",
	"HOMEBREW_BOTTLE_DOMAIN",
	"HOMEBREW_BREW_GIT_REMOTE",
	"HOMEBREW_CORE_GIT_REMOTE",
}

// mirrorBlockBegin/End mark the block appended by this app. chsrc uses its
// own "BLOCK BEGIN/ENDIN for Homebrew" markers which are cleaned up too.
const (
	mirrorBlockBegin = "# ------ brew-manager mirror BEGIN for Homebrew ------"
	mirrorBlockEnd   = "# ------ brew-manager mirror END for Homebrew ------"
)

// predefinedMirrorSources returns the mirror presets offered in the UI.
func predefinedMirrorSources() []MirrorSource {
	return []MirrorSource{
		{
			ID:          "official",
			Name:        "官方 GitHub",
			Description: "Homebrew 默认官方源，下载速度受网络环境影响",
			URL:         "https://github.com/Homebrew",
			Env:         map[string]string{},
		},
		{
			ID:          "tuna",
			Name:        "清华 TUNA",
			Description: "清华大学开源软件镜像站",
			URL:         "https://mirrors.tuna.tsinghua.edu.cn",
			Env: map[string]string{
				"HOMEBREW_API_DOMAIN":      "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api",
				"HOMEBREW_BOTTLE_DOMAIN":   "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles",
				"HOMEBREW_BREW_GIT_REMOTE": "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git",
				"HOMEBREW_CORE_GIT_REMOTE": "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git",
			},
		},
		{
			ID:          "aliyun",
			Name:        "阿里云",
			Description: "阿里云开源镜像站",
			URL:         "https://mirrors.aliyun.com",
			Env: map[string]string{
				"HOMEBREW_API_DOMAIN":      "https://mirrors.aliyun.com/homebrew-bottles/api",
				"HOMEBREW_BOTTLE_DOMAIN":   "https://mirrors.aliyun.com/homebrew-bottles",
				"HOMEBREW_BREW_GIT_REMOTE": "https://mirrors.aliyun.com/git/homebrew/brew.git",
				"HOMEBREW_CORE_GIT_REMOTE": "https://mirrors.aliyun.com/git/homebrew/homebrew-core.git",
			},
		},
		{
			ID:          "ustc",
			Name:        "中科大 USTC",
			Description: "中国科学技术大学开源镜像站",
			URL:         "https://mirrors.ustc.edu.cn",
			Env: map[string]string{
				"HOMEBREW_API_DOMAIN":      "https://mirrors.ustc.edu.cn/homebrew-bottles/api",
				"HOMEBREW_BOTTLE_DOMAIN":   "https://mirrors.ustc.edu.cn/homebrew-bottles",
				"HOMEBREW_BREW_GIT_REMOTE": "https://mirrors.ustc.edu.cn/git/homebrew/brew.git",
				"HOMEBREW_CORE_GIT_REMOTE": "https://mirrors.ustc.edu.cn/git/homebrew/homebrew-core.git",
			},
		},
		{
			ID:          "bfsu",
			Name:        "北外 BFSU",
			Description: "北京外国语大学开源镜像站",
			URL:         "https://mirrors.bfsu.edu.cn",
			Env: map[string]string{
				"HOMEBREW_API_DOMAIN":      "https://mirrors.bfsu.edu.cn/homebrew-bottles/api",
				"HOMEBREW_BOTTLE_DOMAIN":   "https://mirrors.bfsu.edu.cn/homebrew-bottles",
				"HOMEBREW_BREW_GIT_REMOTE": "https://mirrors.bfsu.edu.cn/git/homebrew/brew.git",
				"HOMEBREW_CORE_GIT_REMOTE": "https://mirrors.bfsu.edu.cn/git/homebrew/homebrew-core.git",
			},
		},
	}
}

// GetMirrorSources returns the mirror presets and the currently active one.
func (s *Service) GetMirrorSources() (*MirrorSourcesResponse, error) {
	sources := predefinedMirrorSources()
	return &MirrorSourcesResponse{
		Sources: sources,
		Current: currentMirrorID(sources),
	}, nil
}

// SetMirrorSource switches the Homebrew download source: it rewrites the
// shell profile (persisted for future terminals) and updates this process
// environment so the change takes effect immediately inside the app.
func (s *Service) SetMirrorSource(id string) error {
	sources := predefinedMirrorSources()
	var target *MirrorSource
	for i := range sources {
		if sources[i].ID == id {
			target = &sources[i]
			break
		}
	}
	if target == nil {
		return fmt.Errorf("未知镜像源: %s", id)
	}

	path := shellConfigPath()
	if err := writeShellMirrorEnv(path, target.Env); err != nil {
		return err
	}

	// Make the change effective for the current app process right away.
	for _, key := range mirrorEnvKeys {
		if v, ok := target.Env[key]; ok {
			os.Setenv(key, v)
		} else {
			os.Unsetenv(key)
		}
	}
	return nil
}

// currentMirrorID detects the active mirror: it prefers the persisted
// configuration inside the shell profile, then falls back to the current
// process environment, then to "official".
func currentMirrorID(sources []MirrorSource) string {
	domain := ""
	if env := parseMirrorEnvFromFile(shellConfigPath()); env != nil {
		domain = env["HOMEBREW_API_DOMAIN"]
	}
	if domain == "" {
		domain = os.Getenv("HOMEBREW_API_DOMAIN")
	}
	if domain == "" {
		return "official"
	}
	domain = normalizeURL(domain)
	for _, m := range sources {
		if normalizeURL(m.Env["HOMEBREW_API_DOMAIN"]) == domain {
			return m.ID
		}
	}
	return "custom"
}

// normalizeURL collapses consecutive slashes after the scheme, so values
// written by tools like chsrc (e.g. "https://mirrors.bfsu.edu.cn//homebrew-
// bottles/api") compare equal to the standard single-slash form.
func normalizeURL(u string) string {
	protocol := ""
	if i := strings.Index(u, "://"); i >= 0 {
		protocol = u[:i+3]
		u = u[i+3:]
	}
	for strings.Contains(u, "//") {
		u = strings.ReplaceAll(u, "//", "/")
	}
	return protocol + u
}

// shellConfigPath returns the shell profile that should hold the Homebrew
// mirror variables. macOS defaults to zsh; bash reads ~/.bash_profile for
// login shells; fish uses its config file.
func shellConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}
	switch filepath.Base(os.Getenv("SHELL")) {
	case "fish":
		return filepath.Join(home, ".config", "fish", "config.fish")
	case "bash":
		if fileExists(filepath.Join(home, ".bash_profile")) {
			return filepath.Join(home, ".bash_profile")
		}
		return filepath.Join(home, ".bashrc")
	default:
		return filepath.Join(home, ".zshrc")
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// mirrorVarLineRe matches lines that set one of the mirror-related variables,
// e.g. `export HOMEBREW_API_DOMAIN="..."`, `unset HOMEBREW_BOTTLE_DOMAIN` or
// a plain `HOMEBREW_API_DOMAIN=...`.
var mirrorVarLineRe = regexp.MustCompile(
	`^\s*(?:export\s+|unset\s+)?(?:HOMEBREW_API_DOMAIN|HOMEBREW_BOTTLE_DOMAIN|HOMEBREW_BREW_GIT_REMOTE|HOMEBREW_CORE_GIT_REMOTE)\b`,
)

// filterMirrorLines removes every existing mirror configuration from the
// shell profile content: the mirror variable lines (from any tool) plus the
// block markers of chsrc / brew-manager and chsrc's fixed comment line.
// Everything else is left untouched.
func filterMirrorLines(content string) string {
	lines := strings.Split(content, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if mirrorVarLineRe.MatchString(line) {
			continue
		}
		if strings.Contains(trimmed, "BLOCK BEGIN for Homebrew") ||
			strings.Contains(trimmed, "BLOCK ENDIN for Homebrew") ||
			strings.Contains(trimmed, "mirror BEGIN for Homebrew") ||
			strings.Contains(trimmed, "mirror END for Homebrew") {
			continue
		}
		if trimmed == "# For Bottles" {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// parseMirrorEnvFromFile reads the mirror variables (last one wins, which
// matches how shells evaluate export lines) from the given shell profile.
func parseMirrorEnvFromFile(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return parseMirrorEnv(string(data))
}

// parseMirrorEnv extracts the mirror variable values from shell profile
// content. Handles `export VAR="value"`, `export VAR='value'` and `VAR=value`.
func parseMirrorEnv(content string) map[string]string {
	env := map[string]string{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		for _, key := range mirrorEnvKeys {
			prefix := "export " + key + "="
			if strings.HasPrefix(line, prefix) {
				env[key] = trimQuotes(strings.TrimPrefix(line, prefix))
				break
			}
			if strings.HasPrefix(line, key+"=") {
				env[key] = trimQuotes(strings.TrimPrefix(line, key+"="))
				break
			}
		}
	}
	return env
}

func trimQuotes(v string) string {
	v = strings.TrimSpace(v)
	if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') && v[len(v)-1] == v[0] {
		return v[1 : len(v)-1]
	}
	return v
}

// writeShellMirrorEnv persists the mirror variables into the shell profile.
// It backs up the original file to <path>.bak, strips every existing mirror
// line/marker and appends a fresh block (or removes the block entirely when
// env is empty, i.e. back to the official default).
func writeShellMirrorEnv(path string, env map[string]string) error {
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("读取 %s 失败: %w", path, err)
	}

	// Back up the original file before touching it.
	if len(content) > 0 {
		if err := os.WriteFile(path+".bak", content, 0o644); err != nil {
			return fmt.Errorf("备份 %s 失败: %w", path, err)
		}
	}

	filtered := filterMirrorLines(string(content))

	var sb strings.Builder
	sb.WriteString(filtered)
	if filtered != "" && !strings.HasSuffix(filtered, "\n") {
		sb.WriteString("\n")
	}

	if len(env) > 0 {
		sb.WriteString(mirrorBlockBegin + "\n")
		for _, key := range mirrorEnvKeys {
			if v, ok := env[key]; ok {
				sb.WriteString(fmt.Sprintf("export %s=\"%s\"\n", key, v))
			}
		}
		sb.WriteString(mirrorBlockEnd + "\n")
	}

	// Keep the original file permissions.
	mode := os.FileMode(0o644)
	if fi, err := os.Stat(path); err == nil {
		mode = fi.Mode().Perm()
	}
	if err := os.WriteFile(path, []byte(sb.String()), mode); err != nil {
		return fmt.Errorf("写入 %s 失败: %w", path, err)
	}
	return nil
}
