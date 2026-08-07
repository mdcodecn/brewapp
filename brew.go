package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// BrewPackage represents a Homebrew package (cask or formula)
type BrewPackage struct {
	Name          string   `json:"name"`
	Version       string   `json:"version"`
	LatestVersion string   `json:"latest_version,omitempty"`
	Description   string   `json:"description"`
	Type          string   `json:"type"` // "cask" or "formula"
	Outdated      bool     `json:"outdated"`
	Installed     bool     `json:"installed"`
	Pinned        bool     `json:"pinned"`
	DependsOn     []string `json:"depends_on,omitempty"`
	InstallTime   string   `json:"install_time,omitempty"`
}

// BrewService represents a background service managed by `brew services`
type BrewService struct {
	Name     string `json:"name"`
	Status   string `json:"status"` // started / stopped / none / error / unknown
	User     string `json:"user,omitempty"`
	File     string `json:"file,omitempty"`
	ExitCode string `json:"exit_code,omitempty"`
	Pid      string `json:"pid,omitempty"`
}

// BrewSearchResult represents a search result from brew search
type BrewSearchResult struct {
	Name         string  `json:"name"`
	Version      string  `json:"version"`
	Description  string  `json:"description"`
	Type         string  `json:"type"`
	Installed    bool    `json:"installed"`
	Score        float64 `json:"score,omitempty"`
	Rank         int     `json:"rank,omitempty"`          // 推荐列表中的热度排名（1 起）
	InstallCount string  `json:"install_count,omitempty"` // 30 天安装次数（原始字符串，如 "273,501"）
	Percent      string  `json:"percent,omitempty"`       // 30 天安装占比（热度，如 "2.55"）
}

// Service handles all brew operations
type Service struct {
	ctx context.Context
}

// NewService creates a new brew service
func NewService() *Service {
	return &Service{}
}

// debugLog appends a timestamped line to /tmp/bm_debug.log, but only when the
// BM_DEBUG environment variable is set — the default is a no-op so the
// per-event instrumentation never costs file I/O (open/write/close per line)
// in normal runs.
var (
	debugLogOnce sync.Once
	debugLogOn   bool
)

func debugLog(format string, args ...interface{}) {
	debugLogOnce.Do(func() { debugLogOn = os.Getenv("BM_DEBUG") != "" })
	if !debugLogOn {
		return
	}
	f, err := os.OpenFile("/tmp/bm_debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s\n", time.Now().Format("15:04:05.000"), fmt.Sprintf(format, args...))
}

// setContext stores the application context (called on startup)
func (s *Service) setContext(ctx context.Context) {
	s.ctx = ctx
	debugLog("setContext called, ctx=%v", ctx != nil)
	// Route brew subprocesses through the system proxy if the user enabled it.
	applyPersistedSystemProxy()
}

// startup is called when the app starts (Wails OnStartup).
func (s *Service) startup(ctx context.Context) {
	s.setContext(ctx)
	// Hide the system traffic lights (we draw our own in the sidebar)
	hideSystemTrafficLights()
}

// brewPathMu / brewPath / brewPathResolved cache the resolved Homebrew
// location so we only pay the discovery cost once. GUI apps launched from
// Finder/Dock inherit only /usr/bin:/bin:/usr/sbin:/sbin, so "brew" is NOT
// resolvable through the process PATH — we must find it in the user's actual
// environment. The mutex keeps ResetBrewDetection ("重新检测") race-free with
// concurrent brew calls that read the cached path.
var (
	brewPathMu       sync.Mutex
	brewPathResolved bool
	brewPath         string
)

// brewExecutable returns the absolute path to the brew binary, resolving it
// on first use. Returns "brew" as a last resort so error messages stay
// meaningful when Homebrew is genuinely not installed.
func brewExecutable() string {
	brewPathMu.Lock()
	defer brewPathMu.Unlock()
	if !brewPathResolved {
		brewPath = resolveBrewPath()
		brewPathResolved = true
	}
	return brewPath
}

// resolveBrewPath discovers brew wherever the user installed it — default
// prefixes, custom prefixes, nix/mise-style setups, or anything exported in
// their shell profile. It never assumes a fixed install location.
func resolveBrewPath() string {
	// 1) Well-known prefixes: zero-cost fast path, no subprocess needed.
	if p := brewFromKnownPrefixes(); p != "" {
		return p
	}

	// 2) Ask the user's login shell. A login shell loads /etc/zprofile,
	//    ~/.zprofile and runs path_helper, which reads /etc/paths.d — the
	//    standard way Homebrew registers itself on macOS.
	for _, shell := range userShellCandidates() {
		if p := brewFromLoginShell(shell); p != "" {
			return p
		}
	}

	// 3) Some setups only export PATH in interactive rc files (~/.zshrc,
	//    ~/.bashrc). Source those explicitly and re-query.
	for _, shell := range userShellCandidates() {
		if p := brewFromRCFiles(shell); p != "" {
			return p
		}
	}

	// 4) Terminal-launched fallback (PATH already contains brew).
	if p, err := exec.LookPath("brew"); err == nil {
		return p
	}

	return "brew"
}

// brewFromKnownPrefixes checks the standard install locations.
func brewFromKnownPrefixes() string {
	candidates := []string{
		"/opt/homebrew/bin/brew",              // Apple Silicon
		"/usr/local/bin/brew",                 // Intel
		"/opt/local/bin/brew",                 // rare /opt/local installs
		"/home/linuxbrew/.linuxbrew/bin/brew", // Linuxbrew
	}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".homebrew/bin/brew"),
			filepath.Join(home, ".linuxbrew/bin/brew"),
			filepath.Join(home, "homebrew/bin/brew"),
		)
	}
	for _, p := range candidates {
		if isExecutableFile(p) {
			return p
		}
	}
	return ""
}

