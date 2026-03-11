# Network Drive Setup — AGROUP (Merch_Conversion)

How to connect to the Jesta IS file server (`srv-fs1.jestais.local`) from a Mac and auto-mount at login.

---

## Prerequisites

- **VPN**: Must be connected to the Jesta network (the file server is internal-only)
- **Credentials**: Your Jesta domain account (same as Windows login)

## File Server Details

| Field | Value |
|-------|-------|
| Server | `srv-fs1.jestais.local` (172.16.30.80) |
| Protocol | SMB (port 445) |
| Share | `AGROUP` |
| Key folder | `AGROUP/Merch_Conversion` |
| Mount point (Mac) | `/Volumes/AGROUP` |

### Other shares on the server

| Drive Letter (Windows) | UNC Path |
|------------------------|----------|
| G: | `\\srv-fs1.jestais.local\AGROUP` |
| I: | `\\srv-fs1.jestais.local\TBS` |
| N: | `\\srv-fs1.jestais.local\clientbuilds` |
| U: | `\\srv-fs1.jestais.local\attachments` |

---

## Quick Connect (One-Time)

### macOS — Finder

1. Connect to VPN
2. Open Finder, press **Cmd+K** (or Go > Connect to Server)
3. Enter: `smb://srv-fs1.jestais.local/AGROUP`
4. Click **Connect**
5. Enter your Jesta domain credentials when prompted
6. Check **"Remember this password in my keychain"** so future connections are automatic

The share mounts at `/Volumes/AGROUP`.

### macOS — Terminal

```bash
open 'smb://srv-fs1.jestais.local/AGROUP'
```

This opens Finder's credential dialog and mounts the share.

### Windows

```
\\srv-fs1.jestais.local\AGROUP
```

Or map a drive letter: right-click This PC > Map Network Drive > folder `\\srv-fs1.jestais.local\AGROUP`.

---

## Auto-Mount at Login (macOS)

The share doesn't persist after reboot by default. Two files handle automatic reconnection:

### 1. Mount script — `~/mount-agroup.sh`

This script waits for VPN connectivity (up to 5 minutes), then mounts the share.

```bash
#!/bin/bash
# Wait for VPN / connectivity to srv-fs1, then mount AGROUP share
MAX_WAIT=300  # wait up to 5 minutes
ELAPSED=0

while ! ping -c 1 -t 2 srv-fs1.jestais.local &>/dev/null; do
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        osascript -e 'display notification "Could not reach srv-fs1 after 5 min. Connect VPN and run manually." with title "AGROUP Mount Failed"'
        exit 1
    fi
done

# Check if already mounted
if mount | grep -q '/Volumes/AGROUP'; then
    exit 0
fi

# Mount via Finder (uses saved Keychain credentials)
open 'smb://srv-fs1.jestais.local/AGROUP'
```

Make it executable:

```bash
chmod +x ~/mount-agroup.sh
```

### 2. LaunchAgent — `~/Library/LaunchAgents/com.jestais.mount-agroup.plist`

Runs the mount script automatically at login.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jestais.mount-agroup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/YOUR_USERNAME/mount-agroup.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/mount-agroup.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/mount-agroup.log</string>
</dict>
</plist>
```

> Replace `YOUR_USERNAME` with your macOS username.

Load the agent (one-time):

```bash
launchctl load ~/Library/LaunchAgents/com.jestais.mount-agroup.plist
```

### How it works

1. At login, macOS runs `mount-agroup.sh`
2. The script polls `srv-fs1.jestais.local` every 5 seconds
3. Once the server is reachable (VPN is up), it mounts via Finder
4. Finder uses credentials saved in Keychain (no password prompt)
5. If the server isn't reachable after 5 minutes, a macOS notification appears

### Logs

Check mount log output:

```bash
cat /tmp/mount-agroup.log
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "There was a problem connecting" | Check VPN is connected. Verify with `ping srv-fs1.jestais.local` |
| Password prompt every time | Re-save credentials: Finder > Cmd+K > connect > check "Remember this password in my keychain" |
| Mount doesn't appear after reboot | Check LaunchAgent is loaded: `launchctl list | grep mount-agroup` |
| Script runs but nothing mounts | Check log: `cat /tmp/mount-agroup.log`. May need to re-save Keychain credentials |
| "Could not reach srv-fs1 after 5 min" notification | VPN didn't connect in time. Connect VPN manually, then run `~/mount-agroup.sh` |
| Want to unmount | Eject in Finder, or `umount /Volumes/AGROUP` |
| Want to disable auto-mount | `launchctl unload ~/Library/LaunchAgents/com.jestais.mount-agroup.plist` |

## Accessing from the Server (SSH)

When SSH'd into `srv-test-docker-musa` (172.16.30.77), Windows drive letters (G:, I:, etc.) show as "Unavailable". Use UNC paths instead:

```powershell
# List contents
dir "\\srv-fs1.jestais.local\AGROUP\Merch_Conversion"

# Copy a file
copy "\\srv-fs1.jestais.local\AGROUP\Merch_Conversion\somefile.xlsx" C:\temp\
```
