# Multi-runtime image: Python 3.11 + Node.js 20 for Heritage Vision
FROM python:3.11-slim

# Prevent interactive prompts and Python output buffering
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

# Install system dependencies, curl, and Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
    build-essential \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install lightweight CPU-optimized PyTorch and Python dependencies
COPY python/requirements.txt ./python/requirements.txt
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r python/requirements.txt

# Pre-cache MobileNet v3 weights during image build so deployment is instantaneous
RUN python -c "import torchvision.models as models; models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)"

# Install Node dependencies and prepare frontend
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy application source code
COPY . .

# Build Vite React SPA for production
RUN npm run build

# Make startup script executable
RUN chmod +x start.sh

# Railway injects $PORT at runtime
EXPOSE 3000 8000

CMD ["bash", "start.sh"]