// userShellCandidates returns the shells to probe, user's default first.
func userShellCandidates() []string {
	seen := map[string]bool{}
	out := make([]string, 0, 4)
	add := func(s string) {
		if s == "" || seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	add(os.Getenv("SHELL"))
	add("/bin/zsh")
	add("/bin/bash")
	add("/bin/sh")
	return out
}

// brewFromLoginShell evaluates `command -v brew` in a login shell, covering
// ~/.zprofile, /etc/zprofile, path_helper and /etc/paths.d entries.
func brewFromLoginShell(shell string) string {
	return runShellQuery(shell, "-l", "-c", "command -v brew")
}

// brewFromRCFiles sources the common rc/profile files directly, covering
// setups that only export PATH in interactive rc files (~/.zshrc, ~/.bashrc).
func brewFromRCFiles(shell string) string {
	const script = "source ~/.zshenv 2>/dev/null; source ~/.zprofile 2>/dev/null; " +
		"source ~/.profile 2>/dev/null; source ~/.bash_profile 2>/dev/null; " +
		"source ~/.bashrc 2>/dev/null; source ~/.zshrc 2>/dev/null; " +
		"command -v brew"
	return runShellQuery(shell, "-c", script)
}

// runShellQuery runs `command -v brew` in the given shell with a timeout and
// returns the resolved absolute path, or "" when not found. The timeout keeps
// slow shells (oh-my-zsh, nvm, …) from blocking startup.
func runShellQuery(shell string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, shell, args...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	p := strings.TrimSpace(string(out))
	if p == "" || strings.ContainsAny(p, " \t\n") || !isExecutableFile(p) {
		return ""
	}
	return p
}

// isExecutableFile reports whether p exists and is executable.
func isExecutableFile(p string) bool {
	info, err := os.Stat(p)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

// ResetBrewDetection clears the cached location so the next brew call
// re-discovers it (used by the UI's "重新检测" button after installing brew).
func (s *Service) ResetBrewDetection() {
	brewPathMu.Lock()
	defer brewPathMu.Unlock()
	brewPath = ""
	brewPathResolved = false
}

// BrewInfo reports Homebrew availability and location to the UI.
type BrewInfo struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Error     string `json:"error,omitempty"`
}

// GetBrewInfo returns whether Homebrew was found and where.
func (s *Service) GetBrewInfo() *BrewInfo {
	info := &BrewInfo{}
	if isExecutableFile(brewExecutable()) {
		info.Available = true
		info.Path = brewExecutable()
		info.Version = s.GetVersion()
	} else {
		info.Error = "未找到 Homebrew。请先安装：https://brew.sh"
	}
	return info
}

// runBrew executes a brew command and returns the output
func (s *Service) runBrew(args ...string) (string, error) {
	cmd := exec.Command(brewExecutable(), args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("brew %s: %s (%w)", strings.Join(args, " "), string(output), err)
	}
	return string(output), nil
}

// ===== Streaming brew execution (live progress to the UI) =====

// brew event kinds streamed to the frontend under "brew:progress".
const (
	brewEventStart   = "start"   // command header line
	brewEventLine    = "line"    // a normal output line
	brewEventRefresh = "refresh" // \r progress-bar update: replace the last line
	brewEventPhase   = "phase"   // section header (config import between packages)
	brewEventDone    = "done"    // command finished
)

// brewProgressEvent is the JSON payload of a "brew:progress" event.
type brewProgressEvent struct {
	Op    string `json:"op"`
	Kind  string `json:"kind"`
	Text  string `json:"text,omitempty"`
	Ok    bool   `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
}

// emitBrewEvent pushes a progress event to the frontend. No-op when the
// runtime context is not ready (e.g. during unit tests).
func (s *Service) emitBrewEvent(op, kind, text string, ok bool, errMsg string) {
	debugLog("emitBrewEvent op=%q kind=%q text=%.60q ctxNil=%v", op, kind, text, s.ctx == nil)
	if s.ctx == nil {
		return
	}
	runtime.EventsEmit(s.ctx, "brew:progress", brewProgressEvent{
		Op: op, Kind: kind, Text: text, Ok: ok, Error: errMsg,
	})
}

// ansiEscapeRe matches common ANSI escape sequences (colors, cursor moves,
// charset/keypad selectors, OSC title). brew normally disables color when
// piped, but under a pty (streamCommand below) it treats the output as a
// terminal and emits colors and progress-bar control codes, so we must strip
// them before showing the log.
var ansiEscapeRe = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[()=><][A-Za-z0-9]`)

// splitBrewOutput is a bufio.SplitFunc that breaks on \n and \r (homebrew
// updates download progress bars with bare \r), keeping the delimiter so the
// consumer can tell line tokens from progress-refresh tokens.
func splitBrewOutput(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		switch data[i] {
		case '\n':
			return i + 1, data[:i+1], nil
		case '\r':
			// \r\n is a normal line ending; a lone \r is a progress refresh
			if i+1 < len(data) && data[i+1] == '\n' {
				return i + 2, data[:i+2], nil
			}
			return i + 1, data[:i+1], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// streamCommand runs `brew <args...>` under a pseudo-terminal (pty) and
// streams its output line-by-line to the frontend as "brew:progress" events
// tagged with op. It returns the captured output (delimiter-trimmed) and the
// process error.
//
// A pty is used instead of plain pipes because Homebrew's Ruby runtime only
// line-buffers stdout when it is attached to a terminal. When stdout is a
// pipe, Ruby block-buffers it (4 KiB), so a long-running command such as
// `brew upgrade` emits NOTHING until the buffer fills or the process exits —
// the UI progress log would stay empty for minutes. Under a pty the output
// arrives immediately, and brew's download progress bars (bare \r) work too.
func (s *Service) streamCommand(op string, args ...string) (string, error) {
	cmd := exec.Command(brewExecutable(), args...)

	// Run brew under a pty sized like a normal terminal. A fixed size is
	// important: brew truncates section titles to the terminal width unless
	// --verbose is passed (e.g. `brew install`), and a zero-sized pty would
	// truncate them to nothing.
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 30, Cols: 120})
	if err != nil {
		return "", fmt.Errorf("start command in pty: %w", err)
	}

	var (
		mu  sync.Mutex
		out strings.Builder
	)

	emit := func(kind, text string) {
		s.emitBrewEvent(op, kind, text, false, "")
		mu.Lock()
		out.WriteString(text)
		out.WriteByte('\n')
		mu.Unlock()
	}

	// Read the merged stdout+stderr stream from the pty master. The master
	// hits EOF once the child (and its pty slave) exits, so this loop ends
	// naturally and Wait can then reap the process.
	sc := bufio.NewScanner(ptmx)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	sc.Split(splitBrewOutput)
	for sc.Scan() {
		raw := ansiEscapeRe.ReplaceAllString(sc.Text(), "")
		var kind, text string
		if strings.HasSuffix(raw, "\r") {
			// tty converts \n to \r\n; a lone \r (no following \n) is a
			// progress-bar refresh that replaces the previous line
			kind, text = brewEventRefresh, strings.TrimRight(raw, "\r")
		} else {
			kind, text = brewEventLine, strings.TrimRight(raw, "\r\n")
		}
		if text == "" {
			continue
		}
		emit(kind, text)
	}

	ptmx.Close()
	if err := cmd.Wait(); err != nil {
		return out.String(), err
	}
	return out.String(), nil
}

// runBrewStreaming runs a brew command under a frontend-streamed progress log.
// It emits a start marker before and a done marker after the output.
func (s *Service) runBrewStreaming(op string, args ...string) (string, error) {
	debugLog("runBrewStreaming op=%q args=%v", op, args)
	s.emitBrewEvent(op, brewEventStart, "brew "+strings.Join(args, " "), false, "")
	output, err := s.streamCommand(op, args...)
	s.emitBrewEvent(op, brewEventDone, "", err == nil, errString(err))
	return output, err
}

// runBrewStreamingPhase is runBrewStreaming with a leading phase header
// instead of the command-start marker (used by config import between packages).
func (s *Service) runBrewStreamingPhase(op, phase string, args ...string) (string, error) {
	s.emitBrewEvent(op, brewEventPhase, phase, false, "")
	output, err := s.streamCommand(op, args...)
	s.emitBrewEvent(op, brewEventDone, "", err == nil, errString(err))
	return output, err
}

// errString renders an error for event payloads ("" when nil).
func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// GetVersion returns the Homebrew version
func (s *Service) GetVersion() string {
	output, err := s.runBrew("--version")
	if err != nil {
		return "Homebrew not found. Please install Homebrew first."
	}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	if len(lines) > 0 {
		return lines[0]
	}
	return output
}

// installedInfoJSON holds the fields we need from `brew info --json=v2 --installed`
type installedInfoJSON struct {
	Formulae []struct {
		Name string `json:"name"`
		Desc string `json:"desc"`
	} `json:"formulae"`
	Casks []struct {
		Token string `json:"token"`
		Desc  string `json:"desc"`
	} `json:"casks"`
}

// formulaV2Info mirrors one entry of the formulae array in `brew info --json=v2`.
type formulaV2Info struct {
	Name     string `json:"name"`
	Desc     string `json:"desc"`
	Versions struct {
		Stable string `json:"stable"`
	} `json:"versions"`
	// Newer Homebrew schema: flat dependency arrays
	Dependencies            []string `json:"dependencies"`
	BuildDependencies       []string `json:"build_dependencies"`
	TestDependencies        []string `json:"test_dependencies"`
	RecommendedDependencies []string `json:"recommended_dependencies"`
	OptionalDependencies    []string `json:"optional_dependencies"`
	// Older Homebrew schema: grouped object (deprecated, may be absent)
	DependsOn struct {
		Build       []string `json:"build"`
		Optional    []string `json:"optional"`
		Recommended []string `json:"recommended"`
		Test        []string `json:"test"`
		Required    []string `json:"required"`
	} `json:"depends_on"`
	Installed []struct {
		Time    int64  `json:"time"`
		Version string `json:"version"`
	} `json:"installed"`
	Pinned bool `json:"pinned"`
}

// infoV2JSON holds the fields we need from `brew info --json=v2 <name>`.
// The v2 format always wraps results in an object with formulae/casks arrays
// (unlike the v1 format, which is a bare array of formula objects).
type infoV2JSON struct {
	Formulae []formulaV2Info `json:"formulae"`
	Casks    []struct {
		Token         string `json:"token"`
		Desc          string `json:"desc"`
		Version       string `json:"version"`
		InstalledTime int64  `json:"installed_time"`
		Pinned        bool   `json:"pinned"`
	} `json:"casks"`
}

// mergeDependencies collects the flat (new schema) and grouped (old schema)
// dependency arrays of a formula into one de-duplicated list, preserving order.
func mergeDependencies(f formulaV2Info) []string {
	raw := make([]string, 0, 8)
	raw = append(raw, f.Dependencies...)
	raw = append(raw, f.BuildDependencies...)
	raw = append(raw, f.RecommendedDependencies...)
	raw = append(raw, f.OptionalDependencies...)
	raw = append(raw, f.TestDependencies...)
	d := f.DependsOn
	raw = append(raw, d.Build...)
	raw = append(raw, d.Optional...)
	raw = append(raw, d.Recommended...)
	raw = append(raw, d.Test...)
	raw = append(raw, d.Required...)

	seen := make(map[string]bool, len(raw))
	deps := make([]string, 0, len(raw))
	for _, dep := range raw {
		if dep == "" || seen[dep] {
			continue
		}
		seen[dep] = true
		deps = append(deps, dep)
	}
	return deps
}

// getInstalledDescriptions maps package name -> description using one brew call
func (s *Service) getInstalledDescriptions() map[string]string {
	desc := make(map[string]string)
	output, err := s.runBrew("info", "--json=v2", "--installed")
	if err != nil {
		return desc
	}
	var data installedInfoJSON
	if err := json.Unmarshal([]byte(output), &data); err != nil {
		return desc
	}
	for _, f := range data.Formulae {
		desc[f.Name] = f.Desc
	}
	for _, c := range data.Casks {
		desc[c.Token] = c.Desc
	}
	return desc
}

// ListInstalled returns all installed packages.
// A single `brew info --json=v2 --installed` call carries the name, installed
// version, description, install time and pinned state for both casks and
// formulae — replacing the previous four subprocess calls (list --cask,
// list --formula, info --json=v2 --installed, list --pinned).
func (s *Service) ListInstalled() ([]BrewPackage, error) {
	output, err := s.runBrew("info", "--json=v2", "--installed")
	if err != nil {
		return []BrewPackage{}, err
	}
	var data infoV2JSON
	if err := json.Unmarshal([]byte(output), &data); err != nil {
		return []BrewPackage{}, err
	}

	packages := make([]BrewPackage, 0, len(data.Casks)+len(data.Formulae))
	// Casks first, then formulae (keeps the previous ordering).
	for _, c := range data.Casks {
		packages = append(packages, BrewPackage{
			Name:        c.Token,
			Version:     c.Version,
			Description: c.Desc,
			Type:        "cask",
			Pinned:      c.Pinned,
		})
	}
	for _, f := range data.Formulae {
		version := ""
		var installTime int64
		if len(f.Installed) > 0 {
			version = f.Installed[0].Version
			installTime = f.Installed[0].Time
		}
		pkg := BrewPackage{
			Name:        f.Name,
			Version:     version,
			Description: f.Desc,
			Type:        "formula",
			Pinned:      f.Pinned,
		}
		if installTime > 0 {
			pkg.InstallTime = time.Unix(installTime, 0).Format("2006-01-02 15:04:05")
		}
		packages = append(packages, pkg)
	}
	return packages, nil
}

// runBrewRetryUntrusted runs a brew command whose final argument is a
// package name. When Homebrew refuses to load the package because its tap has
// not been trusted yet (e.g. "Refusing to load formula hashicorp/tap/consul
// from untrusted tap hashicorp/tap"), it retries with the fully-qualified
// <tap>/<name> form, which Homebrew still allows to load without trusting the
// tap.
func (s *Service) runBrewRetryUntrusted(args ...string) (string, error) {
	name := args[len(args)-1]
	output, err := s.runBrew(args...)
	if err != nil && strings.Contains(err.Error(), "from untrusted tap") {
		if qualified := qualifiedInfoName(name, err); qualified != name {
			retryArgs := append(append([]string{}, args[:len(args)-1]...), qualified)
			output, err = s.runBrew(retryArgs...)
		}
	}
	return output, err
}

// brewInfoJSON runs `brew info` with the given args plus a package name,
// retrying with the fully-qualified name for untrusted taps.
func (s *Service) brewInfoJSON(name string, args ...string) (string, error) {
	full := append(append([]string{}, args...), name)
	return s.runBrewRetryUntrusted(full...)
}

// untrustedLoadPattern extracts the fully-qualified name (<tap>/<name>) from
// an untrusted-tap refusal message. Compiled once at package level; the
// refusal path is hit on every untrusted-tap retry.
var untrustedLoadPattern = regexp.MustCompile(`Refusing to load (?:formula|cask) ([^\s]+) from untrusted tap`)

// qualifiedInfoName extracts the fully-qualified name (<tap>/<name>) from an
// untrusted-tap refusal message such as:
// "Refusing to load formula hashicorp/tap/consul from untrusted tap ...".
// Returns the original name when the message cannot be parsed.
func qualifiedInfoName(name string, err error) string {
	if m := untrustedLoadPattern.FindStringSubmatch(err.Error()); len(m) > 1 {
		return m[1]
	}
	return name
}

// PackageDetail aggregates everything the package detail modal needs, fetched
// with a single `brew info --json=v2 <name>` call (previously three separate
// brew invocations: GetPackageInfo + GetDependencies + GetPackageInstallTime).
type PackageDetail struct {
	BrewPackage
	InstallTime string   `json:"install_time,omitempty"`
	DependsOn   []string `json:"depends_on,omitempty"`
}

// GetPackageDetail returns package info, install time and dependencies for a
// single package in one brew call (`brew info --json=v2`). GetUses stays
// separate (it is a different command: `brew uses --installed <name>`).
// Whether the package is installed is derived from the info JSON itself
// (formulae[].installed non-empty / casks[].installed_time > 0), avoiding a
// separate `brew list --versions` subprocess.
func (s *Service) GetPackageDetail(name, pkgType string) (*PackageDetail, error) {
	detail := &PackageDetail{BrewPackage: BrewPackage{Name: name, Type: pkgType}}

	// Primary: v2 format (object with formulae/casks arrays) — description,
	// version, install time, installed state and dependencies all come from
	// this one call.
	jsonOutput, err := s.brewInfoJSON(name, "info", "--json=v2")
	if err == nil {
		var data infoV2JSON
		if jsonErr := json.Unmarshal([]byte(jsonOutput), &data); jsonErr == nil {
			if pkgType == "cask" && len(data.Casks) > 0 {
				c := data.Casks[0]
				detail.Description = c.Desc
				detail.Version = c.Version
				detail.Installed = c.InstalledTime > 0
				if c.InstalledTime > 0 {
					detail.InstallTime = time.Unix(c.InstalledTime, 0).Format("2006-01-02 15:04:05")
				}
				return detail, nil
			}
			if len(data.Formulae) > 0 {
				f := data.Formulae[0]
				detail.Description = f.Desc
				detail.Version = f.Versions.Stable
				detail.Installed = len(f.Installed) > 0
				if len(f.Installed) > 0 && f.Installed[0].Time > 0 {
					detail.InstallTime = time.Unix(f.Installed[0].Time, 0).Format("2006-01-02 15:04:05")
				}
				detail.DependsOn = mergeDependencies(f)
				return detail, nil
			}
		}
	}

	// Fallback: v1 format (bare array of formula objects) for older brew
	// versions — description, version and installed state only (no deps /
	// install time).
	jsonOutput, err = s.brewInfoJSON(name, "info", "--json")
	if err != nil {
		return detail, err
	}
	var info []struct {
		Name     string `json:"name"`
		Desc     string `json:"desc"`
		Versions struct {
			Stable string `json:"stable"`
		} `json:"versions"`
		Installed []struct {
			Time int64 `json:"time"`
		} `json:"installed"`
	}
	if err := json.Unmarshal([]byte(jsonOutput), &info); err != nil {
		return detail, err
	}
	if len(info) > 0 {
		detail.Description = info[0].Desc
		detail.Version = info[0].Versions.Stable
		detail.Installed = len(info[0].Installed) > 0
	}
	return detail, nil
}

// SearchResponse wraps search results together with non-fatal warnings
// (e.g. untrusted-tap refusals that make one category of results unavailable).
type SearchResponse struct {
	Results  []BrewSearchResult `json:"results"`
	Warnings []string           `json:"warnings"`
}

// installedSetTTL matches the 5-minute cache window the frontend uses, so a
// debounced search doesn't spawn two brew subprocesses on every keystroke.
const installedSetTTL = 5 * time.Minute

var (
	installedSetMu    sync.Mutex
	installedSetCache map[string]bool
	installedSetTime  time.Time
)

// installedSet returns the set of installed package names (casks + formulae),
// cached for installedSetTTL to avoid repeated `brew list` calls.
func (s *Service) installedSet() map[string]bool {
	installedSetMu.Lock()
	defer installedSetMu.Unlock()
	if installedSetCache != nil && time.Since(installedSetTime) < installedSetTTL {
		return installedSetCache
	}

	set := make(map[string]bool)
	for _, args := range [][]string{{"list"}, {"list", "--cask"}} {
		out, err := s.runBrew(args...)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			if t := strings.TrimSpace(line); t != "" && !isBrewNoiseLine(t) {
				set[t] = true
			}
		}
	}
	installedSetCache = set
	installedSetTime = time.Now()
	return set
}

