# Dietavity Deployment

This document describes the standard deployment procedure for updating the Dietavity production environment.

---

# Deployment Checklist

Before deploying, verify:

- All changes have been tested locally.
- The repository is committed.
- Environment variables are up to date.
- Database changes (if any) have been backed up.
- Updated n8n workflows have been exported.

---

# 1. Connect to the Server

```bash
ssh <user>@<server-ip>
```

---

# 2. Navigate to the Project

```bash
cd /var/www/dietavity
```

---

# 3. Update the Repository

```bash
git pull origin main
```

---

# 4. Install Dependencies

If `package.json` changed:

```bash
npm install
```

---

# 5. Restart the Application

```bash
pm2 restart dietavity
```

Verify:

```bash
pm2 status
```

---

# 6. Review Logs

```bash
pm2 logs dietavity
```

Confirm there are no startup errors.

---

# 7. Verify Nginx

If Nginx configuration changed:

```bash
sudo nginx -t
```

Reload:

```bash
sudo systemctl reload nginx
```

---

# 8. Update n8n Workflows

If workflows changed:

1. Open the n8n editor.
2. Import the updated workflow(s) from the `n8n/` directory.
3. Verify credentials.
4. Activate the workflows.
5. Run a test execution.

---

# 9. Database Changes

If the database schema changed:

1. Back up the database.
2. Execute the migration.
3. Verify the affected tables.
4. Confirm existing data remains intact.

---

# 10. Smoke Tests

After deployment, verify:

## Website

- Home page loads.
- Setup page loads.
- Plan page loads.
- Success page loads.
- Cancel page loads.

## Stripe

- Checkout opens successfully.
- Success redirect works.
- Cancel redirect works.

## WhatsApp

- Incoming messages reach n8n.
- Responses are delivered.

## AI

- OpenAI requests succeed.
- Meal plans generate correctly.

## Database

- User records are created or updated.
- Meal plans are stored.
- Conversation history is saved.

---

# Rollback

If deployment fails:

```bash
git checkout <previous-working-commit>
npm install
pm2 restart dietavity
```

Re-import the previous n8n workflow version if necessary.

---

# Useful Commands

Check PM2 status:

```bash
pm2 status
```

Restart application:

```bash
pm2 restart dietavity
```

View logs:

```bash
pm2 logs dietavity
```

Reload Nginx:

```bash
sudo systemctl reload nginx
```

Test Nginx:

```bash
sudo nginx -t
```

Check Node version:

```bash
node -v
```

Check npm version:

```bash
npm -v
```

---

# Deployment Principles

- Deploy small, incremental changes.
- Test immediately after every deployment.
- Keep database migrations reversible whenever possible.
- Export updated n8n workflows after significant changes.
- Never deploy directly to production without prior testing.