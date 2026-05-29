#!/bin/bash
# --- Ultimate angrav-browser Deployment Script ---
# This script is intended to be run on halvarm (the target server).
# It automates local builds of Docker images and Nomad job updates.

set -e

REPO_ROOT="/home/ubuntu/Obsi/Prods/01-pwf"
APP_DIR="${REPO_ROOT}/agents/angrav"
REGISTRY="localhost:5001"
IMAGE_NAME="angrav-browser"
NOMAD_JOB="angrav-browser"

echo "🚀 [Deploy] Starting deployment from ${APP_DIR}..."

# 1. Update source code (assuming this script is called after a git pull/push)
# If this is called from a post-receive hook, the code is already updated in the work-tree.

# 2. Build Shared Library
echo "📦 [Deploy] Building @agents/shared..."
cd "${REPO_ROOT}/agents/shared"
npm install --silent
npm run build

# 3. Build angrav-browser Docker Image
echo "🐳 [Deploy] Building Docker image: ${REGISTRY}/${IMAGE_NAME}:latest..."
cd "${APP_DIR}"
docker build -t "${REGISTRY}/${IMAGE_NAME}:latest" -f docker/Dockerfile.browser .

# 4. Push to Local Registry
echo "⬆️ [Deploy] Pushing to local registry..."
docker push "${REGISTRY}/${IMAGE_NAME}:latest"

# 5. Copy Nomad HCL Job definition to local server directory
echo "🏗️ [Deploy] Copying Nomad job definition to /opt/nomad/jobs/..."
sudo mkdir -p /opt/nomad/jobs
sudo cp "${APP_DIR}/deploy/angrav-browser.nomad.hcl" "/opt/nomad/jobs/angrav-browser.nomad.hcl"

# 6. Update/Restart Nomad Job
echo "🏗️ [Deploy] Triggering Nomad job update..."
nomad job run "/opt/nomad/jobs/angrav-browser.nomad.hcl"

echo "✅ [Deploy] Finished successfully!"