// Search searches for packages matching the query.
// Warnings are returned alongside results: a failed cask or formula search
// (e.g. "Refusing to load ... from untrusted tap" on Homebrew 6+) does not
// discard the other category's results.
func (s *Service) Search(query string) (*SearchResponse, error) {
	if query == "" {
		return &SearchResponse{}, nil
	}

	// Installed lookup is cached so repeated searches don't re-run brew list
	installedSet := s.installedSet()

	// Search casks first, then formulas. Each category may fail on its own
	// (e.g. untrusted tap), so collect warnings instead of dropping results.
	var warnings []string
	caskResults, err := s.searchCasks(query, installedSet)
	if err != nil {
		warnings = append(warnings, searchWarning("cask", err))
	}
	formulaResults, err := s.searchFormulae(query, installedSet)
	if err != nil {
		warnings = append(warnings, searchWarning("formula", err))
	}

	results := append(caskResults, formulaResults...)

	// Enrich with descriptions and versions via batch brew info calls
	if len(results) > 0 && len(results) <= 60 {
		s.enrichSearchResults(results)
	}

	return &SearchResponse{Results: results, Warnings: warnings}, nil
}

// untrustedTapPattern extracts the tap name from Homebrew 6+ refusals such as
// "Error: Refusing to load cask farion1231/ccswitch/cc-switch from untrusted
// tap farion1231/ccswitch."
var untrustedTapPattern = regexp.MustCompile(`from untrusted tap ([^\s.]+)`)

