# Deploy the relay on a Pi

One container serves the relay API plus the production client bundle. It
listens on `8131`, reads `PORT` / `ORIGINS` / `DATA_DIR` from the
environment, and drains connections on `SIGTERM` / `SIGINT` so rollouts
do not drop flying ops.

## Preparation (for Raspberry Pi OS)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group applies, then build from the
repo root (the context must be the root: the Dockerfile references
`client/` and the root lockfile):

```bash
docker build -f relay/Dockerfile -t starforge-relay:stable .
```

## Environment

- `ORIGINS=https://starforge.lacorte.city` — the only public origin
  allowed to open `/wire` WebSockets (loopback origins stay allowed).
- `DATA_DIR=/data` inside the container, backed by the `relay-data` volume with SQLite.

## Tunnel

Use a named tunnel so the hostname survives reboots:

```bash
cloudflared tunnel login
cloudflared tunnel create starforge
cloudflared tunnel route dns starforge starforge.lacorte.city
cloudflared tunnel run starforge
```

with `~/.cloudflared/config.yml` pointing the tunnel at the relay:

```yaml
tunnel: starforge
credentials-file: /home/pi/.cloudflared/<tunnel-id>.json
ingress:
    - hostname: starforge.lacorte.city
      service: http://localhost:8131
    - service: http_status:404
```

Ephemeral / testing only: `cloudflared tunnel --url http://localhost:8131`
prints a one-off hostname — fine for a quick check, but the CNAME breaks
on reboot, so the live room stays on the named tunnel above.

## systemd unit

`/etc/systemd/system/starforge-relay.service`:

```ini
[Unit]
Description=starforge relay container
After=docker.service
Requires=docker.service

[Service]
Restart=always
ExecStartPre=-/usr/bin/docker rm -f starforge-relay
ExecStart=docker run --rm --name starforge-relay --restart unless-stopped -p 127.0.0.1:8131:8131 -v relay-data:/data -e ORIGINS=https://starforge.lacorte.city starforge-relay:stable
ExecStop=docker stop starforge-relay

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now starforge-relay
```

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
