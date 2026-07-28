#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.aidda.pid"
LOG_DIR="$ROOT_DIR/data/logs"
LOG_FILE="$LOG_DIR/aidda.log"
PORT="${PORT:-3871}"
HOST="${HOST:-127.0.0.1}"

cd "$ROOT_DIR"
mkdir -p "$LOG_DIR"

usage() {
  cat <<EOF
AIDDA Workbench control script

Usage:
  ./aidda.sh start        Start frontend + backend in development mode
  ./aidda.sh start-prod   Build if needed and start production server
  ./aidda.sh stop         Stop the running server
  ./aidda.sh restart      Restart development server
  ./aidda.sh status       Show process and port status
  ./aidda.sh logs         Tail server logs
  ./aidda.sh build        Build frontend and backend
  ./aidda.sh test         Run TypeScript unit tests
  ./aidda.sh doctor       Run system health checks
  ./aidda.sh check        Run lint, tests, and production build
  ./aidda.sh db:stats     Show SQLite table counts and file sizes
  ./aidda.sh db:backup    Create a SQLite backup under data/backups
  ./aidda.sh db:vacuum    Vacuum the SQLite database
  ./aidda.sh install      Install Node.js dependencies
  ./aidda.sh install-env  Install Python environment (conda)
  ./aidda.sh help         Show this help

Environment:
  PORT=3871               Server port.
  HOST=127.0.0.1            Server host (default: localhost).
  AIDDA_TOKEN=<token>       API authentication Bearer token.

URL:
  http://localhost:$PORT
EOF
}

require_node() {
  command -v node >/dev/null 2>&1 || {
    echo "ERROR: node is not installed or not in PATH."
    exit 1
  }
  command -v npm >/dev/null 2>&1 || {
    echo "ERROR: npm is not installed or not in PATH."
    exit 1
  }
}

ensure_deps() {
  require_node
  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    echo "ERROR: node_modules is missing. Run: ./aidda.sh install"
    exit 1
  fi
}

pid_is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

server_pids() {
  pgrep -f "$ROOT_DIR/node_modules/.bin/tsx server.ts|$ROOT_DIR/node_modules/tsx/.+server.ts|$ROOT_DIR/dist/server.cjs" 2>/dev/null || true
}

port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$PORT" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
      | sort -u
  else
    true
  fi
}

check_port_free() {
  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    echo "ERROR: port $PORT is already in use by PID(s):"
    echo "$pids"
    echo "Stop that process first, or change PORT if server.ts is updated to honor it."
    exit 1
  fi
}

start_dev() {
  ensure_deps
  if pid_is_running; then
    echo "AIDDA is already running. PID: $(cat "$PID_FILE")"
    echo "URL: http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
  check_port_free

  echo "Starting AIDDA Workbench in development mode..."
  echo "Log: $LOG_FILE"
  nohup setsid env PORT="$PORT" HOST="$HOST" DISABLE_HMR=true npm run dev >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 2

  if pid_is_running; then
    echo "Started. PID: $(cat "$PID_FILE")"
    echo "URL: http://localhost:$PORT"
  else
    echo "ERROR: server failed to start. Recent log:"
    tail -n 80 "$LOG_FILE" || true
    rm -f "$PID_FILE"
    exit 1
  fi
}

build_app() {
  ensure_deps
  npm run build
}

start_prod() {
  ensure_deps
  if [[ ! -f "$ROOT_DIR/dist/server.cjs" || ! -f "$ROOT_DIR/dist/index.html" ]]; then
    build_app
  fi
  if pid_is_running; then
    echo "AIDDA is already running. PID: $(cat "$PID_FILE")"
    echo "URL: http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
  check_port_free

  echo "Starting AIDDA Workbench in production mode..."
  echo "Log: $LOG_FILE"
  nohup setsid env NODE_ENV=production PORT="$PORT" HOST="$HOST" npm run start >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 2

  if pid_is_running; then
    echo "Started. PID: $(cat "$PID_FILE")"
    echo "URL: http://localhost:$PORT"
  else
    echo "ERROR: server failed to start. Recent log:"
    tail -n 80 "$LOG_FILE" || true
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop_app() {
  if ! pid_is_running; then
    rm -f "$PID_FILE"
    echo "AIDDA is not running."
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  echo "Stopping AIDDA Workbench. PID: $pid"
  kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$PID_FILE"
      echo "Stopped."
      return 0
    fi
    sleep 0.5
  done

  echo "Process did not exit gracefully; sending SIGKILL."
  kill -9 -- "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "Stopped."
}

status_app() {
  if pid_is_running; then
    echo "AIDDA is running. PID: $(cat "$PID_FILE")"
    echo "URL: http://localhost:$PORT"
  else
    echo "AIDDA is not running."
  fi

  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    echo "Port $PORT is in use by PID(s):"
    echo "$pids"
  else
    echo "Port $PORT is free."
  fi

  if [[ -f "$LOG_FILE" ]]; then
    echo "Log: $LOG_FILE"
  fi
}

tail_logs() {
  touch "$LOG_FILE"
  tail -n 120 -f "$LOG_FILE"
}

check_node_version() {
  command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is not installed."; return 1; }
  local version
  version=$(node --version)
  if [ "${version#v}" != "$version" ]; then
    echo "Node version: $version"
    return 0
  fi
  echo "ERROR: Invalid Node version: $version"
  return 1
}

check_npm_available() {
  command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is not installed."; return 1; }
  local version
  version=$(npm --version)
  echo "npm version: $version"
  return 0
}

check_deps_installed() {
  [[ -d "$ROOT_DIR/node_modules" ]] && { echo "Node dependencies: INSTALLED"; return 0; } || { echo "Node dependencies: MISSING"; return 1; }
}

check_port_free() {
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)
    if [[ -n "$pids" ]]; then
      echo "Port $PORT: IN USE by PIDs($pids)"
      return 1
    fi
  elif command -v ss >/dev/null 2>&1; then
    local output
    output=$(ss -ltnp "sport = :$PORT" 2>/dev/null)
    if [[ -n "$output" ]]; then
      echo "Port $PORT: LISTENING"
      return 1
    fi
  fi
  echo "Port $PORT: FREE"
  return 0
}

