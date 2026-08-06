package main

import (
	"bufio"
	"os/exec"
	"strings"
	"testing"
)

// TestSplitBrewOutput verifies the streaming tokenizer handles normal lines,
// \r\n endings and bare-\r progress bars correctly.
func TestSplitBrewOutput(t *testing.T) {
	input := "==> Downloading https://example.com/file.dmg\rDownloading... 42%\rDownloading... 100%\n==> Installing foo\r\n"
	sc := bufio.NewScanner(strings.NewReader(input))
	sc.Split(splitBrewOutput)

	var tokens []string
	for sc.Scan() {
		tokens = append(tokens, sc.Text())
	}

	want := []string{
		"==> Downloading https://example.com/file.dmg\r",
		"Downloading... 42%\r",
		"Downloading... 100%\n",
		"==> Installing foo\r\n",
	}
	if len(tokens) != len(want) {
		t.Fatalf("got %d tokens %q, want %d %q", len(tokens), tokens, len(want), want)
	}
	for i := range want {
		if tokens[i] != want[i] {
			t.Errorf("token %d = %q, want %q", i, tokens[i], want[i])
		}
	}
}

// TestStreamCommandPty verifies streamCommand runs brew through a pty and
// captures its output (regression test for the pty-based streaming).
func TestStreamCommandPty(t *testing.T) {
	if _, err := exec.LookPath("brew"); err != nil {
		t.Skip("brew not installed")
	}
	s := &Service{}
	out, err := s.streamCommand("test:version", "--version")
	if err != nil {
		t.Fatalf("streamCommand failed: %v", err)
	}
	if !strings.Contains(out, "Homebrew") {
		t.Fatalf("expected Homebrew version output, got %q", out)
	}
}

// TestAnsiEscapeRe verifies the pty output is cleaned of the ANSI escape
// sequences brew emits when it detects a terminal.
func TestAnsiEscapeRe(t *testing.T) {
	cases := []struct{ in, want string }{
		{"\x1b[32mhello\x1b[0m", "hello"},
		{"\x1b[2K\rDownloading...", "\rDownloading..."},
		{"\x1b[?25lfoo\x1b[?25h", "foo"},
		{"\x1b]0;title\x07bar", "bar"},
		{"\x1b(0abc\x1b(B", "abc"},
	}
	for _, c := range cases {
		if got := ansiEscapeRe.ReplaceAllString(c.in, ""); got != c.want {
			t.Errorf("ansi(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestSplitBrewOutputNoTrailingDelimiter ensures a final chunk without a
// trailing newline is still emitted (and classified as a line, not refresh).
func TestSplitBrewOutputNoTrailingDelimiter(t *testing.T) {
	sc := bufio.NewScanner(strings.NewReader("==> Pouring foo"))
	sc.Split(splitBrewOutput)

	var tokens []string
	for sc.Scan() {
		tokens = append(tokens, sc.Text())
	}
	if len(tokens) != 1 || tokens[0] != "==> Pouring foo" {
		t.Fatalf("got %q, want [\"==> Pouring foo\"]", tokens)
	}
}
