#!/bin/bash
set -e

# Start Python recognition bridge service in the background on port 8000
echo "Starting Python Vision Recognition service on port 8000..."
python python/recognition_bridge.py &

# Wait for Python service to become ready
echo "Waiting for Python Vision Recognition service to be ready..."
for i in {1..30}; do
  if curl -s http://127.0.0.1:8000/ > /dev/null 2>&1; then
    echo "Python Vision Recognition service is ready!"
    break
  fi
  sleep 1
done

# Start Node.js Express server on Railway $PORT (defaults to 3000 if unset)
echo "Starting Node.js server on port ${PORT:-3000}..."
export PORT=${PORT:-3000}
export NODE_ENV=production
exec npx tsx server.ts