// searchWarning converts a failed `brew search` into a user-facing warning.
// Homebrew 6+ refuses to search untrusted third-party taps; that case gets an
// actionable hint pointing at the in-app trust feature.
func searchWarning(kind string, err error) string {
	msg := err.Error()
	if m := untrustedTapPattern.FindStringSubmatch(msg); len(m) > 1 {
		return fmt.Sprintf("%s 搜索失败：tap「%s」未被信任，无法加载其中的包。请在「仓库」页信任该仓库，或运行 brew trust %s", kind, m[1], m[1])
	}
	return fmt.Sprintf("%s 搜索失败：%s", kind, msg)
}

// enrichSearchResults fills in version and description for search results using
// batch `brew info --json=v2` calls (up to 30 names per invocation).
func (s *Service) enrichSearchResults(results []BrewSearchResult) {
	names := make([]string, 0, len(results))
	for _, r := range results {
		names = append(names, r.Name)
	}

	batchSize := 30
	type info struct {
		version string
		desc    string
	}
	nameToInfo := make(map[string]info, len(names))

	for i := 0; i < len(names); i += batchSize {
		end := i + batchSize
		if end > len(names) {
			end = len(names)
		}
		batch := names[i:end]
		args := append([]string{"info", "--json=v2"}, batch...)
		output, err := s.runBrew(args...)
		if err != nil {
			continue
		}
		var data infoV2JSON
		if err := json.Unmarshal([]byte(output), &data); err != nil {
			continue
		}
		for _, f := range data.Formulae {
			nameToInfo[f.Name] = info{version: f.Versions.Stable, desc: f.Desc}
		}
		for _, c := range data.Casks {
			nameToInfo[c.Token] = info{version: c.Version, desc: c.Desc}
		}
	}

	for i := range results {
		if inf, ok := nameToInfo[results[i].Name]; ok {
			results[i].Version = inf.version
			results[i].Description = inf.desc
		}
	}
}

// searchFormulae searches for formulae matching the query
func (s *Service) searchFormulae(query string, installedSet map[string]bool) ([]BrewSearchResult, error) {
	output, err := s.runBrew("search", "--formulae", query)
	if err != nil {
		return nil, fmt.Errorf("failed to search formulae: %w", err)
	}

	results := make([]BrewSearchResult, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}

		result := BrewSearchResult{
			Name:      line,
			Type:      "formula",
			Installed: installedSet[line],
		}
		results = append(results, result)
	}

	return results, nil
}

// searchCasks searches for casks matching the query
func (s *Service) searchCasks(query string, installedSet map[string]bool) ([]BrewSearchResult, error) {
	output, err := s.runBrew("search", "--casks", query)
	if err != nil {
		return nil, fmt.Errorf("failed to search casks: %w", err)
	}

	results := make([]BrewSearchResult, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}

		result := BrewSearchResult{
			Name:      line,
			Type:      "cask",
			Installed: installedSet[line],
		}
		results = append(results, result)
	}

	return results, nil
}

// ===== Recommended installs (search page) =====
//
// The search page shows a "推荐安装" list while the input is empty. The list
// comes from Homebrew's official 30-day install analytics so it reflects what
// users actually install, and is cached on disk for a few hours to avoid
// re-downloading the multi-MB analytics payload on every visit.

const (
	// formulaAnalyticsURL / caskAnalyticsURL are Homebrew's official analytics
	// endpoints: a ranked list of the most-installed formulae/casks in the
	// last 30 days (sorted by count, descending).
	formulaAnalyticsURL = "https://formulae.brew.sh/api/analytics/install/30d.json"
	caskAnalyticsURL    = "https://formulae.brew.sh/api/analytics/cask-install/30d.json"

	// recommendedPerKind is how many items we keep from each category.
	recommendedPerKind = 6

	// recommendedCacheTTL bounds how long the analytics payload is reused.
	recommendedCacheTTL = 6 * time.Hour

	// recommendedFetchTimeout bounds each analytics download.
	recommendedFetchTimeout = 30 * time.Second

	// recommendedCacheVersion invalidates caches written by older builds when
	// the analyticsItem payload shape changes (e.g. adding Percent). A cache
	// whose version mismatches is treated as absent and re-fetched.
	recommendedCacheVersion = 2
)

// analyticsItem is one entry of the analytics JSON: exactly one of Formula /
// Cask is set depending on the endpoint. Rank is the position in the ranking
// (1-based), Count the raw install count string like "273,501" and Percent the
// share of all installs (e.g. "2.55").
type analyticsItem struct {
	Formula string `json:"formula"`
	Cask    string `json:"cask"`
	Rank    int    `json:"number"`
	Count   string `json:"count"`
	Percent string `json:"percent"`
}

// analyticsJSON mirrors the top-level shape of the analytics endpoints.
type analyticsJSON struct {
	Items []analyticsItem `json:"items"`
}

