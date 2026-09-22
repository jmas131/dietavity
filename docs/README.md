# Dietavity n8n

This directory contains the exported n8n workflows that power Dietavity.

These workflow files are version-controlled and should always reflect the production implementation.

---

# Purpose

n8n is the orchestration layer of Dietavity.

It coordinates communication between:

- Twilio WhatsApp API
- OpenAI API
- Supabase
- Stripe
- Node.js Website

---

# Workflow Files

## Dietavity live 2.1.0 - Loki.json

Main production workflow.

Responsibilities:

- Receive WhatsApp messages
- Detect onboarding state
- Validate subscriptions
- Process user requests
- Generate AI responses
- Store conversation history
- Update Supabase
- Send WhatsApp replies

---

## Global Error Handler.json

Handles unexpected workflow failures.

Responsibilities:

- Centralized error handling
- Logging
- Graceful recovery where possible

---

## Dietavity Weekly Report.json

Scheduled workflow.

Responsibilities:

- Generate weekly operational metrics
- Produce platform reports

---

# Importing Workflows

1. Open the n8n Editor.
2. Select **Import Workflow**.
3. Choose the appropriate JSON file.
4. Verify credentials.
5. Activate the workflow.
6. Run a test execution.

---

# Required Credentials

Each n8n instance must be configured with valid credentials for:

- OpenAI
- Supabase
- Twilio
- Stripe

Credentials are managed through the n8n Credentials system.

Never store secrets directly inside workflow nodes.

---

# Versioning

Whenever a production workflow changes:

1. Export the updated workflow.
2. Replace the corresponding JSON file in this directory.
3. Commit the changes to Git.
4. Deploy the updated workflow to production.

The repository should always contain the latest production version.

---

# Development Guidelines

- Use descriptive node names.
- Keep workflows organized into logical sections.
- Remove disabled or obsolete nodes before exporting.
- Document complex Function/Code nodes with comments.
- Reuse sub-workflows when practical.
- Test every workflow before deployment.

---

# Testing Checklist

Before exporting a workflow, verify:

- Workflow executes successfully.
- OpenAI requests complete successfully.
- Supabase operations succeed.
- WhatsApp messages are delivered.
- Stripe integration works correctly.
- Error handling behaves as expected.

---

# Source of Truth

Production should always match the latest committed workflow files.