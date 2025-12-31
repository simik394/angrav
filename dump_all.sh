#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Angrav History Dump..."
npx ts-node scripts/dump_history.ts
