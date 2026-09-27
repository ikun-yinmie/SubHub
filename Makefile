# SubHub 常用命令
# 说明: 所有命令都假设在仓库根目录执行

SHELL := /bin/bash
PORT ?= 9635
HOST ?= 127.0.0.1

.PHONY: help start stop restart status logs desktop dev build serve smoke check web-build web-dev docker-build docker-up docker-down clean

help:
	@echo "SubHub 可用命令:"
	@echo "  make start       # 一键启动 (后台运行, 就绪后开浏览器; 也可双击 ./start.sh)"
	@echo "  make stop        # 一键停止"
	@echo "  make restart     # 重启"
	@echo "  make status      # 状态 + 健康检查 + 最近日志"
	@echo "  make logs        # 跟踪日志 (Ctrl+C 退出)"
	@echo "  make desktop     # 安装可双击的桌面启动器 (菜单 + 桌面)"
	@echo "  make desktop-rm  # 卸载桌面启动器"
	@echo "  make dev         # 前台源码模式启动 (端口 PORT=$(PORT))"
	@echo "  make build       # 打包 dist/sub-store.bundle.js"
	@echo "  make serve       # 前台运行打包产物"
	@echo "  make smoke       # 冒烟测试 (需先启动服务)"
	@echo "  make check       # 语法检查 (esbuild 解析全部源码 + bash -n 全部脚本)"
	@echo "  make web-build   # 构建内置前端 web/dist"
	@echo "  make web-dev     # 前端开发服务器"
	@echo "  make docker-build / docker-up / docker-down"
	@echo "  make clean       # 清理构建产物"

start:
	PORT=$(PORT) HOST=$(HOST) bash scripts/manage.sh start

stop:
	PORT=$(PORT) bash scripts/manage.sh stop

restart:
	PORT=$(PORT) HOST=$(HOST) bash scripts/manage.sh restart

status:
	PORT=$(PORT) bash scripts/manage.sh status

logs:
	bash scripts/manage.sh logs -f

desktop:
	bash scripts/desktop.sh install

desktop-rm:
	bash scripts/desktop.sh uninstall

dev:
	PORT=$(PORT) HOST=$(HOST) bash scripts/dev.sh

build:
	bash scripts/build.sh

serve:
	PORT=$(PORT) HOST=$(HOST) bash scripts/serve.sh

smoke:
	SUBHUB_BASE=http://127.0.0.1:$(PORT) node scripts/smoke-test.mjs

check:
	@for f in src/unified/*.js; do ./node_modules/.bin/esbuild "$$f" --format=esm --outfile=/dev/null >/dev/null || exit 1; done
	@for f in scripts/*.sh *.sh; do bash -n "$$f" || exit 1; done
	@echo "语法检查通过"

web-build:
	cd web && yarn install && yarn build

web-dev:
	cd web && yarn dev

docker-build:
	docker build -t subhub:local .

docker-up:
	docker compose up -d

docker-down:
	docker compose down

clean:
	rm -rf dist sub-store.min.js web/dist
