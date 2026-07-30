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
