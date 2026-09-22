# Dietavity Setup

This document describes how to set up the Dietavity website on a new Ubuntu VPS.

---

# Requirements

## Operating System

- Ubuntu 24.04 LTS

## Software

- Node.js 20.x
- npm
- PM2
- Nginx
- Git

---

# Clone the Repository

```bash
git clone <repository-url>
cd dietavity
```

---

# Install Dependencies

```bash
npm install
```

---

# Environment Variables

Create a `.env` file in the project root.

Example:

```env
PORT=3000

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

> Never commit `.env` to version control.

---

# Start the Application

For development:

```bash
node server.js
```

For production:

```bash
pm2 start server.js --name dietavity
```

Save the PM2 configuration:

```bash
pm2 save
```

Enable PM2 startup:

```bash
pm2 startup
```

Follow the command displayed by PM2.

---

# Nginx

Configure Nginx as a reverse proxy.

Example:

```nginx
server {

    listen 80;

    server_name your-domain.com;

    location / {

        proxy_pass http://localhost:3000;

        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;

        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;

        proxy_cache_bypass $http_upgrade;

    }

}
```

After updating the configuration:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

# SSL

Install a TLS certificate using Certbot.

Example:

```bash
sudo certbot --nginx
```

---

# Project Structure

```
dietavity/

├── server.js
├── package.json
├── public/
├── views/
├── database/
├── n8n/
└── docs/
```

---

# Static Assets

Public files are located in:

```
public/
```

Includes:

- CSS
- Images
- Client-side JavaScript

---

# Views

Server-rendered pages are located in:

```
views/
```

Current pages:

- home.ejs
- setup.ejs
- plan.ejs
- success.ejs
- cancel.ejs
- service-features.ejs

---

# Database

Dietavity uses Supabase (PostgreSQL).

The database schema is stored in:

```
database/dietavity-database-schema.sql
```

---

# n8n

The website depends on external n8n workflows.

Workflow exports are stored in:

```
n8n/
```

Import them into the target n8n instance before testing the application.

---

# Verify Installation

After deployment, verify:

- Website loads correctly.
- All static assets are served.
- Manifest is generated correctly.
- HTTPS is active.
- Stripe checkout redirects correctly.
- Success and cancel pages load.
- n8n workflows are online.
- Twilio webhook is reachable.
- Supabase connection is working.

---

# Useful Commands

Install dependencies:

```bash
npm install
```

Start server:

```bash
node server.js
```

Start with PM2:

```bash
pm2 start server.js --name dietavity
```

Restart:

```bash
pm2 restart dietavity
```

View logs:

```bash
pm2 logs dietavity
```

Check status:

```bash
pm2 status
```

Reload Nginx:

```bash
sudo systemctl reload nginx
```

Test Nginx configuration:

```bash
sudo nginx -t
```