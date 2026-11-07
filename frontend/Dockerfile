# Build stage
FROM oven/bun:latest AS build

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM nginx:alpine

# Copy built files to nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 5173

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
