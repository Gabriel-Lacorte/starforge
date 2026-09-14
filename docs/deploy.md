# Deploy the relay on a Pi

One container serves the client bundle, the room API, and the
WebSocket relay on `8131`.

The relay drains connections on `SIGTERM` / `SIGINT` so rollouts do
not drop flying ops.

## 1. Pi Prep

On Raspberry Pi OS (64-bit):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group applies, then build from
the repo root (the context must be the root: the Dockerfile
references `client/` and the root lockfile):

```bash
docker build -f relay/Dockerfile -t starforge-relay:stable .
```

## 2. Run the relay

| Variable   | Value                            | Why                                                                                                  |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`     | `8131` (default)                 | what the tunnel dials                                                                                |
| `ORIGINS`  | `https://starforge.lacorte.city` | the only public origin allowed on `/wire` (loopback stays allowed; scheme + host must match exactly) |
| `DATA_DIR` | `/data`                          | inside the container, backed by the `relay-data` volume holding SQLite                               |

`/etc/systemd/system/starforge-relay.service`:

```ini
[Unit]
Description=starforge relay container
After=docker.service
Requires=docker.service

[Service]
Restart=always
ExecStartPre=-/usr/bin/docker rm -f starforge-relay
ExecStart=docker run --rm --name starforge-relay -p 127.0.0.1:8131:8131 -v relay-data:/data -e ORIGINS=https://starforge.lacorte.city starforge-relay:stable
ExecStop=docker stop starforge-relay

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now starforge-relay
curl -s http://localhost:8131/healthz  # -> {"ok":true}
```

The port binds to loopback only: the relay is never exposed
directly, only through the tunnel in step 3.

## 3. Tunnel (named, running as a service)

Install once:

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

Create the named tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create starforge
```

Write `~/.cloudflared/config.yml` (replace `<tunnel-id>` with the id
printed by `create`):

```yaml
tunnel: starforge
credentials-file: /home/pi/.cloudflared/<tunnel-id>.json
ingress:
    - hostname: starforge.lacorte.city
      service: http://localhost:8131
    - service: http_status:404
```

Run it as a service so it survives reboots (foreground `tunnel run`
dies with your SSH session, do not use it for production):

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
systemctl is-active cloudflared  # -> active
```

## 4. Repoint the DNS

Point the domain at the tunnel, replacing the Vercel CNAME:

```bash
cloudflared tunnel route dns starforge starforge.lacorte.city
```

This creates `CNAME starforge.lacorte.city -> <tunnel-id>.cfargotunnel.com`.
Verify propagation (up to a few minutes):

```bash
dig +short starforge.lacorte.city  # -> <tunnel-id>.cfargotunnel.com
```

## 5. Verify end to end

From anywhere (not the Pi):

```bash
curl -s https://starforge.lacorte.city/healthz  # -> {"ok":true}
curl -s https://starforge.lacorte.city/robots.txt | head -1  # -> User-agent: *

ROOM=$(curl -s -X POST https://starforge.lacorte.city/api/rooms \
    -H 'content-type: application/json' \
    -d '{"title":"smoke","width":64,"height":64}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -s https://starforge.lacorte.city/api/rooms/$ROOM  # -> {"id":...,"members":0,...}
```

Then in a browser: open the site, press Share, copy the link into a
second window, paint in both, strokes converge and both cursors
show. That is the whole launch test.

## Update (`:next` beside `:stable`)

Build the candidate, run it next to the live container on port `8132`,
and gate on a health check plus one hello/welcome round-trip before it
touches `:stable`:

```bash
docker build -f relay/Dockerfile -t starforge-relay:next .
docker run -d --name starforge-relay-next -p 127.0.0.1:8132:8131 -e PORT=8131 -e ORIGINS=https://starforge.lacorte.city starforge-relay:next
curl -s http://localhost:8132/healthz  # -> {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8132/
#
docker stop starforge-relay-next
docker tag starforge-relay:stable starforge-relay:previous
docker tag starforge-relay:next starforge-relay:stable
sudo systemctl restart starforge-relay
curl -s https://starforge.lacorte.city/healthz  # -> {"ok":true}
```

## Rollback

The previous image is never deleted until two updates have succeeded,
so a rollback is just a retag plus a restart:

```bash
docker tag starforge-relay:previous starforge-relay:stable
sudo systemctl restart starforge-relay
curl -s https://starforge.lacorte.city/healthz  # -> {"ok":true}
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
curl -s https://starforge.lacorte.city/healthz  # -> {"ok":true}
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

## Changing domain

The relay reads its public base from `ORIGINS`, so `robots.txt` and
`sitemap.xml` follow automatically. Everything else is static text —
search and update in this order:

1. `ORIGINS=https://<new-domain>` in the systemd unit, then
   `daemon-reload` + `restart starforge-relay`.
2. Tunnel `config.yml` hostname + `cloudflared tunnel route dns
starforge <new-domain>`.
3. `client/index.html`: `canonical`, `og:url`, `og:image`, JSON-LD `url`.
4. `client/src/About.tsx`: `ORIGIN`.
5. Rebuild (`docker build ... :next`), verify `/healthz` + Share on the
   new domain, then promote to `:stable`.

## Troubleshooting

| Symptom                                   | Cause                                                             | Fix                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Share answers `invalid room (404)`        | domain still serves static files (Vercel) with no relay behind it | finish steps 3–4; `curl .../healthz` must print `{"ok":true}`                       |
| Joining hangs, then "Still trying"        | relay down, or page origin not in `ORIGINS`                       | `systemctl is-active starforge-relay`; `ORIGINS` must equal the page origin exactly |
| Room not found after a restart            | `DATA_DIR` not on the `relay-data` volume                         | check `-v relay-data:/data` and that the volume holds `relay.sqlite`                |
| Tunnel works, then dies on reboot         | `tunnel run` was foreground instead of the service                | step 3 service install; `systemctl is-active cloudflared`                           |
| `Conflicting options: --restart and --rm` | modern Docker rejects both flags together                         | drop `--restart` (systemd `Restart=always` already covers it)                       |
