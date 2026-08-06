package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFilterMirrorLines(t *testing.T) {
	input := `# sample zshrc
export PATH="/usr/local/bin:$PATH"

# ------ chsrc BLOCK BEGIN for Homebrew ------
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn//git/homebrew/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn//git/homebrew/homebrew-core.git"
# For Bottles
export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn//homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn//homebrew-bottles"
# ------ chsrc BLOCK ENDIN for Homebrew ------# ------ chsrc BLOCK BEGIN for Homebrew ------
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.bfsu.edu.cn//git/homebrew/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.bfsu.edu.cn//git/homebrew/homebrew-core.git"
export HOMEBREW_API_DOMAIN="https://mirrors.bfsu.edu.cn//homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.bfsu.edu.cn//homebrew-bottles"
# ------ chsrc BLOCK ENDIN for Homebrew ------

unset HOMEBREW_BOTTLE_DOMAIN
HOMEBREW_API_DOMAIN="https://example.com/api"

alias ll='ls -la'
eval "$(starship init zsh)"
`
	got := filterMirrorLines(input)

	// All mirror variable lines and markers must be gone.
	if strings.Contains(got, "HOMEBREW_") {
		t.Errorf("output still contains HOMEBREW_ lines:\n%s", got)
	}
	if strings.Contains(got, "BLOCK") {
		t.Errorf("output still contains chsrc block markers:\n%s", got)
	}
	if strings.Contains(got, "# For Bottles") {
		t.Errorf("output still contains '# For Bottles' comment:\n%s", got)
	}

	// Unrelated lines must be preserved.
	for _, want := range []string{"export PATH=\"", "alias ll='ls -la'", "eval \"$(starship init zsh)\""} {
		if !strings.Contains(got, want) {
			t.Errorf("output missing preserved line %q:\n%s", want, got)
		}
	}
}

func TestParseMirrorEnv(t *testing.T) {
	content := `
export PATH="/usr/bin:$PATH"
export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN='https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles'
HOMEBREW_BREW_GIT_REMOTE=https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git
export HOMEBREW_API_DOMAIN="https://mirrors.bfsu.edu.cn/homebrew-bottles/api"
`
	env := parseMirrorEnv(content)
	if env["HOMEBREW_API_DOMAIN"] != "https://mirrors.bfsu.edu.cn/homebrew-bottles/api" {
		t.Errorf("API_DOMAIN = %q, want last (bfsu) value", env["HOMEBREW_API_DOMAIN"])
	}
	if env["HOMEBREW_BOTTLE_DOMAIN"] != "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles" {
		t.Errorf("BOTTLE_DOMAIN = %q, want tuna value (single quotes stripped)", env["HOMEBREW_BOTTLE_DOMAIN"])
	}
	if env["HOMEBREW_BREW_GIT_REMOTE"] != "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git" {
		t.Errorf("BREW_GIT_REMOTE = %q, want unquoted value", env["HOMEBREW_BREW_GIT_REMOTE"])
	}
}

func TestCurrentMirrorID(t *testing.T) {
	sources := predefinedMirrorSources()
	cases := []struct {
		name    string
		content string
		envVar  string
		want    string
	}{
		{"no config anywhere", "", "", "official"},
		{"tuna in profile", `export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"`, "", "tuna"},
		{"bfsu in profile", `export HOMEBREW_API_DOMAIN="https://mirrors.bfsu.edu.cn/homebrew-bottles/api"`, "", "bfsu"},
		{"double slash tuna (chsrc style)", `export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn//homebrew-bottles/api"`, "", "tuna"},
		{"unknown source", `export HOMEBREW_API_DOMAIN="https://custom.example.com/api"`, "", "custom"},
		{"env fallback", "", "https://mirrors.aliyun.com/homebrew-bottles/api", "aliyun"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, ".zshrc")
			if c.content != "" {
				if err := os.WriteFile(path, []byte(c.content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			// Redirect HOME so shellConfigPath() points at the temp dir.
			t.Setenv("HOME", dir)
			t.Setenv("SHELL", "/bin/zsh")
			os.Unsetenv("HOMEBREW_API_DOMAIN")
			if c.envVar != "" {
				t.Setenv("HOMEBREW_API_DOMAIN", c.envVar)
			}
			if got := currentMirrorID(sources); got != c.want {
				t.Errorf("currentMirrorID = %q, want %q", got, c.want)
			}
		})
	}
}

func TestWriteShellMirrorEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".zshrc")
	original := "export PATH=\"/usr/bin:$PATH\"\n# keep me\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}

	// Switch to TUNA.
	env := predefinedMirrorSources()[1].Env
	if err := writeShellMirrorEnv(path, env); err != nil {
		t.Fatalf("writeShellMirrorEnv(tuna) failed: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	out := string(got)
	for key, val := range env {
		if !strings.Contains(out, key+"=\""+val+"\"") {
			t.Errorf("output missing %s=%s:\n%s", key, val, out)
		}
	}
	if !strings.Contains(out, "export PATH=\"/usr/bin:$PATH\"") {
		t.Errorf("original unrelated line lost:\n%s", out)
	}
	if !strings.Contains(out, "# keep me") {
		t.Errorf("comment line lost:\n%s", out)
	}

	// Back to official: the block must be removed entirely.
	if err := writeShellMirrorEnv(path, map[string]string{}); err != nil {
		t.Fatalf("writeShellMirrorEnv(official) failed: %v", err)
	}
	got, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got), "HOMEBREW_") {
		t.Errorf("official switch did not remove mirror variables:\n%s", got)
	}
	if !strings.Contains(string(got), "export PATH=\"/usr/bin:$PATH\"") {
		t.Errorf("unrelated line lost after official switch:\n%s", got)
	}

	// Backup file must exist.
	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Errorf("backup %s.bak missing: %v", path, err)
	}
}

