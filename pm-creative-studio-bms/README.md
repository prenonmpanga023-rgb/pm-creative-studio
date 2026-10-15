# PM Creative Studio — Business Suite

Inventory, point of sale, expenses, suppliers, staff and reports. Static frontend + Supabase (Auth, Postgres, Row-Level Security). No server to maintain.

```
public/
  index.html        page structure
  css/styles.css    design tokens, layout, components, motion, responsive rules
  js/config.js      your Supabase URL + anon key (only file you edit)
  js/api.js         Supabase client and data helpers
  js/app.js         screens and behaviour
supabase/migrations/001_schema.sql            tables, security policies, sale/stock functions
  supabase/migrations/002_shop_orders_audit.sql customer shop, orders, audit log
```

## Setup (about 5 minutes)

1. Create a project at supabase.com.
2. **SQL Editor → New query**: run `001_schema.sql`, then run `002_shop_orders_audit.sql` (in that order).
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

## Email setup (required for emails to actually arrive)
The app sends confirmation, password-reset and staff-invitation emails through Supabase Auth. Supabase's built-in mailer only delivers to your own team members and is limited to a few emails per hour, so real users will not receive anything until you add your own SMTP provider:

1. Create a free account with an email service (Resend, Brevo, SendGrid, Mailgun, or Gmail with an app password) and verify your sender address or domain.
2. **Supabase → Authentication → Emails → SMTP Settings**: enable custom SMTP and enter host, port, username, password and sender name ("PM Creative Studio").
3. **Authentication → URL Configuration**: set **Site URL** to your live address and add it (and `http://localhost:3000`) under **Redirect URLs**. Links in emails will not work without this.
4. **Authentication → Emails → Templates**: edit "Confirm signup", "Reset password" and "Magic link" (used for staff invitations) with your own wording.

What is wired in the app: forgot password, resend confirmation, invitation email with "Resend email" button, and a set-your-password prompt for people who arrive from an invitation or reset link.

## Customer shop and orders
Each business has a shop code (Company settings). Customers open `your-site/?shop=your-code`, create a customer account, and place orders. Staff approve or reject under **Orders**; approving deducts stock and records a sale with a receipt. Customers only ever see names, prices and availability, never cost prices or other businesses' data.

## Audit log
Owners and administrators see who changed products, stock, expenses, staff access, sales and orders under **Audit log**.

Not included yet: customer email notifications when an order is approved (customers see the status in My orders).
