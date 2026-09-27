#!/usr/bin/env bash
# Write services/job-worker/.env.local from the local Terraform outputs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/tf.sh" local output -json worker_env \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const [k,v] of Object.entries(JSON.parse(s)))console.log(`${k}=${v}`)})' \
  > "$ROOT/services/job-worker/.env.local"
echo "wrote services/job-worker/.env.local"
