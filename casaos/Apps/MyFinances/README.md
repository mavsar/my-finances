# My Finances CasaOS Package

CasaOS AppStore-style package for the My Finances personal finance app.

## Install option 1: CasaOS Custom Install (UI)

1. Open CasaOS → **App Store** → **Custom Install**.
2. Copy the contents of `docker-compose.yml` from this folder.
3. Paste into CasaOS and set your credentials before installing.

## Install option 2: CasaOS CLI

```bash
casaos-cli app-management install -f /DATA/AppData/my-finances/casaos/Apps/MyFinances/docker-compose.yml
```

## Credentials

Set these environment variables before first start:

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_USERNAME` | `admin` | Login username |
| `AUTH_PASSWORD` | `changeme` | Login password — **change this** |
| `JWT_SECRET` | `change-this-secret` | JWT signing secret — **change this** |

## Upgrading

Update the image tag in `docker-compose.yml`:

```yaml
image: ghcr.io/mavsar/my-finances:vX.Y.Z
```
