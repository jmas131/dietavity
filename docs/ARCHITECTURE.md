# Dietavity Architecture

**Last Updated:** July 2026

## Overview

Dietavity is a WhatsApp-based AI nutrition assistant focused on longevity. Users interact with Dietavity through WhatsApp to receive personalized meal plans, recipes, ingredient swaps, restaurant recommendations, and nutrition guidance inspired by regions with the highest life expectancy.

The current architecture prioritizes reliability, simplicity, and rapid iteration by using n8n as the orchestration layer.

---

# High-Level Architecture

```
User
   │
   ▼
WhatsApp (Twilio)
   │
   ▼
n8n Workflows
   │
   ├── OpenAI
   ├── Supabase
   ├── Stripe
   └── Node.js Website
```

The public website is independent from the AI workflows.

---

# Tech Stack

## Backend

- Node.js
- Express

## Frontend

- EJS
- HTML
- CSS
- Vanilla JavaScript

## Database

- Supabase (PostgreSQL)

## AI

- OpenAI API

## Automation

- n8n

## Messaging

- Twilio WhatsApp API

## Payments

- Stripe Checkout

## Hosting

- Ubuntu VPS
- Nginx
- PM2

---

# Repository Structure

```
dietavity/

├── server.js
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
│
├── public/
│   ├── css/
│   ├── images/
│   └── js/
│
├── views/
│   ├── home.ejs
│   ├── plan.ejs
│   ├── setup.ejs
│   ├── success.ejs
│   ├── cancel.ejs
│   └── service-features.ejs
│
├── database/
│   └── dietavity-database-schema.sql
│
├── n8n/
│   ├── Dietavity live 2.1.0 - Loki.json
│   ├── Global Error Handler.json
│   └── Dietavity Weekly Report.json
│
├── docs/
└── archive/
```

---

# Responsibilities

## Node.js Website

Responsible for:

- Landing page
- Service information
- Setup portal
- Success page
- Cancel page
- PWA assets
- Dynamic manifest generation

Business logic is intentionally kept minimal.

---

## n8n

Responsible for:

- Receiving WhatsApp messages
- AI prompt construction
- OpenAI communication
- Subscription validation
- Meal plan generation
- Weekly updates
- Shopping lists
- Database operations
- Twilio messaging
- Stripe integration

n8n is currently the application's orchestration layer.

---

## Supabase

Stores:

- Users
- Preferences
- Conversations
- Meal plans
- Meal history
- Subscriptions
- Onboarding state

Supabase is the system of record.

---

## OpenAI

Responsible for generating:

- Meal plans
- Recipes
- Ingredient swaps
- Nutrition advice
- Restaurant recommendations
- Follow-up responses

OpenAI does not store application state.

---

# Design Principles

- Keep business logic inside n8n during the MVP.
- Keep the Node.js website lightweight.
- Use Supabase as the single source of truth.
- Keep prompts centralized inside n8n.
- Prioritize launch without sacrificing reliability.
- Prefer incremental improvements over major rewrites.

---

# Future Evolution

After the MVP launch, business logic may gradually migrate from n8n into dedicated Node.js modules if doing so improves maintainability, testing, or scalability.

Until then, n8n remains the primary orchestration layer.

---

# Source of Truth

| Component | Source of Truth |
|-----------|-----------------|
| User data | Supabase |
| Meal plans | Supabase |
| Conversations | Supabase |
| Payments | Stripe |
| WhatsApp messages | Twilio |
| Workflow automation | n8n |
| Website | Node.js / Express |
| AI generation | OpenAI |

---

# Development Philosophy

The project follows these principles:

1. Launch before optimizing.
2. Keep the architecture simple.
3. Avoid unnecessary abstractions.
4. Prefer stability over novelty.
5. Refactor only when justified by real product needs.