// recommendedCache is the persisted analytics payload plus the fetch time.
// Version guards against stale caches written by older builds: a mismatch
// makes the cache invalid (re-fetched on next call).
type recommendedCache struct {
	Version   int             `json:"version"`
	FetchedAt int64           `json:"fetched_at"`
	Formula   []analyticsItem `json:"formula"`
	Cask      []analyticsItem `json:"cask"`
}

// recommendedFormulaBlacklist lists well-known build/runtime dependencies that
// dominate the formula install ranking but are rarely what a user wants to
// install directly (they come along with other packages).
var recommendedFormulaBlacklist = map[string]bool{
	"autoconf": true, "automake": true, "brotli": true, "bubblewrap": true,
	"bzip2": true, "ca-certificates": true, "expat": true, "fontconfig": true,
	"freetype": true, "gdbm": true, "gdk-pixbuf": true, "gettext": true,
	"glib": true, "glibc": true, "gmp": true, "harfbuzz": true, "icu4c": true,
	"jpeg": true, "json-c": true, "krb5": true, "libcap": true, "libevent": true,
	"libffi": true, "libgcrypt": true, "libgpg-error": true, "libidn2": true,
	"libjpeg-turbo": true, "libpng": true, "libsodium": true, "libtasn1": true,
	"libtiff": true, "libtool": true, "libunistring": true, "libxml2": true,
	"libyaml": true, "libzip": true, "lzo": true, "m4": true, "ncurses": true,
	"nettle": true, "oniguruma": true, "openssl": true, "p11-kit": true,
	"pcre": true, "pcre2": true, "pkg-config": true, "pkgconf": true,
	"readline": true, "snappy": true, "sqlite": true, "unbound": true,
	"utf8proc": true, "xz": true, "zstd": true,
}

// versionedFormulaRe matches names with an explicit version suffix such as
// openssl@3 or python@3.14. Those are almost always dependency pins or legacy
// tools, not what a fresh-install recommendation should push.
var versionedFormulaRe = regexp.MustCompile(`@\d`)

// isRecommendedFormula reports whether a formula is worth recommending: pure
// dependency packages (blacklist) and version-pinned builds are excluded.
func isRecommendedFormula(name string) bool {
	if recommendedFormulaBlacklist[name] {
		return true
	}
	return versionedFormulaRe.MatchString(name)
}

// parseAnalyticsJSON decodes the analytics endpoint payload into its item list.
func parseAnalyticsJSON(data []byte) ([]analyticsItem, error) {
	var parsed analyticsJSON
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	return parsed.Items, nil
}

// buildRecommendedResults turns the raw analytics items into the search-page
// result list: the top recommendedPerKind casks followed by the top
// recommendedPerKind formulae (after dependency filtering), each marked with
// its install state.
func buildRecommendedResults(formulaItems, caskItems []analyticsItem, installedSet map[string]bool) []BrewSearchResult {
	results := make([]BrewSearchResult, 0, recommendedPerKind*2)

	for _, it := range caskItems {
		if len(results) >= recommendedPerKind {
			break
		}
		results = append(results, BrewSearchResult{
			Name:         it.Cask,
			Type:         "cask",
			Installed:    installedSet[it.Cask],
			Rank:         it.Rank,
			InstallCount: it.Count,
			Percent:      it.Percent,
		})
	}

	for _, it := range formulaItems {
		if len(results) >= recommendedPerKind*2 {
			break
		}
		if isRecommendedFormula(it.Formula) {
			continue
		}
		results = append(results, BrewSearchResult{
			Name:         it.Formula,
			Type:         "formula",
			Installed:    installedSet[it.Formula],
			Rank:         it.Rank,
			InstallCount: it.Count,
			Percent:      it.Percent,
		})
	}

	return results
}

// recommendedCachePath returns where the analytics payload is cached
// (~/Library/Application Support/brew-manager/recommended.json on macOS;
// BREW_MANAGER_CONFIG_DIR overrides the base dir in tests).
func recommendedCachePath() string {
	if dir := os.Getenv("BREW_MANAGER_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "brew-manager", "recommended.json")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.Getenv("HOME")
	}
	return filepath.Join(dir, "brew-manager", "recommended.json")
}

// loadRecommendedCache reads the cached analytics payload; a missing, corrupt
// or version-mismatched file yields nil (caller then treats it as "no cache").
func loadRecommendedCache() *recommendedCache {
	data, err := os.ReadFile(recommendedCachePath())
	if err != nil {
		return nil
	}
	var c recommendedCache
	if err := json.Unmarshal(data, &c); err != nil {
		return nil
	}
	if c.Version != recommendedCacheVersion {
		return nil
	}
	return &c
}

// saveRecommendedCache persists the analytics payload for the next visits.
func saveRecommendedCache(formulaItems, caskItems []analyticsItem) error {
	data, err := json.Marshal(recommendedCache{
		Version:   recommendedCacheVersion,
		FetchedAt: time.Now().Unix(),
		Formula:   formulaItems,
		Cask:      caskItems,
	})
	if err != nil {
		return err
	}
	path := recommendedCachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// fetchAnalytics downloads and parses one analytics endpoint. Mirror/UA notes:
// the endpoint answers fine with a plain Go client; curl UA is used for parity
// with the mirror speed tests and to avoid any UA-based throttling.
func fetchAnalytics(url string) ([]analyticsItem, error) {
	client := &http.Client{Timeout: recommendedFetchTimeout}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "curl/8.4.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("analytics 接口返回 HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseAnalyticsJSON(body)
}

// recommendedAnalytics returns the two analytics lists, preferring a fresh
// on-disk cache and falling back to a stale one (or a partial fetch) when the
// network is unavailable, so the search page keeps working offline. force
// bypasses the fresh-cache check (used by the UI refresh button).
func (s *Service) recommendedAnalytics(force bool) (formulaItems, caskItems []analyticsItem, err error) {
	if !force {
		if c := loadRecommendedCache(); c != nil && time.Since(time.Unix(c.FetchedAt, 0)) < recommendedCacheTTL {
			return c.Formula, c.Cask, nil
		}
	}

	var fErr, cErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		formulaItems, fErr = fetchAnalytics(formulaAnalyticsURL)
	}()
	go func() {
		defer wg.Done()
		caskItems, cErr = fetchAnalytics(caskAnalyticsURL)
	}()
	wg.Wait()

	if fErr == nil && cErr == nil {
		saveRecommendedCache(formulaItems, caskItems)
		return formulaItems, caskItems, nil
	}

	// 部分或全部拉取失败：退回已有缓存（即使已过期），保证离线可用。
	if c := loadRecommendedCache(); c != nil {
		return c.Formula, c.Cask, nil
	}

	// 两个接口都失败且无缓存，才把错误抛给前端。
	if fErr != nil && cErr != nil {
		return nil, nil, fmt.Errorf("获取热门软件失败：%v；%v", fErr, cErr)
	}
	return formulaItems, caskItems, nil
}

// GetRecommended returns a short list of popular packages from Homebrew's
// official 30-day install analytics, used by the search page to offer
// one-click installs before the user types anything. force bypasses the disk
// cache so the UI refresh button always pulls the latest ranking.
func (s *Service) GetRecommended(force bool) ([]BrewSearchResult, error) {
	formulaItems, caskItems, err := s.recommendedAnalytics(force)
	if err != nil {
		return nil, err
	}

	results := buildRecommendedResults(formulaItems, caskItems, s.installedSet())

	// 复用搜索结果的批量信息补充：版本与描述
	if len(results) > 0 {
		s.enrichSearchResults(results)
	}
	return results, nil
}

// Install installs a package, streaming live progress to the UI
func (s *Service) Install(name, pkgType string) error {
	args := []string{"install"}
	if pkgType == "cask" {
		args = append(args, "--cask")
	}
	args = append(args, name)
	_, err := s.runBrewStreaming("install:"+name, args...)
	if err != nil {
		return fmt.Errorf("failed to install %s: %w", name, err)
	}
	return nil
}

