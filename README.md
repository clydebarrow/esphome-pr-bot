# ESPHome PR Bot

A Cloudflare Worker that acts as a GitHub App to help users test PRs in the ESPHome repository. It automatically
comments on PRs with instructions for using changed components or cloning the repository.

The app is publicly available and can be used by anyone. It is designed to work with the ESPHome GitHub repository, but
will work with any repository that has a similar structure.

When a PR is opened or updated, the app checks for changes in the `esphome/components/` directory. If any components
have changed, it provides instructions for using those components as external components. If there have been core changes
which prevent the use of external components, it provides instructions for cloning the repository and testing the PR locally.
The instructions are added as a comment to the PR, and will be updated each time a commit is pushed to the PR branch.

## Installation

To install this app on a repository, visit this url: https://github.com/apps/esphome-pr-external-components

It will request the following permissions:
- Pull Requests: Read & Write

## Features

- Detects component changes in PRs by monitoring the `esphome/components/` directory
- Provides instructions for using changed components as external components
- Provides repository clone instructions for non-component changes
- Updates existing comments when PRs are updated
- Verifies GitHub webhook signatures for security

## Building your own version (not required just to install the app on a repository)

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
