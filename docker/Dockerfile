FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files first for layer caching
COPY angrav/package.json angrav/package-lock.json* ./
COPY shared ./shared/

# Update package.json to point to the correct shared module path
RUN sed -i 's|file:../shared|file:./shared|g' package.json

# Build shared library first (required for CI where dist/ is missing)
RUN cd shared && npm install && npm run build

# Install dependencies (browsers are already in the image)
RUN npm install

# Copy angrav source files
COPY angrav/src ./src/
COPY angrav/tsconfig.json ./
COPY angrav/playwright.config.ts ./

# Build TypeScript
RUN npm run build

# Expose HTTP server port
EXPOSE 3031

# Default: Run the HTTP server
CMD ["node", "dist/cli.js", "serve", "--port", "3031", "--host", "0.0.0.0"]
