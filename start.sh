#!/usr/bin/env bash
set -euo pipefail

cd backend
npm install
npm run build
exec npm run start
