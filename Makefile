.PHONY: help up build down restart ps status logs logs-backend logs-frontend test test-backend test-frontend health clean

PROJECT_DIR := $(CURDIR)

help: ## Mostra os comandos disponíveis
	@echo "Comandos disponíveis para o Jiramone:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Inicia os containers em segundo plano (sem rebuild)
	docker compose up -d

build: ## Reconstrói as imagens e inicia os containers
	docker compose up --build -d

down: ## Para e remove os containers
	docker compose down

restart: ## Reinicia todos os containers
	docker compose restart

ps: ## Exibe o status dos containers
	docker compose ps

status: ps ## Alias para ps

logs: ## Acompanha os logs de todos os serviços
	docker compose logs -f --tail=100

logs-backend: ## Acompanha os logs do backend
	docker compose logs -f --tail=100 backend

logs-frontend: ## Acompanha os logs do frontend
	docker compose logs -f --tail=100 frontend

test: test-backend test-frontend ## Executa todas as suítes de teste (backend + frontend)

test-backend: ## Executa os testes unitários e de integração do backend
	docker run --rm \
		-v "$(PROJECT_DIR)/backend/src:/app/src" \
		-v "$(PROJECT_DIR)/backend/tests:/app/tests" \
		-v "$(PROJECT_DIR)/backend/tsconfig.json:/app/tsconfig.json" \
		-v "$(PROJECT_DIR)/backend/tsconfig.test.json:/app/tsconfig.test.json" \
		-v "$(PROJECT_DIR)/backend/package.json:/app/package.json" \
		teste-opencode-backend npm test

test-frontend: ## Executa os testes do servidor e da lógica do frontend
	docker run --rm \
		-v "$(PROJECT_DIR)/frontend:/app" \
		-w /app \
		node:20-alpine npm test

health: ## Verifica a saúde do backend e do frontend nos containers ativos
	@docker compose ps
	@docker exec teste-opencode-backend-1 wget -qO- http://127.0.0.1:3000/api/health && echo ""
	@docker exec teste-opencode-frontend-1 wget -qO- http://127.0.0.1:3001/config.js && echo ""

clean: ## Para os containers e remove volumes (apaga dados do banco)
	docker compose down -v --remove-orphans
