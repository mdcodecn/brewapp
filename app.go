package main

import (
	"context"
)

// App struct
type App struct {
	ctx         context.Context
	brewService *Service
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		brewService: NewService(),
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.brewService.setContext(ctx)
	// Hide the system traffic lights (we draw our own in the sidebar)
	hideSystemTrafficLights()
}

// Version returns the brew version info
func (a *App) Version() string {
	return a.brewService.GetVersion()
}

// GetBrewInfo returns Homebrew availability info (found or not, and where)
func (a *App) GetBrewInfo() *BrewInfo {
	return a.brewService.GetBrewInfo()
}

// ResetBrewDetection re-discovers the brew installation on next use
func (a *App) ResetBrewDetection() {
	a.brewService.ResetBrewDetection()
}

// GetDependencies returns dependencies for a package
func (a *App) GetDependencies(name string) ([]string, error) {
	return a.brewService.GetDependencies(name)
}

// Autoremove removes orphaned dependencies
func (a *App) Autoremove() error {
	return a.brewService.Autoremove()
}

// AddTap adds a new tap
func (a *App) AddTap(tap string) error {
	return a.brewService.AddTap(tap)
}

// RemoveTap removes a tap
func (a *App) RemoveTap(tap string) error {
	return a.brewService.RemoveTap(tap)
}

// GetOutdatedWithVersion returns outdated packages with versions
func (a *App) GetOutdatedWithVersion() ([]BrewPackage, error) {
	return a.brewService.GetOutdatedWithVersion()
}

// Update runs brew update
func (a *App) Update() error {
	return a.brewService.Update()
}

// UpdateWithOutput runs brew update and returns its output
func (a *App) UpdateWithOutput() (string, error) {
	return a.brewService.UpdateWithOutput()
}

// Doctor runs brew doctor
func (a *App) Doctor() (string, error) {
	return a.brewService.Doctor()
}

// Config returns brew config
func (a *App) Config() (string, error) {
	return a.brewService.Config()
}

// GetLeaves returns top-level packages
func (a *App) GetLeaves() ([]string, error) {
	return a.brewService.GetLeaves()
}

// GetMissing returns packages with missing dependencies
func (a *App) GetMissing() ([]string, error) {
	return a.brewService.GetMissing()
}

// GetUses returns packages that depend on the given package
func (a *App) GetUses(name string) ([]string, error) {
	return a.brewService.GetUses(name)
}

// Pin pins a package
func (a *App) Pin(name string) error {
	return a.brewService.Pin(name)
}

// Unpin unpins a package
func (a *App) Unpin(name string) error {
	return a.brewService.Unpin(name)
}

// Link links a package
func (a *App) Link(name string) error {
	return a.brewService.Link(name)
}

// Unlink unlinks a package
func (a *App) Unlink(name string) error {
	return a.brewService.Unlink(name)
}

// GetVulns returns known vulnerabilities
func (a *App) GetVulns() (string, error) {
	return a.brewService.GetVulns()
}

// GetMirrorSources returns the Homebrew mirror presets and the current one
func (a *App) GetMirrorSources() (*MirrorSourcesResponse, error) {
	return a.brewService.GetMirrorSources()
}

// SetMirrorSource switches the Homebrew download mirror source
func (a *App) SetMirrorSource(id string) error {
	return a.brewService.SetMirrorSource(id)
}
