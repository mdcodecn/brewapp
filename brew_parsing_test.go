package main

import (
	"reflect"
	"testing"
)

// TestMergeDependencies verifies the flat (new schema) and grouped (old
// schema) dependency arrays are merged into one de-duplicated list while
// preserving order — the shared logic behind GetPackageDetail.
func TestMergeDependencies(t *testing.T) {
	cases := []struct {
		name string
		in   formulaV2Info
		want []string
	}{
		{
			name: "flat schema only",
			in: formulaV2Info{
				Dependencies:      []string{"a", "b"},
				BuildDependencies: []string{"c"},
			},
			want: []string{"a", "b", "c"},
		},
		{
			name: "old grouped schema only",
			in: formulaV2Info{
				DependsOn: struct {
					Build       []string `json:"build"`
					Optional    []string `json:"optional"`
					Recommended []string `json:"recommended"`
					Test        []string `json:"test"`
					Required    []string `json:"required"`
				}{Required: []string{"x", "y"}, Build: []string{"z"}},
			},
			// mergeDependencies appends Build/Optional/Recommended/Test first,
			// then the grouped Required — so z precedes x, y.
			want: []string{"z", "x", "y"},
		},
		{
			name: "both schemas de-duplicated, order preserved",
			in: formulaV2Info{
				Dependencies:            []string{"a", "b"},
				RecommendedDependencies: []string{"b"},
				DependsOn: struct {
					Build       []string `json:"build"`
					Optional    []string `json:"optional"`
					Recommended []string `json:"recommended"`
					Test        []string `json:"test"`
					Required    []string `json:"required"`
				}{Required: []string{"b", "c"}},
			},
			want: []string{"a", "b", "c"},
		},
		{
			name: "empty",
			in:   formulaV2Info{},
			want: []string{},
		},
	}
	for _, c := range cases {
		if got := mergeDependencies(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: mergeDependencies = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestClassifyOutdated verifies the `brew outdated` text parser that backs
// GetOutdatedWithVersion: noise lines and short lines are skipped, and the
// cask set (built ONCE, not per package) drives the type classification —
// this guards the previous N+1 `brew list --cask` regression.
func TestClassifyOutdated(t *testing.T) {
	input := "==> Auto-updated Homebrew!\nfirefox 130.0 131.0\nvim 9.1.0 9.2.0\nstray-line\n"
	pkgs := classifyOutdated(input, map[string]bool{"firefox": true})
	if len(pkgs) != 2 {
		t.Fatalf("got %d packages %+v, want 2", len(pkgs), pkgs)
	}
	if pkgs[0].Name != "firefox" || pkgs[0].Type != "cask" || pkgs[0].Version != "130.0" {
		t.Errorf("firefox row wrong: %+v", pkgs[0])
	}
	if pkgs[1].Name != "vim" || pkgs[1].Type != "formula" || pkgs[1].LatestVersion != "" {
		t.Errorf("vim row wrong: %+v", pkgs[1])
	}
	if !pkgs[0].Outdated || !pkgs[1].Outdated {
		t.Error("both rows should be marked outdated")
	}
}

// TestFindUnusedTaps verifies unused-tap detection: a tap is unused when no
// installed formula/cask belongs to it; built-in taps are never flagged.
func TestFindUnusedTaps(t *testing.T) {
	cases := []struct {
		name      string
		taps      string
		installed []string
		want      []string
	}{
		{
			name:      "all taps used",
			taps:      "hashicorp/tap\nanomalyco/tap\n",
			installed: []string{"hashicorp/tap/consul", "anomalyco/tap/opencode", "ffmpeg"},
			want:      []string{},
		},
		{
			name:      "mixed used and unused",
			taps:      "steipete/tap\nhashicorp/tap\nfarion1231/ccswitch\n",
			installed: []string{"steipete/tap/gifgrep", "ffmpeg"},
			want:      []string{"farion1231/ccswitch", "hashicorp/tap"},
		},
		{
			name:      "built-in taps never flagged",
			taps:      "homebrew/core\nhomebrew/cask\nfoo/bar\n",
			installed: []string{"ffmpeg"},
			want:      []string{"foo/bar"},
		},
		{
			name:      "cask names count too",
			taps:      "hashicorp/tap\nfoo/bar\n",
			installed: []string{"hashicorp/tap/vault"},
			want:      []string{"foo/bar"},
		},
		{
			name:      "noise lines ignored",
			taps:      "==> Tapping foo/bar\nfoo/bar\nwarning: nothing\n",
			installed: []string{"ffmpeg"},
			want:      []string{"foo/bar"},
		},
		{
			name:      "empty inputs",
			taps:      "",
			installed: nil,
			want:      []string{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := findUnusedTaps(tc.taps, tc.installed)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("findUnusedTaps(%q, %v) = %v, want %v", tc.taps, tc.installed, got, tc.want)
			}
		})
	}
}
