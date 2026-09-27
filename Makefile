# One-command local cloud:  make up && make test
SHELL := /bin/bash
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
ARCH := $(shell uname -m | sed -e 's/aarch64/arm64/' -e 's/x86_64/x86_64/')
export TF_VAR_lambda_architecture ?= $(if $(filter arm64,$(ARCH)),arm64,x86_64)

.PHONY: help install build fakecloud infra drift worker up test test-unit test-e2e logs down clean

help: ## Show targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## Install workspace dependencies
	npm ci

build: ## Build core, Lambda bundles, worker and the static site
	npm run build

fakecloud: ## Start fakecloud on :4566
	$(COMPOSE) up -d --wait fakecloud

infra: ## terraform apply the local stack against fakecloud
	scripts/tf.sh local init -input=false >/dev/null
	scripts/tf.sh local apply -auto-approve -input=false

drift: ## Fail if a second terraform plan is not empty (fakecloud round-trip fidelity)
	scripts/tf.sh local plan -input=false -detailed-exitcode -lock=false >/dev/null

worker: ## (Re)start the Kafka job worker container
	scripts/worker-env.sh
	$(COMPOSE) --profile worker up -d --build job-worker

up: build fakecloud infra worker ## Everything: build, fakecloud, terraform, worker
	@echo
	@echo "  App:  $$(scripts/tf.sh local output -raw app_url)"
	@echo "  Test: make test"

test: test-unit test-e2e ## Unit + end-to-end tests

test-unit: ## Pure unit tests (no cloud)
	npm run test:unit

test-e2e: ## End-to-end tests against the running local stack
	npm run test:e2e

logs: ## Tail fakecloud and worker logs
	$(COMPOSE) --profile worker logs -f --tail=50

down: ## Stop everything and forget local state (fakecloud runs in memory)
	-$(COMPOSE) --profile worker down --remove-orphans
	-docker ps -aq --filter label=fakecloud-instance | xargs docker rm -f 2>/dev/null
	rm -f infra/envs/local/terraform.tfstate infra/envs/local/terraform.tfstate.backup
	rm -rf infra/envs/local/build

clean: down ## down + remove build output
	rm -rf node_modules */*/dist */dist web/.next web/out infra/envs/*/.terraform
