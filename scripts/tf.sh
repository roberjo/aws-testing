#!/usr/bin/env bash
# Run Terraform in an env directory. Uses a local `terraform` if installed,
# otherwise the official Docker image (mounted at the same absolute path so
# abspath()/fileset() in the config behave identically).
#   scripts/tf.sh local apply -auto-approve
set -euo pipefail
ENV="${1:?usage: tf.sh <env> <terraform args...>}"; shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/infra/envs/$ENV"

if command -v terraform >/dev/null 2>&1 && [[ "${TF_USE_DOCKER:-}" != "1" ]]; then
  exec terraform -chdir="$DIR" "$@"
fi

TF_IMAGE="${TF_IMAGE:-hashicorp/terraform:1.14}"
exec docker run --rm -i \
  -v "$ROOT:$ROOT" -w "$DIR" \
  -v "${HOME}/.terraform.d/plugin-cache:/plugin-cache" -e TF_PLUGIN_CACHE_DIR=/plugin-cache \
  --add-host host.docker.internal:host-gateway \
  -e TF_VAR_fakecloud_endpoint="http://host.docker.internal:4566" \
  $(env | grep -E '^TF_VAR_' | grep -v '^TF_VAR_fakecloud_endpoint=' | sed 's/^/-e /' | cut -d= -f1) \
  "$TF_IMAGE" "$@"