// TestMirrorServiceFlow simulates the GUI flow: GetMirrorSources ->
// SetMirrorSource -> GetMirrorSources, using a temp HOME so the real
// ~/.zshrc is never touched.
func TestMirrorServiceFlow(t *testing.T) {
	dir := t.TempDir()
	zshrc := filepath.Join(dir, ".zshrc")
	// Simulate a chsrc-written profile (double slashes) plus unrelated lines.
	original := "export PATH=\"/usr/local/bin:$PATH\"\n"
	original += "# ------ chsrc BLOCK BEGIN for Homebrew ------\n"
	original += "export HOMEBREW_API_DOMAIN=\"https://mirrors.bfsu.edu.cn//homebrew-bottles/api\"\n"
	original += "export HOMEBREW_BOTTLE_DOMAIN=\"https://mirrors.bfsu.edu.cn//homebrew-bottles\"\n"
	original += "# ------ chsrc BLOCK ENDIN for Homebrew ------\n"
	if err := os.WriteFile(zshrc, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Setenv("HOME", dir)
	t.Setenv("SHELL", "/bin/zsh")
	for _, k := range mirrorEnvKeys {
		os.Unsetenv(k)
	}

	s := &Service{}
	// Current source should be detected as BFSU despite double slashes.
	res, err := s.GetMirrorSources()
	if err != nil {
		t.Fatalf("GetMirrorSources failed: %v", err)
	}
	if res.Current != "bfsu" {
		t.Fatalf("current = %q, want bfsu", res.Current)
	}

	// Switch to TUNA.
	if err := s.SetMirrorSource("tuna"); err != nil {
		t.Fatalf("SetMirrorSource(tuna) failed: %v", err)
	}
	res, err = s.GetMirrorSources()
	if err != nil {
		t.Fatalf("GetMirrorSources after switch failed: %v", err)
	}
	if res.Current != "tuna" {
		t.Fatalf("current after switch = %q, want tuna", res.Current)
	}
	// Process env must be updated immediately.
	if got := os.Getenv("HOMEBREW_API_DOMAIN"); got != "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api" {
		t.Errorf("HOMEBREW_API_DOMAIN = %q, want tuna value", got)
	}

	// Profile must keep unrelated lines and drop old chsrc config.
	content, _ := os.ReadFile(zshrc)
	if !strings.Contains(string(content), "export PATH=\"/usr/local/bin:$PATH\"") {
		t.Errorf("unrelated PATH line lost:\n%s", content)
	}
	if strings.Contains(string(content), "bfsu") || strings.Contains(string(content), "chsrc") {
		t.Errorf("old chsrc/bfsu config not cleaned:\n%s", content)
	}

	// Unknown id must error.
	if err := s.SetMirrorSource("nope"); err == nil {
		t.Error("SetMirrorSource(nope) should fail")
	}

	// Switch back to official -> block removed, env cleared.
	if err := s.SetMirrorSource("official"); err != nil {
		t.Fatalf("SetMirrorSource(official) failed: %v", err)
	}
	res, _ = s.GetMirrorSources()
	if res.Current != "official" {
		t.Errorf("current after official = %q, want official", res.Current)
	}
	if got := os.Getenv("HOMEBREW_API_DOMAIN"); got != "" {
		t.Errorf("HOMEBREW_API_DOMAIN after official = %q, want empty", got)
	}
}
