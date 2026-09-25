# Deploy the relay on a Pi

One container serves the client bundle, the room API, and the
WebSocket relay on `8131`, bound to loopback only. Everything public
arrives through a Cloudflare tunnel, so no port is ever opened on
the Pi.

The relay drains connections on `SIGTERM` / `SIGINT` so rollouts do
not drop flying ops.

## 1. Pi prep

On Raspberry Pi OS (64-bit).

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group applies, then build from
the repo root (the context must be the root: the Dockerfile
references `client/` and the root lockfile):

```bash
cd ~/starforge
docker build -f relay/Dockerfile -t starforge-relay:stable .
```

## 2. Run the relay

| Variable   | Value                         | Why                                                                                                  |
| ---------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`     | `8131` (default)              | what the tunnel dials                                                                                |
| `ORIGINS`  | `https://starforge.lacort.ee` | the only public origin allowed on `/wire` (loopback stays allowed; scheme + host must match exactly) |
| `DATA_DIR` | `/data`                       | inside the container, backed by the `relay-data` volume holding SQLite                               |

`ORIGINS` accepts a comma-separated list if a domain needs to answer
on more than one hostname during a migration.

`/etc/systemd/system/starforge-relay.service`:

```ini
[Unit]
Description=starforge relay container
After=docker.service
Requires=docker.service

[Service]
Restart=always
ExecStartPre=-/usr/bin/docker rm -f starforge-relay
ExecStart=docker run --rm --name starforge-relay -p 127.0.0.1:8131:8131 -v relay-data:/data -e ORIGINS=https://starforge.lacort.ee starforge-relay:stable
ExecStop=docker stop starforge-relay

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now starforge-relay
curl -s http://localhost:8131/healthz  # -> {"ok":true}
```

## 3. Tunnel (named, running as a service)

Install once:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

Authenticate and create the named tunnel. `login` is headless
friendly: it prints a URL to open in any browser, you pick the zone
(`lacort.ee`), and the cert lands in `~/.cloudflared/` by itself:

```bash
cloudflared tunnel login
cloudflared tunnel create starforge
```

`create` prints a tunnel UUID and writes `~/.cloudflared/<tunnel-id>.json`.
Write `~/.cloudflared/config.yml` with that UUID:

```yaml
tunnel: starforge
credentials-file: /home/user/.cloudflared/<tunnel-id>.json
ingress:
    - hostname: starforge.lacort.ee
      service: http://localhost:8131
    - service: http_status:404
```

Install as a service

```bash
sudo cloudflared --config /home/user/.cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
systemctl is-active cloudflared  # -> active
```

After install, the service runs from the config it was installed
with (`systemctl cat cloudflared` shows the exact path).

A foreground `cloudflared tunnel run` dies with your SSH session;
never use it for production.

## 4. Route the DNS

Point the hostname at the tunnel:

```bash
cloudflared tunnel route dns starforge starforge.lacort.ee
```

This creates `CNAME starforge.lacort.ee -> <tunnel-id>.cfargotunnel.com`.

## 5. Verify end to end

From anywhere (not the Pi):

```bash
curl -s https://starforge.lacort.ee/healthz  # -> {"ok":true}
curl -s https://starforge.lacort.ee/robots.txt  # -> ends with Sitemap: https://starforge.lacort.ee/sitemap.xml

ROOM=$(curl -s -X POST https://starforge.lacort.ee/api/rooms \
    -H 'content-type: application/json' \
    -d '{"title":"smoke","width":64,"height":64}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -s https://starforge.lacort.ee/api/rooms/$ROOM  # -> {"id":...,"members":0,...}
```

Then in a browser: open the site, press Share, copy the link into a
second window, paint in both, strokes converge and both cursors
show. That is the whole launch test.

## Update (`:next` beside `:stable`)

Build the candidate, run it next to the live container on port `8132`,
and gate on a health check before it touches `:stable`:

```bash
cd ~/starforge && git pull
docker build -f relay/Dockerfile -t starforge-relay:next .
docker run -d --rm --name starforge-relay-next -p 127.0.0.1:8132:8131 -e PORT=8131 -e ORIGINS=https://starforge.lacort.ee starforge-relay:next
curl -s http://localhost:8132/healthz  # -> {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8132/
#
docker stop starforge-relay-next
docker tag starforge-relay:stable starforge-relay:previous
docker tag starforge-relay:next starforge-relay:stable
sudo systemctl restart starforge-relay
curl -s https://starforge.lacort.ee/healthz  # -> {"ok":true}
```

## Rollback

The previous image is never deleted until two updates have succeeded,
so a rollback is just a retag plus a restart:

```bash
docker tag starforge-relay:previous starforge-relay:stable
sudo systemctl restart starforge-relay
curl -s https://starforge.lacort.ee/healthz  # -> {"ok":true}
```

## Backup (SQLite, no downtime)

Rooms live in one file: the `relay.sqlite` inside the `relay-data`
volume. Never copy it with `cp` while the relay runs, back it up
through SQLite's online backup API instead:

```bash
sudo apt-get install -y sqlite3
sudo mkdir -p /var/backups/starforge
sudo sqlite3 /var/lib/docker/volumes/relay-data/_data/relay.sqlite \
    ".backup '/var/backups/starforge/relay-$(date +%F).sqlite'"
sudo sqlite3 /var/backups/starforge/relay-$(date +%F).sqlite 'PRAGMA integrity_check;'
find /var/backups/starforge -name 'relay-*.sqlite' -mtime +7 -delete
```

Nightly via cron (`sudo crontab -e`):

```cron
15 3 * * * sqlite3 /var/lib/docker/volumes/relay-data/_data/relay.sqlite ".backup '/var/backups/starforge/relay-$(date +\%F).sqlite'" && sqlite3 /var/backups/starforge/relay-$(date +\%F).sqlite 'PRAGMA integrity_check;' && find /var/backups/starforge -name 'relay-*.sqlite' -mtime +7 -delete
```

Restore is stop, swap, start, the relay rehydrates rooms and op
tails from the file on boot and drops corrupt rows instead of
resurrecting them:

```bash
sudo systemctl stop starforge-relay
sudo cp /var/backups/starforge/relay-<date>.sqlite /var/lib/docker/volumes/relay-data/_data/relay.sqlite
sudo systemctl start starforge-relay
curl -s https://starforge.lacort.ee/healthz  # -> {"ok":true}
```

## Operational limits

One Pi, one process, one SQLite file. The caps below are constants
in code, not load-test results, past them the relay refuses
instead of degrading:

| Ceiling                 | Value                                     |
| ----------------------- | ----------------------------------------- |
| Rooms per relay         | 100 (least-touched empty room evicted)    |
| Painters per room       | 16 (17th refused with `roomFull`)         |
| Concurrent sockets      | 2048 (excess connections dropped)         |
| Ops per second per conn | 60 (excess answered `rate_limited`)       |
| Bytes per second / conn | 256 KiB (presence over budget is dropped) |
| Room creates per IP     | 20 per hour (`429 too_many_rooms`)        |
| Idle room lifetime      | 14 days untouched, then pruned            |
| Canvas per room         | 16–256 px per side, locked while open     |

That is roughly 1,600 concurrent painters at most. Past that the
answer is a second relay (sharding rooms), not a bigger Pi.
