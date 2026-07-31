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
}

// Version returns the brew version info
func (a *App) Version() string {
	return a.brewService.GetVersion()
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
