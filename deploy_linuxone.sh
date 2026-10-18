#!/usr/bin/env bash
# ==============================================================================
# 5SENSE - IBM Z / LinuxONE 1-Click Fast Deployment Script
# Target: IBM LinuxONE Community Cloud (Marist) s390x Architecture
# ==============================================================================

set -e

echo "=========================================================="
echo "🚀 5Sense IBM LinuxONE Deployment Starting..."
echo "System Architecture: $(uname -m)"
echo "=========================================================="

# 1. Update package manager and install prerequisites
if command -v apt-get >/dev/null 2>&1; then
    echo "📦 Checking system packages (Debian/Ubuntu s390x)..."
    sudo apt-get update -y
    sudo apt-get install -y curl git build-essential
elif command -v yum >/dev/null 2>&1; then
    echo "📦 Checking system packages (RHEL/CentOS s390x)..."
    sudo yum install -y curl git make gcc-c++
fi

# 2. Check Node.js and PM2
if ! command -v node >/dev/null 2>&1; then
    echo "📦 Installing Node.js LTS for s390x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs || sudo yum install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version:  $(npm -v)"

if ! command -v pm2 >/dev/null 2>&1; then
    echo "📦 Installing PM2 process manager..."
    sudo npm install -g pm2
fi

# 3. Clean any existing failed processes
echo "🧹 Cleaning up existing processes..."
pm2 delete all || true

# 4. Install project dependencies & build
echo "📦 Installing workspace dependencies..."
npm install

echo "🔨 Building frontend production bundle..."
npm run build:frontend

# 5. Create default environment file if missing
if [ ! -f backend/.env ]; then
    echo "⚙️ Creating backend/.env configuration..."
    cat << 'EOF' > backend/.env
PORT=4000
HOST=0.0.0.0
NODE_ENV=production
CORS_ORIGIN=*
DB_PATH=./data/5sense.sqlite
EOF
fi

# 6. Start backend on LinuxONE (Port 4000)
echo "🚀 Launching 5Sense Fastify Backend on LinuxONE..."
pm2 start "npm run start:backend" --name "5sense-backend"

# 7. Start frontend on LinuxONE (Port 80 with Port 5173 fallback)
echo "🚀 Launching 5Sense Frontend on LinuxONE..."
# If sudo allows port 80:
if sudo -n true 2>/dev/null; then
    sudo pm2 start "npm run preview:frontend -- --host 0.0.0.0 --port 80" --name "5sense-frontend"
else
    pm2 start "npm run preview:frontend -- --host 0.0.0.0 --port 5173" --name "5sense-frontend"
fi

# 8. Save PM2 state
pm2 save

echo "=========================================================="
echo "🎉 5Sense is now ONLINE on IBM LinuxONE!"
echo "Server Architecture: $(uname -m) (IBM Z Mainframe)"
pm2 status
echo "=========================================================="
echo "👉 Backend:  http://$(curl -s ifconfig.me || echo '148.78.100.11'):4000/api/health"
echo "👉 Frontend: http://$(curl -s ifconfig.me || echo '148.78.100.11'):80 (or :5173)"
echo "=========================================================="
