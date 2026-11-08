.PHONY: fmt lint test audit build up down logs clean frontend

fmt:
	cargo fmt --all

lint:
	cargo clippy --workspace --all-targets -- -D warnings

test:
	cargo test --workspace

audit:
	./scripts/security_audit.sh

build:
	cargo build --release --bins

frontend:
	cd frontend && bun install --frozen-lockfile && bun run build

up: frontend
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f gateway collector normalizer analyst critic reporter

clean:
	cargo clean
