.PHONY: dev build clean run

# 开发模式（热重载前端）
dev:
	wails dev

# 打包生产版本
build:
	wails build -platform darwin/arm64

# 清理构建产物
clean:
	rm -rf build/bin
	cd frontend && rm -rf node_modules dist

# 直接运行（等同于 dev）
run: dev
