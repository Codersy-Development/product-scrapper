# Shopify App Starter - Cloudflare Workers + D1

A free-to-host Shopify App starter template built with Cloudflare Workers, D1 Database, and React Router.

## Why This Template?

**Zero operating costs for new developers!** This template leverages Cloudflare's generous free tier:

- ✅ **Free hosting** on Cloudflare Workers
- ✅ **Generous free tier limits** - perfect for development and small apps
- ✅ **Straightforward setup** - get started in minutes
- ✅ **D1 Database included** - serverless SQL database at no cost
- ✅ **Built for Shopify** - ready for app development

Perfect for developers building their first Shopify app without worrying about hosting costs!

## Features

- 🚀 Server-side rendering with React Router
- 💾 Cloudflare D1 (SQLite) database integration
- ⚡️ Hot Module Replacement (HMR)
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 🌐 Edge deployment with Cloudflare Workers

## Prerequisites

- Node.js 18+ installed
- A Cloudflare account (free tier available)
- Basic familiarity with Shopify app development

## Getting Started

### 1. Installation

Install the dependencies:

```bash
npm install
```

### 2. D1 Database Setup

#### Create a D1 Database

Create your D1 database using Wrangler:

```bash
npx wrangler d1 create shopify-app-db
```

This will output a database ID. Copy the configuration block and add it to your `wrangler.jsonc` file under the `[[d1_databases]]` section.

#### Creating Migrations

To create a new database migration:

```bash
npx wrangler d1 migrations create shopify-app-db <migration-name>
```

For example, to create a sessions table:

```bash
npx wrangler d1 migrations create shopify-app-db create_sessions_table
```

This creates a new SQL file in the `migrations/` folder. Edit the file to add your SQL:

```sql
-- migrations/0001_create_sessions_table.sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  state TEXT NOT NULL,
  isOnline INTEGER NOT NULL DEFAULT 0,
  scope TEXT,
  expires INTEGER,
  accessToken TEXT NOT NULL,
  userId INTEGER
);

CREATE INDEX idx_shop ON sessions(shop);
```

#### Running Migrations

Apply migrations to your local development database:

```bash
npx wrangler d1 migrations apply shopify-app-db --local
```

Apply migrations to production:

```bash
npx wrangler d1 migrations apply shopify-app-db --remote
```

### 3. Development

Start the development server:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

### 4. Database Queries in Development

You can execute SQL queries directly during development:

```bash
# Local database
npx wrangler d1 execute shopify-app-db --local --command="SELECT * FROM sessions"

# Production database
npx wrangler d1 execute shopify-app-db --remote --command="SELECT * FROM sessions"
```

## Deployment

### Build and Deploy

Deploy your app to Cloudflare Workers:

```bash
npm run deploy
```

This will:

1. Build your React application
2. Deploy to Cloudflare Workers
3. Output your production URL

### Preview Deployments

Create a preview deployment:

```bash
npx wrangler versions upload
```

Promote to production:

```bash
npx wrangler versions deploy
```

## Project Structure

```
├── app/                    # React Router application
│   ├── routes/            # Application routes
│   └── entry.server.tsx   # Server entry point
├── workers/               # Cloudflare Workers code
│   └── app.ts            # Worker entry point
├── migrations/           # D1 database migrations
├── public/              # Static assets
└── wrangler.jsonc       # Cloudflare configuration
```

## Next Steps

- [ ] Set up Shopify Partner account
- [ ] Configure Shopify app credentials
- [ ] Implement OAuth flow
- [ ] Create your first Shopify API integration
- [ ] Add webhook handlers

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [D1 Database Docs](https://developers.cloudflare.com/d1/)
- [React Router Docs](https://reactrouter.com/)
- [Shopify App Development](https://shopify.dev/docs/apps)

---

**Created by [Mladen Terzic](https://mladenterzic.com)** | **[Codersy](https://codersy.com)** - Shopify Agency

Built with ❤️ for the Shopify developer community
