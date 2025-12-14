FROM node:20-bookworm

LABEL maintainer="angrav-automation"
LABEL description="Standalone Antigravity IDE with embedded automation"

# Set environment
ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV NODE_ENV=production

# Install X11, VNC, and Electron dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display
    xvfb \
    x11vnc \
    xdotool \
    # Window manager (lightweight)
    fluxbox \
    # Electron/Chromium dependencies
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxtst6 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libxss1 \
    libasound2 \
    libgbm1 \
    libdrm2 \
    libxshmfence1 \
    # Utilities
    supervisor \
    wget \
    curl \
    ca-certificates \
    gnupg \
    dbus-x11 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Add Codeium repository and install Windsurf (Antigravity)
RUN curl -fsSL https://windsurf-stable.codeiumdata.com/wVxQEIWkwPUEAGf3/windsurf.gpg | gpg --dearmor -o /usr/share/keyrings/windsurf-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/windsurf-archive-keyring.gpg] https://windsurf-stable.codeiumdata.com/wVxQEIWkwPUEAGf3/apt stable main" > /etc/apt/sources.list.d/windsurf.list \
    && apt-get update \
    && apt-get install -y windsurf \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (Electron prefers this)
RUN useradd -m -s /bin/bash angrav \
    && mkdir -p /home/angrav/.config/Windsurf \
    && mkdir -p /workspace/tasks /workspace/output /workspace/project \
    && chown -R angrav:angrav /home/angrav /workspace

# Install Playwright and dependencies
WORKDIR /opt/angrav
COPY package*.json ./
RUN npm install --production \
    && npx playwright install chromium \
    && npx playwright install-deps

# Copy automation code
COPY src/ ./src/
COPY docker/worker.ts ./worker.ts
COPY tsconfig.json ./

# Supervisord configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Fix chrome-sandbox permissions for Electron
RUN chmod 4755 /usr/share/windsurf/chrome-sandbox 2>/dev/null || true

# Expose ports
# 9222 = CDP (Chrome DevTools Protocol)
# 5900 = VNC
EXPOSE 9222 5900

# Volumes
VOLUME ["/workspace", "/home/angrav/.config/Windsurf"]

# Set user
USER angrav
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
