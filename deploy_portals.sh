#!/usr/bin/env bash
# Deploy every Vercel project from the REPO ROOT.
#
# Why the root: all five projects are configured with repo-root-relative root
# directories (backend, frontend, frontend/admin, frontend/student,
# frontend/shopkeeper). Uploading from a subdirectory makes Vercel look for
# e.g. "backend/backend" and the build fails with
#   Error: The specified Root Directory "backend" does not exist.
# So we swap the ROOT .vercel/project.json to point at each project in turn and
# always deploy from the repo root.
#
# Env vars (VITE_API_URL, JWT_SECRET, the DB URL, ...) live on the Vercel
# projects, so they survive every redeploy. This deliberately does NOT use
# deploy.sh, which would regenerate JWT_SECRET + the admin password and log
# everybody out.
set -uo pipefail
cd "$(dirname "$0")"
ORG='team_AeznTxmDmdbQm8nxPjuaibn3'
LOG=/tmp/deploy_all.log
: > "$LOG"

deploy() {  # deploy <projectId> <projectName>
  local id="$1" name="$2"
  printf '{"projectId":"%s","orgId":"%s","projectName":"%s"}' "$id" "$ORG" "$name" \
    > .vercel/project.json
  echo "=== $name ===" >> "$LOG"
  if vercel --prod --yes >> "$LOG" 2>&1; then
    echo "RESULT $name OK" >> "$LOG"
  else
    echo "RESULT $name FAILED" >> "$LOG"
  fi
}

# Backend first: its first request re-runs the schema auto-migrations, so the
# new notifications columns exist before any portal uses them.
deploy prj_cZksr4YVlzwUZXzCBT6jYpEvB9eS detomsite-backend
deploy prj_SrMY5EGH8A87snFS34iNeX7blJd9 detomsite-frontend
deploy prj_IkWWH91U8FaGhHnoswhepPIpjrDm detomsite-admin
deploy prj_TXnp0z3dRA1tpaAX1Y5Na2R7746V detomsite-student
deploy prj_ZkIGgLuTT6C2CiT4nP4Q9ec1U4po detomsite-shopkeeper

# Leave the root link on the main portal, where it started.
printf '{"projectId":"%s","orgId":"%s","projectName":"detomsite-frontend"}' \
  prj_SrMY5EGH8A87snFS34iNeX7blJd9 "$ORG" > .vercel/project.json
echo "=== ALL DONE ===" >> "$LOG"
