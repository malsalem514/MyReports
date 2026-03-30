# Linux Production Server Access

This is the current MyReports production host.

## Server

| Field | Value |
|---|---|
| Hostname | `ubuntu-docker-host` |
| IP | `172.16.20.97` |
| OS | `Ubuntu Linux` |
| User | `admin` |
| Credentials | Retrieve from the approved secret store or IT owner. Do not store passwords in this repo. |

## Recommended SSH Login

Use interactive SSH and verify the host key normally:

```bash
ssh admin@172.16.20.97
```

If password auth is still required for automation, retrieve the password from the approved secret store at runtime and inject it locally. Do not hardcode it in commands, shell history, scripts, or repository docs.

## Quick Connection Test

```bash
ssh admin@172.16.20.97 'hostname && whoami && uname -a'
```

Expected host:

```text
ubuntu-docker-host
admin
```

## Docker / MyReports Checks

List running containers:

```bash
ssh admin@172.16.20.97 'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"'
```

Check MyReports logs:

```bash
ssh admin@172.16.20.97 'docker logs myreports --tail=120 2>&1'
```

Check the currently running MyReports image:

```bash
ssh admin@172.16.20.97 'docker inspect myreports --format "{{.Image}}|{{.Created}}|{{.State.StartedAt}}|{{.Config.Image}}"'
```

## Current Production Notes

- `myreports.jestais.com` currently resolves to `172.16.20.97`
- the production host runs `myreports` and `watchtower`
- this Linux host is the real production runtime for MyReports
- the old Windows host at `172.16.30.77` is no longer the MyReports production host