// Uninstall uninstalls a package, streaming live progress to the UI
func (s *Service) Uninstall(name, pkgType string) error {
	args := []string{"uninstall"}
	if pkgType == "cask" {
		args = append(args, "--cask")
	}
	args = append(args, name)
	_, err := s.runBrewStreaming("uninstall:"+name, args...)
	if err != nil {
		return fmt.Errorf("failed to uninstall %s: %w", name, err)
	}
	return nil
}

// Reinstall reinstalls a package, streaming live progress to the UI
func (s *Service) Reinstall(name, pkgType string) error {
	args := []string{"reinstall"}
	if pkgType == "cask" {
		args = append(args, "--cask")
	}
	args = append(args, name)
	_, err := s.runBrewStreaming("reinstall:"+name, args...)
	if err != nil {
		return fmt.Errorf("failed to reinstall %s: %w", name, err)
	}
	return nil
}

// Upgrade upgrades all packages (names empty) or specific ones, streaming
// live progress. It takes a plain slice (not variadic) because Wails v2's
// binding layer mishandles variadic parameters: a call such as
// Upgrade(["node"]) fails with "reflect: cannot use []string as type string"
// and the method is never invoked.
func (s *Service) Upgrade(names []string) error {
	debugLog("Upgrade called names=%v", names)
	args := []string{"upgrade", "--verbose"}
	op := "upgrade:all"
	if len(names) > 0 && names[0] != "" {
		op = "upgrade:" + names[0]
		args = append(args, names[0])
	}
	_, err := s.runBrewStreaming(op, args...)
	if err != nil {
		return fmt.Errorf("failed to upgrade: %w", err)
	}
	return nil
}

// GetOutdated returns all outdated packages
// outdatedJSON holds the fields we need from `brew outdated --json=v2`
type outdatedJSON struct {
	Formulae []struct {
		Name              string   `json:"name"`
		InstalledVersions []string `json:"installed_versions"`
		CurrentVersion    string   `json:"current_version"`
		Pinned            bool     `json:"pinned"`
	} `json:"formulae"`
	Casks []struct {
		Name              string   `json:"name"`
		InstalledVersions []string `json:"installed_versions"`
		CurrentVersion    string   `json:"current_version"`
		Pinned            bool     `json:"pinned"`
	} `json:"casks"`
}

func (s *Service) GetOutdated() ([]BrewPackage, error) {
	// Prefer JSON output: `brew outdated --json=v2` includes versions and types
	output, err := s.runBrew("outdated", "--json=v2")
	// If brew outdated fails (e.g., brew needs updating first), return empty list
	if err != nil {
		return []BrewPackage{}, nil
	}

	var data outdatedJSON
	if err := json.Unmarshal([]byte(output), &data); err == nil && (len(data.Formulae) > 0 || len(data.Casks) > 0) {
		packages := make([]BrewPackage, 0, len(data.Formulae)+len(data.Casks))
		for _, f := range data.Formulae {
			version := ""
			if len(f.InstalledVersions) > 0 {
				version = f.InstalledVersions[len(f.InstalledVersions)-1]
			}
			packages = append(packages, BrewPackage{
				Name:          f.Name,
				Version:       version,
				LatestVersion: f.CurrentVersion,
				Type:          "formula",
				Outdated:      true,
			})
		}
		for _, c := range data.Casks {
			version := ""
			if len(c.InstalledVersions) > 0 {
				version = c.InstalledVersions[len(c.InstalledVersions)-1]
			}
			packages = append(packages, BrewPackage{
				Name:          c.Name,
				Version:       version,
				LatestVersion: c.CurrentVersion,
				Type:          "cask",
				Outdated:      true,
			})
		}
		s.enrichDescriptions(packages)
		// Sort: casks first, then formulas (stable, keeps brew's order within each type)
		sort.SliceStable(packages, func(i, j int) bool {
			return packages[i].Type == "cask" && packages[j].Type != "cask"
		})
		return packages, nil
	}

	// Fallback: legacy text parsing for older brew versions ("name current latest" per line)
	legacyOut, _ := s.runBrew("outdated")
	caskList, _ := s.runBrew("list", "--cask")
	caskSet := make(map[string]bool)
	for _, caskLine := range strings.Split(strings.TrimSpace(caskList), "\n") {
		caskSet[strings.TrimSpace(caskLine)] = true
	}

	packages := make([]BrewPackage, 0)
	for _, line := range strings.Split(strings.TrimSpace(legacyOut), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) >= 1 {
			pkg := BrewPackage{
				Name:     parts[0],
				Outdated: true,
			}
			if len(parts) >= 3 {
				pkg.Version = parts[1]       // current version
				pkg.LatestVersion = parts[2] // latest version
			}

			if caskSet[parts[0]] {
				pkg.Type = "cask"
			} else {
				pkg.Type = "formula"
			}

			packages = append(packages, pkg)
		}
	}

	// Sort: casks first, then formulas
	sort.SliceStable(packages, func(i, j int) bool {
		return packages[i].Type == "cask" && packages[j].Type != "cask"
	})
	s.enrichDescriptions(packages)

	return packages, nil
}

// enrichDescriptions fills in package descriptions from the installed info map
func (s *Service) enrichDescriptions(packages []BrewPackage) {
	descMap := s.getInstalledDescriptions()
	for i := range packages {
		if packages[i].Description == "" {
			packages[i].Description = descMap[packages[i].Name]
		}
	}
}

// Cleanup removes old versions and cached downloads, streaming live progress
func (s *Service) Cleanup() error {
	_, err := s.runBrewStreaming("cleanup", "cleanup", "--prune=all")
	if err != nil {
		return fmt.Errorf("failed to cleanup: %w", err)
	}
	return nil
}

// TrustInfo describes which taps are trusted via `brew trust` (Homebrew 6+).
// Supported is false on older Homebrew versions without the trust command.
type TrustInfo struct {
	Supported bool     `json:"supported"`
	Taps      []string `json:"taps"`
}

// trustJSON mirrors `brew trust --json v1`
type trustJSON struct {
	Taps     []string `json:"taps"`
	Formulae []string `json:"formulae"`
	Casks    []string `json:"casks"`
	Commands []string `json:"commands"`
}

// GetTrustInfo returns the taps currently trusted by `brew trust`.
func (s *Service) GetTrustInfo() (*TrustInfo, error) {
	info := &TrustInfo{Supported: false, Taps: []string{}}
	output, err := s.runBrew("trust", "--json", "v1")
	if err != nil {
		// Homebrew < 6 has no trust command; every tap is loadable by default
		return info, nil
	}
	info.Supported = true
	var data trustJSON
	if err := json.Unmarshal([]byte(output), &data); err != nil {
		return nil, fmt.Errorf("failed to parse brew trust output: %w", err)
	}
	info.Taps = data.Taps
	return info, nil
}

// TrustTap marks a tap as trusted so Homebrew 6+ will load its packages
func (s *Service) TrustTap(tap string) error {
	if _, err := s.runBrew("trust", "--tap", tap); err != nil {
		return fmt.Errorf("failed to trust tap %s: %w", tap, err)
	}
	return nil
}

// UntrustTap revokes trust for a tap
func (s *Service) UntrustTap(tap string) error {
	if _, err := s.runBrew("untrust", "--tap", tap); err != nil {
		return fmt.Errorf("failed to untrust tap %s: %w", tap, err)
	}
	return nil
}

// GetTaps returns all configured taps
func (s *Service) GetTaps() ([]string, error) {
	output, err := s.runBrew("tap")
	if err != nil {
		return nil, fmt.Errorf("failed to get taps: %w", err)
	}

	taps := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}
		taps = append(taps, line)
	}
	return taps, nil
}

