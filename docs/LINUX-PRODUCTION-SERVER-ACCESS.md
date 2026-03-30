# Linux Production Server Access

This repository intentionally omits the live production hostname, IP address, username, and any reusable direct-login command.

Retrieve the current connection details from the approved secret store or the private ops runbook before connecting.

## Access Workflow

1. Retrieve the current production host, username, and authentication method from the approved secret store.
2. Verify that the target is the active MyReports production Linux host.
3. Connect with standard SSH using normal host-key verification.
4. Avoid storing passwords, static SSH command lines, or copied connection details in the repository.

## Example Command Shape

```bash
ssh <production-user>@<production-host>
```

Quick verification:

```bash
ssh <production-user>@<production-host> 'hostname && whoami && uname -a'
```

## Docker / MyReports Checks

List running containers:

```bash
ssh <production-user>@<production-host> 'docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"'
```

Check MyReports logs:

```bash
ssh <production-user>@<production-host> 'docker logs myreports --tail=120 2>&1'
```

Check the currently running MyReports image:

```bash
ssh <production-user>@<production-host> 'docker inspect myreports --format "{{.Image}}|{{.Created}}|{{.State.StartedAt}}|{{.Config.Image}}"'
```

## Current Production Notes

- MyReports production runs on a Linux Docker host.
- The host typically runs the `myreports` container and supporting infrastructure such as an update watcher.
- The old Windows host is not the production source of truth for MyReports.
