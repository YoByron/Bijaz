---
name: bijaz-deploy
description: Deploy Thufir/Bijaz updates by committing and pushing to GitHub, then SSHing into nmcdc@77.42.29.26 to run /opt/bijaz/scripts/update.sh and restart the thufir service. Use when the user asks to deploy, update the server, restart thufir, or run the bijaz update script.
---

# Bijaz Deploy

## Workflow

### 1. Prep (Local)

- Ensure working tree is clean enough to deploy.
- Run build/tests when relevant:
  - `pnpm build`
  - `pnpm exec vitest run`

### 2. Commit + Push (Local)

- Create commits as appropriate, then `git push`.

### 3. SSH Connectivity (No Password Prompts)

This workflow assumes SSH key auth works. If SSH prompts for a password, do not attempt to proceed non-interactively.

- Confirm the local public key:
  - `cat ~/.ssh/id_ed25519.pub`
- Add it to the server user:
  - Append the key to `~/.ssh/authorized_keys` on `nmcdc@77.42.29.26`

### 4. Deploy (Remote)

Repo on server: `/opt/bijaz`

Run the update script:
```bash
ssh -tt -o StrictHostKeyChecking=accept-new nmcdc@77.42.29.26 'cd /opt/bijaz && bash scripts/update.sh'
```

Note: `scripts/update.sh` runs `sudo systemctl restart thufir` (and may restart `openclaw-gateway` and `llm-mux` if present). If `sudo` prompts for a password, one of these must be true:
- an operator is present to type the sudo password interactively, or
- sudo is configured with NOPASSWD for the relevant `systemctl restart/status` commands.

### 5. Post-Deploy Checks (Remote)

Check service status/logs:
```bash
ssh -tt nmcdc@77.42.29.26 'sudo systemctl status thufir --no-pager'
ssh -tt nmcdc@77.42.29.26 'sudo journalctl -u thufir -n 200 --no-pager'
```