// findUnusedTaps 从 brew tap 输出与已安装包完整名称中筛出「未使用」的仓库：
// 没有任何已安装的 formula/cask 属于该仓库。
// 已安装包完整名称形如 <owner>/<repo>/<name>（第三方仓库）或纯包名
// （homebrew/core、homebrew/cask 的包），据此反推每个仓库是否被使用。
// 内置仓库永不视为未使用。返回结果按名称排序。
func findUnusedTaps(tapOutput string, installedNames []string) []string {
	// 已使用仓库集合：完整名称前两段即所属仓库（如 hashicorp/tap/consul → hashicorp/tap）
	used := make(map[string]bool)
	for _, name := range installedNames {
		parts := strings.Split(name, "/")
		if len(parts) >= 3 {
			used[parts[0]+"/"+parts[1]] = true
		}
	}

	// 内置仓库永不视为未使用
	builtin := map[string]bool{
		"homebrew/core": true,
		"homebrew/cask": true,
	}

	unused := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(tapOutput), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}
		tap := strings.Fields(line)[0]
		if builtin[tap] || used[tap] {
			continue
		}
		unused = append(unused, tap)
	}
	sort.Strings(unused)
	return unused
}

// CheckUnusedTaps 返回没有安装任何来自该仓库的包（formula/cask）的仓库列表，
// 即「未使用的仓库」，可放心移除。
func (s *Service) CheckUnusedTaps() ([]string, error) {
	tapOutput, err := s.runBrew("tap")
	if err != nil {
		return nil, fmt.Errorf("failed to get taps: %w", err)
	}

	// 收集已安装的 formula 与 cask 完整名称；单个 list 失败不影响整体结果
	installed := make([]string, 0)
	for _, args := range [][]string{
		{"list", "--full-name"},
		{"list", "--cask", "--full-name"},
	} {
		out, err := s.runBrew(args...)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			line = strings.TrimSpace(line)
			if isBrewNoiseLine(line) {
				continue
			}
			installed = append(installed, line)
		}
	}

	return findUnusedTaps(tapOutput, installed), nil
}

// GetDiskUsage returns disk usage info for brew directories.
// The six `du` runs are parallelized (each can take 1-3s on a large Cellar) so
// the total wait is bounded by the slowest directory instead of the sum.
func (s *Service) GetDiskUsage() (map[string]string, error) {
	dirs := []struct {
		label string
		path  string
	}{
		{"Cellar (Intel)", "/usr/local/Cellar"},
		{"Caskroom (Intel)", "/usr/local/Caskroom"},
		{"Cache (Intel)", "/usr/local/Caches/Homebrew"},
		{"Cellar", "/opt/homebrew/Cellar"},
		{"Caskroom", "/opt/homebrew/Caskroom"},
		{"Cache", "/opt/homebrew/Caches/Homebrew"},
	}

	result := make(map[string]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, d := range dirs {
		wg.Add(1)
		go func(label, path string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			output, err := exec.CommandContext(ctx, "du", "-sh", path).Output()
			if err != nil {
				return
			}
			parts := strings.Fields(string(output))
			if len(parts) == 0 {
				return
			}
			mu.Lock()
			result[label] = parts[0]
			mu.Unlock()
		}(d.label, d.path)
	}
	wg.Wait()
	return result, nil
}

// ExportConfig exports the list of installed packages to a file
// It opens a native save dialog and writes the config to the chosen path,
// returning the saved path (empty string when the user cancels).
func (s *Service) ExportConfig() (string, error) {
	if s.ctx == nil {
		return "", fmt.Errorf("runtime context not ready")
	}

	caskOutput, _ := s.runBrew("list", "--cask")
	formulaOutput, _ := s.runBrew("list")

	content := fmt.Sprintf("# Brew Manager Export\n\n## Casks\n%s\n\n## Formulas\n%s",
		strings.TrimSpace(caskOutput),
		strings.TrimSpace(formulaOutput))

	defaultName := fmt.Sprintf("brew-config-%s.txt", time.Now().Format("2006-01-02"))
	path, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{
		Title:           "导出 Brew 配置",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Text Files (*.txt)", Pattern: "*.txt"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("failed to open save dialog: %w", err)
	}
	if path == "" {
		// User cancelled the dialog
		return "", nil
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("failed to write config: %w", err)
	}
	return path, nil
}

// ImportResult describes the outcome of restoring a config backup
// (which packages were installed successfully and which failed).
type ImportResult struct {
	Path      string          `json:"path"`
	Cancelled bool            `json:"cancelled"`
	Total     int             `json:"total"`
	Installed []string        `json:"installed"`
	Failed    []ImportFailure `json:"failed"`
}

// ImportFailure records a single package that could not be installed
// during an import.
type ImportFailure struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

// ImportConfig opens a native file dialog, reads a previously exported backup
// and reinstalls every package listed in it (casks and formulas).
// Returns ImportResult{Cancelled: true} when the user cancels the dialog.
func (s *Service) ImportConfig() (*ImportResult, error) {
	if s.ctx == nil {
		return nil, fmt.Errorf("runtime context not ready")
	}

	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择 Brew 配置备份文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Text Files (*.txt)", Pattern: "*.txt"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to open file dialog: %w", err)
	}
	if path == "" {
		// User cancelled the dialog
		return &ImportResult{Cancelled: true}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	casks, formulas := parseConfigBackup(string(data))
	result := &ImportResult{
		Path:      path,
		Total:     len(casks) + len(formulas),
		Installed: make([]string, 0),
		Failed:    make([]ImportFailure, 0),
	}

	installOne := func(name, pkgType string) {
		args := []string{"install"}
		if pkgType == "cask" {
			args = append(args, "--cask")
		}
		args = append(args, name)
		phase := fmt.Sprintf("正在安装 %s（%d/%d）", name, len(result.Installed)+len(result.Failed)+1, result.Total)
		if _, err := s.runBrewStreamingPhase("import", phase, args...); err != nil {
			result.Failed = append(result.Failed, ImportFailure{Name: name, Error: err.Error()})
			return
		}
		result.Installed = append(result.Installed, name)
	}

	// Formulas first (usually faster), then casks
	for _, name := range formulas {
		installOne(name, "formula")
	}
	for _, name := range casks {
		installOne(name, "cask")
	}

	return result, nil
}

// parseConfigBackup extracts cask and formula names from an exported backup.
// Supported formats:
//
//	# Brew Manager Export
//	## Casks
//	<names>
//	## Formulas
//	<names>
//
// as well as raw "brew list" output (space/newline separated names, treated
// as formulas by default). Comment lines (#, ==>) and empty lines are ignored.
func parseConfigBackup(content string) (casks, formulas []string) {
	section := "formula" // default: plain brew list output contains formulas
	seen := make(map[string]bool)
	add := func(list *[]string, token string) {
		if seen[token] {
			return
		}
		seen[token] = true
		*list = append(*list, token)
	}

	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "## casks") {
			section = "cask"
			continue
		}
		if strings.HasPrefix(lower, "## formulas") {
			section = "formula"
			continue
		}
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "==>") {
			continue
		}
		for _, token := range strings.Fields(line) {
			if section == "cask" {
				add(&casks, token)
			} else {
				add(&formulas, token)
			}
		}
	}
	return casks, formulas
}

// Autoremove removes orphaned dependencies, streaming live progress
func (s *Service) Autoremove() error {
	_, err := s.runBrewStreaming("autoremove", "autoremove")
	if err != nil {
		return fmt.Errorf("failed to autoremove: %w", err)
	}
	return nil
}

// AddTap adds a new tap
func (s *Service) AddTap(tap string) error {
	_, err := s.runBrew("tap", tap)
	if err != nil {
		return fmt.Errorf("failed to add tap %s: %w", tap, err)
	}
	return nil
}

// RemoveTap removes a tap, streaming live progress
func (s *Service) RemoveTap(tap string) error {
	_, err := s.runBrewStreaming("untap:"+tap, "untap", tap)
	if err != nil {
		return fmt.Errorf("failed to remove tap %s: %w", tap, err)
	}
	return nil
}

// RemoveTapsResult 报告批量移除仓库的结果（一键清理未使用仓库）。
// Removed 为成功移除数，Failed 为失败数。
type RemoveTapsResult struct {
	Removed int `json:"removed"`
	Failed  int `json:"failed"`
}

