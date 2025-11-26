FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Expose ports
EXPOSE 8080 9092 9093 9094

# Default command
CMD ["npm", "start"]