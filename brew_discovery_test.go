package main

import (
	"os"
	"sync"
	"testing"
)

// TestResolveBrewPathInGUILikeEnv simulates a packaged app launched from
// Finder/Dock: the process only inherits a minimal PATH with no brew, and
// SHELL is set. Discovery must still find the user's brew installation.
func TestResolveBrewPathInGUILikeEnv(t *testing.T) {
	os.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	os.Setenv("SHELL", "/bin/zsh")

	brewPathOnce = sync.Once{}
	brewPath = ""

	p := resolveBrewPath()
	t.Logf("resolved brew path: %q", p)
	if p == "" || p == "brew" {
		t.Fatalf("expected a real brew path, got %q", p)
	}
	if !isExecutableFile(p) {
		t.Fatalf("resolved path %q is not executable", p)
	}
}

// TestBrewFromLoginShell verifies the shell-based discovery works even when
// nothing is on PATH, because a login shell loads the user's real environment.
func TestBrewFromLoginShell(t *testing.T) {
	os.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")

	p := brewFromLoginShell("/bin/zsh")
	t.Logf("login shell found: %q", p)
	if !isExecutableFile(p) {
		t.Fatalf("login shell could not locate brew, got %q", p)
	}
}

// TestBrewFromRCFiles verifies discovery when PATH is only defined inside
// interactive rc files (~/.zshrc / ~/.bashrc).
func TestBrewFromRCFiles(t *testing.T) {
	os.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")

	p := brewFromRCFiles("/bin/zsh")
	t.Logf("rc files found: %q", p)
	if p != "" && !isExecutableFile(p) {
		t.Fatalf("rc files resolved to non-executable %q", p)
	}
}