// RemoveTaps 批量移除多个仓库，逐个串行 untap，某个仓库失败不中断其余；
// 每步通过 untap-batch 进度流反馈到前端。
func (s *Service) RemoveTaps(taps []string) (RemoveTapsResult, error) {
	result := RemoveTapsResult{}
	op := "untap-batch"
	for i, tap := range taps {
		s.emitBrewEvent(op, brewEventLine, fmt.Sprintf("▶ 正在移除 %s（%d/%d）...", tap, i+1, len(taps)), false, "")
		if _, err := s.runBrew("untap", tap); err != nil {
			result.Failed++
			s.emitBrewEvent(op, brewEventLine, fmt.Sprintf("✗ %s 移除失败：%v", tap, err), false, "")
			continue
		}
		result.Removed++
		s.emitBrewEvent(op, brewEventLine, fmt.Sprintf("✓ %s 已移除", tap), false, "")
	}
	if result.Removed == 0 && result.Failed > 0 {
		return result, fmt.Errorf("全部 %d 个仓库移除失败", result.Failed)
	}
	return result, nil
}

// UpdateWithOutput runs brew update and streams its output live, so the UI
// can show fetch progress instead of waiting for the whole command to finish.
func (s *Service) UpdateWithOutput() (string, error) {
	output, err := s.runBrewStreaming("update", "update")
	if err != nil {
		// Keep the partial output so the modal can show why it failed
		return output, err
	}
	return output, nil
}

// Doctor runs brew doctor and streams its output live
func (s *Service) Doctor() (string, error) {
	output, err := s.runBrewStreaming("doctor", "doctor")
	if err != nil {
		return output, nil // doctor returns non-zero on warnings
	}
	return output, nil
}

// GetLeaves returns top-level (non-dependency) packages
func (s *Service) GetLeaves() ([]string, error) {
	output, err := s.runBrew("leaves")
	if err != nil {
		return nil, fmt.Errorf("failed to get leaves: %w", err)
	}
	var leaves []string
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}
		leaves = append(leaves, line)
	}
	return leaves, nil
}

// isBrewNoiseLine reports whether a line from brew CLI output should be
// ignored when parsing text results (warnings, errors, section markers).
// brew writes such lines to stderr, which runBrew merges into stdout via
// CombinedOutput, so they would otherwise pollute parsed results.
func isBrewNoiseLine(line string) bool {
	lower := strings.ToLower(strings.TrimSpace(line))
	return lower == "" ||
		strings.HasPrefix(lower, "warning:") ||
		strings.HasPrefix(lower, "error:") ||
		strings.HasPrefix(lower, "note:") ||
		strings.HasPrefix(lower, "==>")
}

// GetUses returns packages that depend on the given package
func (s *Service) GetUses(name string) ([]string, error) {
	output, err := s.runBrewRetryUntrusted("uses", "--installed", name)
	if err != nil {
		return []string{}, nil
	}
	var uses []string
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}
		uses = append(uses, line)
	}
	return uses, nil
}

// Pin pins a package to prevent upgrades
func (s *Service) Pin(name string) error {
	_, err := s.runBrew("pin", name)
	if err != nil {
		return fmt.Errorf("failed to pin %s: %w", name, err)
	}
	return nil
}

// Unpin unpins a package
func (s *Service) Unpin(name string) error {
	_, err := s.runBrew("unpin", name)
	if err != nil {
		return fmt.Errorf("failed to unpin %s: %w", name, err)
	}
	return nil
}

// GetVulns returns known vulnerabilities
func (s *Service) GetVulns() (string, error) {
	output, err := s.runBrew("vulns")
	if err != nil {
		return output, nil
	}
	return output, nil
}

// classifyOutdated parses `brew outdated` text output ("name current latest"
// per line) into packages, classifying each as cask/formula via caskSet.
// Lines with fewer than three fields and brew noise lines are skipped.
func classifyOutdated(output string, caskSet map[string]bool) []BrewPackage {
	packages := make([]BrewPackage, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if isBrewNoiseLine(line) {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		pkg := BrewPackage{
			Name:     parts[0],
			Version:  parts[1], // current version
			Outdated: true,
			Type:     "formula",
		}
		if caskSet[parts[0]] {
			pkg.Type = "cask"
		}
		packages = append(packages, pkg)
	}
	return packages
}

// ===== brew services =====

// serviceListJSONRow mirrors one entry of `brew services list --json`.
// exit_code / pid may be null or a number, so they are kept as raw values
// and normalized to strings for display.
type serviceListJSONRow struct {
	Name     string      `json:"name"`
	Status   string      `json:"status"`
	User     string      `json:"user"`
	File     string      `json:"file"`
	ExitCode interface{} `json:"exit_code"`
	Pid      interface{} `json:"pid"`
}

// ListServices returns all services known to `brew services list`
func (s *Service) ListServices() ([]BrewService, error) {
	// Primary: JSON output (includes status, user, plist path, pid, exit code)
	output, err := s.runBrew("services", "list", "--json")
	if err == nil {
		var raw []serviceListJSONRow
		if jsonErr := json.Unmarshal([]byte(output), &raw); jsonErr == nil {
			services := make([]BrewService, 0, len(raw))
			for _, r := range raw {
				services = append(services, BrewService{
					Name:     r.Name,
					Status:   r.Status,
					User:     r.User,
					File:     r.File,
					ExitCode: formatServiceField(r.ExitCode),
					Pid:      formatServiceField(r.Pid),
				})
			}
			return services, nil
		}
	}

	// Fallback: parse the legacy text table (older brew without --json)
	textOut, textErr := s.runBrew("services", "list")
	if textErr != nil {
		return nil, fmt.Errorf("failed to list services: %w", textErr)
	}
	return s.parseServicesTable(textOut)
}

// parseServicesTable parses the legacy `brew services list` text output:
//
//	Name    Status  User   File
//	mysql   started bob    ~/Library/LaunchAgents/homebrew.mxcl.mysql.plist
//	nginx   none
func (s *Service) parseServicesTable(output string) ([]BrewService, error) {
	services := make([]BrewService, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || isBrewNoiseLine(line) {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		// Skip the header row
		if fields[0] == "Name" {
			continue
		}

		svc := BrewService{Name: fields[0]}
		if len(fields) > 1 {
			svc.Status = fields[1]
		}
		if len(fields) > 2 {
			// The User column may be empty; a value starting with '/' or '~'
			// is the File path, not a username.
			if !strings.HasPrefix(fields[2], "/") && !strings.HasPrefix(fields[2], "~") {
				svc.User = fields[2]
				if len(fields) > 3 {
					svc.File = strings.Join(fields[3:], " ")
				}
			} else {
				svc.File = strings.Join(fields[2:], " ")
			}
		}
		services = append(services, svc)
	}
	return services, nil
}

// formatServiceField renders a possibly-null numeric JSON field (exit_code / pid)
// as a plain string for display.
func formatServiceField(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", t)
	}
}

// StartService starts a service and registers it to launch at login
func (s *Service) StartService(name string) error {
	_, err := s.runBrew("services", "start", name)
	if err != nil {
		return fmt.Errorf("failed to start service %s: %w", name, err)
	}
	return nil
}

// StopService stops a service and unregisters it from login startup
func (s *Service) StopService(name string) error {
	_, err := s.runBrew("services", "stop", name)
	if err != nil {
		return fmt.Errorf("failed to stop service %s: %w", name, err)
	}
	return nil
}

// RestartService restarts a service (starts it if it is not running)
func (s *Service) RestartService(name string) error {
	_, err := s.runBrew("services", "restart", name)
	if err != nil {
		return fmt.Errorf("failed to restart service %s: %w", name, err)
	}
	return nil
}

// RunService runs a service in the foreground without registering it at login
func (s *Service) RunService(name string) error {
	_, err := s.runBrew("services", "run", name)
	if err != nil {
		return fmt.Errorf("failed to run service %s: %w", name, err)
	}
	return nil
}

// KillService kills a service without unregistering it from login startup
func (s *Service) KillService(name string) error {
	_, err := s.runBrew("services", "kill", name)
	if err != nil {
		return fmt.Errorf("failed to kill service %s: %w", name, err)
	}
	return nil
}
