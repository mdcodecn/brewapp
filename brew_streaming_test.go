package main

import (
	"bufio"
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
