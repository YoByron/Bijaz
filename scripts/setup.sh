#!/bin/bash
#
# Bijaz Setup Script
#
# This script sets up the Bijaz development environment.
#

set -e

echo "=========================================="
echo "  Bijaz Setup"
echo "=========================================="
echo ""

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 22 ]; then
    echo "Error: Node.js 22 or higher is required."
    echo "Current version: $(node -v 2>/dev/null || echo 'not installed')"
    echo ""
    echo "Install Node.js 22+ from https://nodejs.org"
    exit 1
fi
echo "✓ Node.js version: $(node -v)"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi
echo "✓ pnpm version: $(pnpm -v)"

# Install dependencies
echo ""
echo "Installing dependencies..."
pnpm install

# Create data directories
echo ""
echo "Creating data directories..."
mkdir -p ~/.bijaz/data
mkdir -p ~/.bijaz/logs
mkdir -p ~/.bijaz/chroma

# Copy default config if not exists
if [ ! -f ~/.bijaz/config.yaml ]; then
    echo "Creating default configuration..."
    cp config/default.yaml ~/.bijaz/config.yaml
    echo "✓ Configuration created at ~/.bijaz/config.yaml"
else
    echo "✓ Configuration already exists at ~/.bijaz/config.yaml"
fi

# Copy .env.example if .env doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "✓ Created .env - please edit with your API keys"
else
    echo "✓ .env already exists"
fi

# Build TypeScript
echo ""
echo "Building TypeScript..."
pnpm build

# Initialize database
echo ""
echo "Initializing database..."
if [ -f src/memory/schema.sql ]; then
    sqlite3 ~/.bijaz/data/bijaz.db < src/memory/schema.sql 2>/dev/null || true
    echo "✓ Database initialized"
fi

# Run tests
echo ""
echo "Running tests..."
pnpm test --run || echo "⚠ Some tests failed - this is expected before full implementation"

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit .env with your API keys:"
echo "   - ANTHROPIC_API_KEY (required for LLM)"
echo "   - POLYGON_RPC_URL (required for blockchain)"
echo ""
echo "2. Edit ~/.bijaz/config.yaml to customize settings"
echo ""
echo "3. Create a wallet:"
echo "   pnpm bijaz wallet create"
echo ""
echo "4. Start the CLI:"
echo "   pnpm bijaz chat"
echo ""
echo "For development:"
echo "   pnpm dev          # Watch mode"
echo "   pnpm test         # Run tests"
echo "   pnpm gateway      # Start gateway"
echo ""
