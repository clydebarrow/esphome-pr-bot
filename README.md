# ESPHome PR Bot

A Cloudflare Worker that acts as a GitHub App to help users test PRs in the ESPHome repository. It automatically comments on PRs with instructions for using changed components or cloning the repository.

## Features

- Detects component changes in PRs by monitoring the `esphome/components/` directory
- Provides instructions for using changed components as external components
- Provides repository clone instructions for non-component changes
- Updates existing comments when PRs are updated
- Verifies GitHub webhook signatures for security

## Setup

1. Create a GitHub App:
   - Go to GitHub Developer Settings > GitHub Apps > New GitHub App
   - Set webhook URL to your Cloudflare Worker URL
   - Generate and save a webhook secret
   - Generate and download a private key
   - Grant these permissions:
     - Pull Requests: Read & Write
     - Contents: Read-only
   - Subscribe to "Pull request" events
   - Install the app on the esphome/esphome repository
   - Note the App ID and Installation ID

2. Deploy to Cloudflare:
   ```bash
   # Install dependencies
   npm install

   # Configure secrets in Cloudflare dashboard
   npx wrangler secret put WEBHOOK_SECRET
   npx wrangler secret put APP_ID
   npx wrangler secret put PRIVATE_KEY
   npx wrangler secret put APP_KEY

   # Deploy
   npx wrangler deploy
   ```

3. Update the GitHub App webhook URL with your deployed worker URL

## Development

```bash
# Run locally
  npx wrangler dev
```

## License

MIT
