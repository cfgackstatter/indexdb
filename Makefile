.DEFAULT_GOAL := help

# ── Config ───────────────────────────────────────────────────────────────────
S3_BUCKET ?= indexdb-data

# ── Help ─────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  IndexDB — available commands"
	@echo ""
	@echo "  Dev"
	@echo "    make dev              Start FastAPI backend locally (port 8000)"
	@echo "    make frontend         Start Vite frontend dev server"
	@echo ""
	@echo "  Build & Clean"
	@echo "    make build            Clean + build frontend for production"
	@echo "    make clean            Remove build artifacts and .pyc files"
	@echo "    make clean-frontend   Remove frontend/dist and frontend/.vite"
	@echo "    make clean-pyc        Remove Python bytecode and __pycache__"
	@echo ""
	@echo "  Deploy"
	@echo "    make secrets          Push secrets to EB (run once or on key rotation)"
	@echo "    make deploy           Commit, push, and deploy to EB"
	@echo "    make logs             Tail EB logs"
	@echo "    make ssh              SSH into the EB instance"
	@echo ""
	@echo "  S3 Data Sync"
	@echo "    make sync-down        Download S3 data to local ./data/"
	@echo "    make sync-up          Upload local ./data/ to S3"
	@echo ""

# ── Local dev ─────────────────────────────────────────────────────────────────
.PHONY: dev frontend
dev:
	uvicorn backend.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# ── Clean ─────────────────────────────────────────────────────────────────────
.PHONY: clean clean-frontend clean-pyc
clean-frontend:
	rm -rf frontend/dist frontend/.vite

clean-pyc:
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name "*.egg-info" -exec rm -rf {} +

clean: clean-frontend clean-pyc

# ── Build ─────────────────────────────────────────────────────────────────────
.PHONY: build
build: clean-frontend
	cd frontend && npm run build

# ── Secrets ───────────────────────────────────────────────────────────────────
.PHONY: secrets
secrets:
	$(eval PERPLEXITY_API_KEY := $(shell grep '^PERPLEXITY_API_KEY' backend/.env | cut -d '=' -f2))
	@eb setenv PERPLEXITY_API_KEY=$(PERPLEXITY_API_KEY)
	@echo "Secrets pushed. Run 'make deploy' to deploy."

# ── Deploy ────────────────────────────────────────────────────────────────────
.PHONY: deploy logs ssh
deploy: build
	@echo "Deploying to Elastic Beanstalk..."
	@if [ -n "$$(git status --porcelain)" ]; then \
		git add -A; \
		read -p "Commit message: " msg; \
		git commit -m "$$msg"; \
		git push; \
	else \
		echo "No changes to commit, pushing existing commits..."; \
		git push || echo "Already up to date"; \
	fi
	eb deploy
	@echo "Deployment complete! Run 'make logs' to view logs."

logs:
	eb logs --all

ssh:
	eb ssh

# ── S3 sync ───────────────────────────────────────────────────────────────────
.PHONY: sync-down sync-up
sync-down:
	aws s3 sync s3://$(S3_BUCKET)/ ./data/

sync-up:
	aws s3 sync ./data/ s3://$(S3_BUCKET)/
