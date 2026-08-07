package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	svc := NewService()

	err := wails.Run(&options.App{
		Title:            "Brew Manager",
		Width:            1200,
		Height:           800,
		MinWidth:         1200,
		MinHeight:        800,
		WindowStartState: options.Normal,
		Mac: &mac.Options{
			About: &mac.AboutInfo{
				Title:   "Brew Manager",
				Message: "A GUI tool for managing Homebrew packages on macOS",
			},
			TitleBar:             mac.TitleBarHidden(),
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 24, G: 24, B: 27, A: 1},
		OnStartup:        svc.startup,
		// 只绑定 Service：所有 brew 能力都在 Service 上（镜像源/系统代理等
		// 此前由 App 薄转发，前端现统一走 Service，删除了多余绑定）。
		Bind: []interface{}{
			svc,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
