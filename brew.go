package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// BrewPackage represents a Homebrew package (cask or formula)
type BrewPackage struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Type        string `json:"type"` // "cask" or "formula"
	Outdated    bool   `json:"outdated"`
	Installed   bool   `json:"installed"`
	DependsOn   []string `json:"depends_on,omitempty"`
	InstallTime string   `json:"install_time,omitempty"`
}

// BrewSearchResult represents a search result from brew search
type BrewSearchResult struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Type        string `json:"type"`
	Installed   bool   `json:"installed"`
	Score       float64 `json:"score,omitempty"`
}

// Service handles all brew operations
type Service struct{}

// NewService creates a new brew service
func NewService() *Service {
	return &Service{}
}

// runBrew executes a brew command and returns the output
func (s *Service) runBrew(args ...string) (string, error) {
	cmd := exec.Command("brew", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("brew %s: %s (%w)", strings.Join(args, " "), string(output), err)
	}
	return string(output), nil
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

// ListInstalled returns all installed packages
func (s *Service) ListInstalled() ([]BrewPackage, error) {
	// Use "brew list --versions" for both casks and formulas
	// Format: "name version1 [version2 ...]" (one line per package)
	caskOutput, _ := s.runBrew("list", "--cask", "--versions")
	formulaOutput, _ := s.runBrew("list", "--formula", "--versions")

	packages := make([]BrewPackage, 0)

	// Parse casks
	for _, line := range strings.Split(strings.TrimSpace(caskOutput), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		pkg := s.parseVersionsLine(line, "cask")
		packages = append(packages, pkg)
	}

	// Parse formulas (exclude those that are also casks)
	caskNames := make(map[string]bool)
	for _, pkg := range packages {
		caskNames[pkg.Name] = true
	}

	for _, line := range strings.Split(strings.TrimSpace(formulaOutput), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || caskNames[line] {
			continue
		}
		pkg := s.parseVersionsLine(line, "formula")
		packages = append(packages, pkg)
	}

	return packages, nil
}

// parseVersionsLine parses a line from "brew list --versions" output
// Format: "name version1 [version2 ...]"
func (s *Service) parseVersionsLine(line, pkgType string) BrewPackage {
	pkg := BrewPackage{
		Type: pkgType,
	}

	parts := strings.Fields(line)
	if len(parts) == 0 {
		return pkg
	}
	pkg.Name = parts[0]
	if len(parts) >= 2 {
		pkg.Version = parts[1] // latest installed version
	}

	return pkg
}

// GetPackageInfo returns detailed info for a single package (description + version)
func (s *Service) GetPackageInfo(name, pkgType string) (BrewPackage, error) {
	jsonOutput, err := s.runBrew("info", "--json", name)
	if err != nil {
		return BrewPackage{Name: name, Type: pkgType}, err
	}

	var info []struct {
		Name    string `json:"name"`
		Desc    string `json:"desc"`
		Versions struct {
			Stable string `json:"stable"`
		} `json:"versions"`
	}
	if err := json.Unmarshal([]byte(jsonOutput), &info); err != nil {
		return BrewPackage{Name: name, Type: pkgType}, err
	}

	pkg := BrewPackage{Name: name, Type: pkgType}
	if len(info) > 0 {
		pkg.Description = info[0].Desc
		pkg.Version = info[0].Versions.Stable
	}
	return pkg, nil
}

// Search searches for packages matching the query
func (s *Service) Search(query string) ([]BrewSearchResult, error) {
	if query == "" {
		return nil, nil
	}

	output, err := s.runBrew("search", query)
	if err != nil {
		return nil, fmt.Errorf("failed to search: %w", err)
	}

	results := make([]BrewSearchResult, 0)
	scanner := bufio.NewScanner(strings.NewReader(output))

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "==>") {
			continue
		}

		result := BrewSearchResult{}
		// Format: name@version (type) - description
		re := regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._+-]*)@?([a-zA-Z0-9._+-]*)\s+\(([cf])\)\s*[-–]\s*(.*)$`)
		matches := re.FindStringSubmatch(line)
		if matches != nil {
			result.Name = matches[1]
			if len(matches) > 2 && matches[2] != "" {
				result.Version = matches[2]
			}
			switch matches[3] {
			case "c":
				result.Type = "cask"
			case "f":
				result.Type = "formula"
			}
			if len(matches) > 4 {
				result.Description = strings.TrimSpace(matches[4])
			}
		} else {
			result.Name = line
			result.Type = "formula"
		}

		// Check if installed
		if _, err := s.runBrew("list", result.Name); err == nil {
			result.Installed = true
		}

		results = append(results, result)
	}

	return results, nil
}

// Install installs a package
func (s *Service) Install(name, pkgType string) error {
	args := []string{pkgType, name}
	_, err := s.runBrew(args...)
	if err != nil {
		return fmt.Errorf("failed to install %s: %w", name, err)
	}
	return nil
}

// Uninstall uninstalls a package
func (s *Service) Uninstall(name, pkgType string) error {
	args := []string{"uninstall", pkgType, name}
	if pkgType == "cask" {
		args = []string{"uninstall", "--cask", name}
	} else {
		args = []string{"uninstall", "--formula", name}
	}
	_, err := s.runBrew(args...)
	if err != nil {
		return fmt.Errorf("failed to uninstall %s: %w", name, err)
	}
	return nil
}

// Upgrade upgrades all packages or a specific one
func (s *Service) Upgrade(name ...string) error {
	args := []string{"upgrade", "--verbose"}
	if len(name) > 0 && name[0] != "" {
		args = append(args, name[0])
	}
	_, err := s.runBrew(args...)
	if err != nil {
		return fmt.Errorf("failed to upgrade: %w", err)
	}
	return nil
}

// GetOutdated returns all outdated packages
func (s *Service) GetOutdated() ([]BrewPackage, error) {
	output, err := s.runBrew("outdated")
	// If brew outdated fails (e.g., brew needs updating first), return empty list
	if err != nil {
		return []BrewPackage{}, nil
	}

	packages := make([]BrewPackage, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) >= 1 {
			pkg := BrewPackage{
				Name:     parts[0],
				Outdated: true,
				Type:     "formula",
			}
			if len(parts) >= 3 {
				pkg.Version = parts[2] // current version
			}

			packages = append(packages, pkg)
		}
	}

	return packages, nil
}

// Cleanup removes old versions and cached downloads
func (s *Service) Cleanup() error {
	_, err := s.runBrew("cleanup", "--prune=all")
	if err != nil {
		return fmt.Errorf("failed to cleanup: %w", err)
	}
	return nil
}

// GetStats returns brew statistics
func (s *Service) GetStats() (map[string]string, error) {
	result := make(map[string]string)

	// Get installed formula count
	formulaOutput, err := s.runBrew("list")
	if err == nil {
		count := 0
		for _, line := range strings.Split(strings.TrimSpace(formulaOutput), "\n") {
			if strings.TrimSpace(line) != "" {
				count++
			}
		}
		result["installed_formulas"] = fmt.Sprintf("%d", count)
	}

	// Get installed cask count
	caskOutput, err := s.runBrew("list", "--cask")
	if err == nil {
		count := 0
		for _, line := range strings.Split(strings.TrimSpace(caskOutput), "\n") {
			if strings.TrimSpace(line) != "" {
				count++
			}
		}
		result["installed_casks"] = fmt.Sprintf("%d", count)
	}

	// Get outdated count
	outdatedOutput, err := s.runBrew("outdated")
	if err == nil {
		count := 0
		for _, line := range strings.Split(strings.TrimSpace(outdatedOutput), "\n") {
			if strings.TrimSpace(line) != "" {
				count++
			}
		}
		result["outdated"] = fmt.Sprintf("%d", count)
	}

	return result, nil
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
		if line != "" && !strings.HasPrefix(line, "==>") {
			taps = append(taps, line)
		}
	}
	return taps, nil
}

// GetDiskUsage returns disk usage info for brew directories
func (s *Service) GetDiskUsage() (map[string]string, error) {
	result := make(map[string]string)

	// Also check Intel paths
	intelDirs := []struct {
		label string
		path  string
	}{
		{"Cellar (Intel)", "/usr/local/Cellar"},
		{"Caskroom (Intel)", "/usr/local/Caskroom"},
		{"Cache (Intel)", "/usr/local/Caches/Homebrew"},
	}
	for _, dir := range intelDirs {
		if _, ok := result[dir.label]; !ok {
			cmd := exec.Command("du", "-sh", dir.path)
			output, err := cmd.Output()
			if err == nil {
				parts := strings.Fields(string(output))
				if len(parts) > 0 {
					result[dir.label] = parts[0]
				}
			}
		}
	}

	dirs := []struct {
		label string
		path  string
	}{
		{"Cellar", "/opt/homebrew/Cellar"},
		{"Caskroom", "/opt/homebrew/Caskroom"},
		{"Cache", "/opt/homebrew/Caches/Homebrew"},
	}

	for _, dir := range dirs {
		cmd := exec.Command("du", "-sh", dir.path)
		output, err := cmd.Output()
		if err == nil {
			parts := strings.Fields(string(output))
			if len(parts) > 0 {
				result[dir.label] = parts[0]
			}
		}
	}

	return result, nil
}

// ExportConfig exports the list of installed packages to a file
func (s *Service) ExportConfig() (string, error) {
	caskOutput, _ := s.runBrew("list", "--cask")
	formulaOutput, _ := s.runBrew("list")

	content := fmt.Sprintf("# Brew Manager Export\n\n## Casks\n%s\n\n## Formulas\n%s",
		strings.TrimSpace(caskOutput),
		strings.TrimSpace(formulaOutput))

	return content, nil
}

// GetDependencies returns the dependencies for a package
func (s *Service) GetDependencies(name string) ([]string, error) {
	jsonOutput, err := s.runBrew("info", "--json=v2", name)
	if err != nil {
		return nil, fmt.Errorf("failed to get dependencies for %s: %w", name, err)
	}

	var info []struct {
		Name      string `json:"name"`
		DependsOn []struct {
			Name string `json:"name"`
		} `json:"depends_on"`
	}
	if err := json.Unmarshal([]byte(jsonOutput), &info); err != nil {
		// Try v1 format
		return s.getDependenciesV1(name)
	}

	if len(info) == 0 {
		return []string{}, nil
	}

	deps := make([]string, 0)
	for _, dep := range info[0].DependsOn {
		if dep.Name != "" {
			deps = append(deps, dep.Name)
		}
	}
	return deps, nil
}

// getDependenciesV1 uses the v1 JSON format as fallback
func (s *Service) getDependenciesV1(name string) ([]string, error) {
	jsonOutput, err := s.runBrew("info", "--json", name)
	if err != nil {
		return nil, err
	}

	var info []struct {
		Name      string `json:"name"`
		DependsOn []string `json:"depends_on"`
	}
	if err := json.Unmarshal([]byte(jsonOutput), &info); err != nil {
		return nil, err
	}

	if len(info) == 0 {
		return []string{}, nil
	}
	return info[0].DependsOn, nil
}

// Autoremove removes orphaned dependencies
func (s *Service) Autoremove() error {
	_, err := s.runBrew("autoremove")
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

// RemoveTap removes a tap
func (s *Service) RemoveTap(tap string) error {
	_, err := s.runBrew("untap", tap)
	if err != nil {
		return fmt.Errorf("failed to remove tap %s: %w", tap, err)
	}
	return nil
}

// GetPackageInstallTime returns the installation time of a package
func (s *Service) GetPackageInstallTime(name string) (string, error) {
	// Try to get from brew info
	jsonOutput, err := s.runBrew("info", "--json=v2", name)
	if err != nil {
		return "", err
	}

	var info []struct {
		Name          string `json:"name"`
		InstalledOnce []string `json:"installed_once_ever"`
	}
	if err := json.Unmarshal([]byte(jsonOutput), &info); err != nil {
		return "", err
	}

	if len(info) > 0 {
		return info[0].Name, nil
	}
	return "", nil
}

// GetOutdatedWithVersion returns outdated packages with current and latest versions
func (s *Service) GetOutdatedWithVersion() ([]BrewPackage, error) {
	output, err := s.runBrew("outdated")
	if err != nil {
		return []BrewPackage{}, nil
	}

	packages := make([]BrewPackage, 0)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) >= 3 {
			pkg := BrewPackage{
				Name:        parts[0],
				Version:     parts[1], // current version
				Outdated:    true,
				Type:        "formula",
			}
			// Check if it's a cask
			if _, err := s.runBrew("list", "--cask", parts[0]); err == nil {
				pkg.Type = "cask"
			}
			packages = append(packages, pkg)
		}
	}

	return packages, nil
}
