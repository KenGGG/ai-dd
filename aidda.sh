#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.aidda.pid"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/aidda.log"
PORT="${PORT:-3871}"
HOST="${HOST:-0.0.0.0}"

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
  ./aidda.sh check        Run lint, tests, and production build
  ./aidda.sh db:stats     Show SQLite table counts and file sizes
  ./aidda.sh db:backup    Create a SQLite backup under data/backups
  ./aidda.sh db:vacuum    Vacuum the SQLite database
  ./aidda.sh install      Install Node.js dependencies
  ./aidda.sh help         Show this help

Environment:
  PORT=3871               Server port.
  HOST=0.0.0.0            Server host.

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

install_deps() {
  require_node
  npm install
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
