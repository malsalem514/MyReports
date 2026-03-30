# Legacy Server Access Notes

This repository no longer stores live hostnames, IP addresses, usernames, or direct access commands for legacy infrastructure.

MyReports production access is handled through the private Linux runbook at [`/Users/musaalsalem/.codex/worktrees/033d/MyReports/docs/LINUX-PRODUCTION-SERVER-ACCESS.md`](/Users/musaalsalem/.codex/worktrees/033d/MyReports/docs/LINUX-PRODUCTION-SERVER-ACCESS.md), and exact connection details must be retrieved from the approved secret store or the system owner at runtime.

## Legacy Windows Host

- This Windows Docker host is obsolete for MyReports production.
- It may still matter for ERPNext history or recovery work.
- Exact connection details are intentionally maintained outside the repo.

## Access Workflow

1. Retrieve the current host, username, and authentication material from the approved secret store or private ops runbook.
2. Confirm with IT whether the legacy host is still the right target for the task.
3. Use your normal local SSH, RDP, or SCP tooling after verifying the host key or certificate.
4. Do not commit connection coordinates, usernames, passwords, or host-key bypass examples back into the repository.

## Operational Note

Historical Windows-specific recovery procedures were intentionally removed from this public code path. If they are needed, request the private operational runbook from the system owner.
