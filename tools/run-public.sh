#!/bin/sh
# Bring up the game server AND a public Cloudflare quick tunnel in one
# process tree, so a recycled sandbox needs exactly one command to return:
#   sh tools/run-public.sh
cd "$(dirname "$0")/.." || exit 1
node server/index.js &
SERVER=$!
sleep 1
CF=/home/user/bin/cloudflared
if [ ! -x "$CF" ]; then
  curl -sL -o "$CF" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$CF"
fi
"$CF" tunnel --no-autoupdate --url http://127.0.0.1:8787 2>&1 | tee /tmp/cf.log &
wait $SERVER