check_pid() {
  [[ -f "$PID_FILE" ]] || { echo "PID file: NOT FOUND"; return 1; }
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  [[ -z "$pid" ]] && { echo "PID file: EMPTY"; return 1; }
  if kill -0 "$pid" 2>/dev/null; then
    echo "Process $pid: RUNNING"
    return 0
  else
    echo "Process $pid: STALE (not running)"
    rm -f "$PID_FILE"
    return 1
  fi
}

check_log_dir() {
  [[ -d "$LOG_DIR" ]] && { echo "Log directory ($LOG_DIR): EXISTS"; return 0; } || { echo "Log directory ($LOG_DIR): MISSING"; return 1; }
}

check_log_file() {
  [[ -f "$LOG_FILE" ]] && { echo "Log file ($LOG_FILE): EXISTS"; return 0; } || { echo "Log file ($LOG_FILE): MISSING"; return 1; }
}

check_data_dir() {
  local data_dir="$ROOT_DIR/data"
  [[ -d "$data_dir" ]] && { echo "Data directory ($data_dir): EXISTS"; return 0; } || { echo "Data directory ($data_dir): MISSING"; return 1; }
}

check_database() {
  local db_path="$ROOT_DIR/data/aidda.db"
  if [[ ! -f "$db_path" ]]; then
    echo "Database file: MISSING"
    return 1
  fi
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "Database: sqlite3 tool not available, skip integrity check"
    local size
    size=$(stat -c%s "$db_path" 2>/dev/null || stat -f%z "$db_path" 2>/dev/null || echo "unknown")
    echo "Database file exists, size: ${size:-unknown} bytes"
    return 0
  fi
  local result result_code
  result=$(sqlite3 "$db_path" ".timeout 5000; PRAGMA integrity_check;" 2>&1)
  result_code=$?
  if [[ $result_code -ne 0 ]]; then
    echo "Database integrity check failed with error code $result_code: $result"
    return 1
  fi
  if [[ "$result" == "ok" ]]; then
    echo "Database integrity: OK"
    return 0
  else
    echo "Database integrity check result: $result"
    return 1
  fi
}

check_api_health() {
  local url="http://localhost:${PORT}/health"
  if ! curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -q "^2"; then
    echo "Health endpoint: UNREACHABLE (server not running?)"
    return 1
  fi
  echo "Health endpoint: REACHABLE"
  return 0
}

doctor() {
  echo "========================================"
  echo "AIDDA Workbench Doctor - System Health Check"
  echo "========================================"
  echo
  echo "Environment:"
  check_node_version
  check_npm_available
  echo
  echo "Dependencies:"
  check_deps_installed
  echo
  echo "Process State:"
  check_pid
  echo
  echo "Network:"
  check_port_free
  echo
  echo "File System:"
  check_data_dir
  check_log_dir
  check_log_file
  echo
  echo "Database:"
  check_database
  echo
  echo "API Health:"
  check_api_health
  echo
  echo "========================================"
  echo "Doctor check complete."
  echo "========================================"
}

install_deps() {
  require_node
  npm install
}

install_env() {
  echo "Installing Python environment from environment.yml..."
  if command -v conda >/dev/null 2>&1 || command -v mamba >/dev/null 2>&1; then
    conda env create -f environment.yml --yes
    echo "Python environment installed successfully."
  elif command -v poetry >/dev/null 2>&1; then
    echo "Poetry detected. Run: poetry env create"
  else
    echo "ERROR: Neither conda, mamba, nor poetry available. Please install one of these tools."
    echo "Then run: ./aidda.sh install-env"
    exit 1
  fi
}

case "${1:-help}" in
  start)
    start_dev
    ;;
  start-prod)
    start_prod
    ;;
  stop)
    stop_app
    ;;
  restart)
    stop_app
    start_dev
    ;;
  status)
    status_app
    ;;
  logs)
    tail_logs
    ;;
  build)
    build_app
    ;;
  test)
    ensure_deps
    npm test
    ;;
  doctor)
    doctor
    ;;
  check)
    ensure_deps
    npm run check
    ;;
  db:stats)
    ensure_deps
    npm run db:stats
    ;;
  db:backup)
    ensure_deps
    npm run db:backup
    ;;
  db:vacuum)
    ensure_deps
    npm run db:vacuum
    ;;
  install)
    install_deps
    ;;
  install-env)
    install_env
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $1"
    echo
    usage
    exit 1
    ;;
esac
