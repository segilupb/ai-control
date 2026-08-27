# Phone alerts with ntfy — full setup guide

AI Control can push a notification to your phone when an AI finishes a task or
needs your attention. It's **off by default** and there are two modes:

| Mode | Where the alert travels | Works outside your Wi-Fi | Setup |
|---|---|---|---|
| **A — ntfy.sh** | Through the public ntfy.sh relay | ✅ Yes | 3 minutes |
| **B — Your own LAN server** | PC → router → phone, never leaves your network | ❌ No | ~15 minutes |

> **Android works great. iOS does not.** The ntfy Android app keeps a persistent
> connection, which is what makes LAN mode instant. iOS blocks background
> connections, so on iPhone use mode A only — and expect some delay.

---

## Mode A — ntfy.sh (easiest)

1. **Phone:** install **ntfy** from the Play Store (free, no account needed).
2. **Extension:** Options → *Phone alerts (ntfy)*
   - Server: `https://ntfy.sh` (the default)
   - Press **Generate** to create a secret topic (e.g. `ai-control-x7km2p...`)
   - Turn on **Send alerts to my phone**
3. **Phone:** in the ntfy app → **+** → *Subscribe to topic* → paste the exact topic.
4. **Extension:** press **📱 Send test to phone**. It should buzz within seconds.

### Privacy note
This is the one opt-in exception to AI Control's local-first design: the alert
passes through ntfy.sh's servers. By default only a generic *"A task has
finished"* is sent — including the conversation title is a **separate** toggle,
and conversation content is never sent under any setting.

Your topic is your address: **anyone who knows it can read your alerts.** Use
the generated random one, don't invent a short one.

---

## Mode B — Your own server on your LAN (nothing leaves your network)

You run the ntfy server on your own PC. The phone talks to it directly over
Wi-Fi. No internet involved at all.

### B1. Run the server (Windows)

1. Download the Windows binary from
   [ntfy releases](https://github.com/binwiederhier/ntfy/releases) →
   `ntfy_x.y.z_windows_amd64.zip`.
2. Extract it to a permanent folder, e.g. `C:\ntfy\` → you should have `C:\ntfy\ntfy.exe`.
3. Test it. Open PowerShell:
   ```powershell
   C:\ntfy\ntfy.exe serve --listen-http 0.0.0.0:8080
   ```
   Leave that window open, then browse to `http://localhost:8080` on the same PC.
   You should see the ntfy web interface.

> **`0.0.0.0:8080` matters.** Binding to `:8080` alone can leave the server
> listening only on localhost, and your phone will time out.

### B2. Open the firewall port

PowerShell **as Administrator**, once:

```powershell
New-NetFirewallRule -DisplayName "ntfy local" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Then check that your network is classified as **Private** (otherwise the rule
doesn't apply):

```powershell
Get-NetConnectionProfile
```

If `NetworkCategory` says `Public`, change it in Windows Settings → Network →
your connection → Network profile → **Private**.

### B3. Find your PC's IP and pin it

```powershell
ipconfig | findstr IPv4
```

Note the address (e.g. `192.168.1.50`). Then, in your **router's admin page**
(usually `192.168.1.1`), find **DHCP → Address Reservation** and bind that IP to
your PC. Without this, the router may hand your PC a different IP and alerts
silently stop.

### B4. Verify from the phone

On the phone (same Wi-Fi), open a browser and go to `http://YOUR-IP:8080`.
If you see the ntfy interface, the network path works. If it times out, revisit
B1 (is the server actually listening?), B2 (firewall/profile) and check that
both devices are really on the same network.

### B5. Allow the local address in the extension

Chromium extensions can't request permission for arbitrary local addresses at
runtime, so add yours to `manifest.json` and reload the extension:

```json
"host_permissions": [
  "https://claude.ai/*",
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://gemini.google.com/*",
  "https://ntfy.sh/*",
  "http://192.168.1.50/*"        ← your IP, WITHOUT the port
]
```

> The permission pattern must **not** include the port (Chrome match patterns
> don't support ports), but the Server field in Options **must** include it.

### B6. Configure and test

- Options → Server: `http://192.168.1.50:8080` (your IP, **with** port)
- Press **Generate** for a topic, turn on **Send alerts to my phone**
- Phone → ntfy app → ⚙ Settings → **Default server** → `http://192.168.1.50:8080`
- Phone → **+** → Subscribe to topic → paste the topic
- In the subscription, enable **Instant delivery** and accept the battery
  optimisation exemption when Android asks. Without it Android kills the
  connection and alerts stop arriving.
- Extension → **📱 Send test to phone**

---

## Autostart the server on Windows (so you never think about it again)

Right now ntfy dies when you close the PowerShell window. Fix it with Task
Scheduler:

1. **Win+R** → `taskschd.msc` → Enter
2. Right panel → **Create Task…** (not "Basic Task" — you need the full options)

**General tab**
- Name: `ntfy`
- ✅ **Run whether user is logged on or not** ← this is what hides the console window
- ✅ Do not store password

**Triggers tab** → New → Begin the task: **At log on** → OK

**Actions tab** → New
- Action: Start a program
- Program: `C:\ntfy\ntfy.exe`
- Arguments: `serve --listen-http 0.0.0.0:8080`

**Conditions tab**
- ❌ Uncheck *Start the task only if the computer is on AC power* (laptops)

**Settings tab**
- ❌ **Uncheck "Stop the task if it runs longer than 3 days"** ← critical, or
  Windows kills your server after 3 days
- ✅ If the task is already running: **Do not start a new instance**

3. OK, enter your Windows password when prompted.

### Verify without rebooting
Close the PowerShell window running ntfy, then right-click the `ntfy` task →
**Run**. Check:

```powershell
netstat -an | findstr 8080
```

`0.0.0.0:8080 ... LISTENING` means it's running headless. A line like
`192.168.1.50:8080  192.168.1.8:39790  ESTABLISHED` means **your phone is
connected right now** — that's the ideal state.

Finally, reboot and run that command again to confirm it survives restarts.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `netstat` shows nothing on 8080 | Server not running: the window was closed, or the scheduled task didn't start |
| Test says "sent" but nothing arrives | Phone not subscribed, wrong topic, or Instant delivery / battery optimisation off |
| Phone browser times out on `http://IP:8080` | Firewall rule missing, network profile is Public, or server bound to localhost only |
| Worked before, stopped after a reboot | Router gave the PC a new IP → set the DHCP reservation (B3) |
| A browser VPN extension intercepts local addresses | Exclude your LAN range in the VPN, or use mode A |
| Alerts stop after an Android update | Battery optimisation got re-enabled for ntfy |
