package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newTestMirrorServer serves a fake API index at /api/formula.jws.json.
func newTestMirrorServer(t *testing.T, payload int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/formula.jws.json" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(make([]byte, payload))
	}))
}

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

// TestSpeedTestURL verifies the benchmark target derivation for mirrors and
// the official source.
func TestSpeedTestURL(t *testing.T) {
	src := MirrorSource{Env: map[string]string{
		"HOMEBREW_API_DOMAIN": "https://mirrors.example.com/homebrew-bottles/api/",
	}}
	if got := speedTestURL(src); got != "https://mirrors.example.com/homebrew-bottles/api/formula.jws.json" {
		t.Errorf("mirror url = %q", got)
	}
	if got := speedTestURL(MirrorSource{Env: map[string]string{}}); got != "https://formulae.brew.sh/api/formula.jws.json" {
		t.Errorf("official url = %q", got)
	}
}

// TestTestMirrorSpeed exercises the speed measurement against a local server
// (no external network): latency, throughput and byte accounting, plus the
// unreachable-host error path.
func TestTestMirrorSpeed(t *testing.T) {
	const payload = 1 << 20 // 1 MiB
	ts := newTestMirrorServer(t, payload)
	defer ts.Close()

	res := testMirrorSpeed(MirrorSource{
		ID:   "test",
		Name: "Test",
		Env:  map[string]string{"HOMEBREW_API_DOMAIN": ts.URL + "/api"},
	})
	if !res.Success {
		t.Fatalf("speed test failed: %v", res.Error)
	}
	if res.URL != ts.URL+"/api/formula.jws.json" {
		t.Errorf("url = %q", res.URL)
	}
	if res.SpeedKBps <= 0 {
		t.Errorf("speed = %v, want > 0", res.SpeedKBps)
	}
	if res.LatencyMs < 0 {
		t.Errorf("latency = %v, want >= 0", res.LatencyMs)
	}
	if want := float64(payload) / 1024; res.DownloadedKB != want {
		t.Errorf("downloaded = %v, want %v", res.DownloadedKB, want)
	}

	// Unreachable mirror must report an error, not success.
	bad := testMirrorSpeed(MirrorSource{
		ID: "bad", Name: "Bad",
		Env: map[string]string{"HOMEBREW_API_DOMAIN": "http://127.0.0.1:1"},
	})
	if bad.Success {
		t.Error("unreachable mirror reported success")
	}
	if bad.Error == "" {
		t.Error("expected an error message")
	}
}

// TestTestMirrorSpeedsParallel verifies sources are measured concurrently and
// results are returned in input order — against local servers only, so the
// unit tests never depend on external network.
func TestTestMirrorSpeedsParallel(t *testing.T) {
	const payload = 512 << 10 // 512 KiB
	s1 := newTestMirrorServer(t, payload)
	defer s1.Close()
	s2 := newTestMirrorServer(t, payload)
	defer s2.Close()

	sources := []MirrorSource{
		{ID: "a", Name: "A", Env: map[string]string{"HOMEBREW_API_DOMAIN": s1.URL + "/api"}},
		{ID: "b", Name: "B", Env: map[string]string{"HOMEBREW_API_DOMAIN": s2.URL + "/api"}},
		{ID: "c", Name: "C", Env: map[string]string{"HOMEBREW_API_DOMAIN": "http://127.0.0.1:1"}},
	}

	results := testMirrorSpeeds(sources)
	if len(results) != len(sources) {
		t.Fatalf("got %d results, want %d", len(results), len(sources))
	}
	for i, r := range results {
		if r.ID != sources[i].ID {
			t.Errorf("result %d = %q, want %q (order must match input)", i, r.ID, sources[i].ID)
		}
	}
	if !results[0].Success || !results[1].Success {
		t.Error("local mirrors should succeed")
	}
	if results[2].Success {
		t.Error("unreachable mirror should fail")
	}
}
