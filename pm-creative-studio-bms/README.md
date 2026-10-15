# PM Creative Studio — Business Suite

Inventory, point of sale, expenses, suppliers, staff and reports. Static frontend + Supabase (Auth, Postgres, Row-Level Security). No server to maintain.

```
public/
  index.html        page structure
  css/styles.css    design tokens, layout, components, motion, responsive rules
  js/config.js      your Supabase URL + anon key (only file you edit)
  js/api.js         Supabase client and data helpers
  js/app.js         screens and behaviour
supabase/migrations/001_schema.sql   tables, security policies, sale/stock functions
```

## Setup (about 5 minutes)

1. Create a project at supabase.com.
2. **SQL Editor → New query**, paste `supabase/migrations/001_schema.sql`, click **Run**.
3. **Project Settings → API**: copy the Project URL and the `anon` public key into `public/js/config.js`.
4. **Authentication → Providers → Email**: for instant sign-up turn off "Confirm email" (or keep it on; users confirm by email, then sign in).
5. **Authentication → URL Configuration**: set Site URL to where you host the app.
6. Run locally with `npm start` (http://localhost:3000), or deploy the `public` folder to Vercel/Netlify/Cloudflare Pages.

## How accounts work
- **New workspace**: first user becomes OWNER of a new business.
- **Staff**: Owner/Admin invites an email under Staff. The person chooses **Join team** and sets their own password.
- Roles: OWNER (everything) · ADMIN (stock, staff, reports, settings) · EMPLOYEE (sales, expenses, suppliers, view inventory).

## Security notes
- Every table is protected by Row-Level Security; a business can only ever see its own rows.
- Sales totals, prices and stock changes are calculated inside the database in one transaction. The browser cannot set prices or edit stock directly.
- Never put the `service_role` key in this project.
