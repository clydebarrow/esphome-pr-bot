import jwt from "@tsndr/cloudflare-worker-jwt";
import {Router, withContent} from 'itty-router';

const { Octokit } = require("@octokit/rest");

const router = Router();

// Verify GitHub webhook signature
async function verifyGitHubWebhook(request, secret) {
  const signature = request.headers.get('x-hub-signature-256');
  const body = await request.clone().text();
  if (!signature) {
    throw new Error('No signature header');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(body)
  );

  const expectedSignature = 'sha256=' + Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return signature === expectedSignature;
}

async function generateJWT(env) {

  const now = Math.floor(Date.now() / 1000);
  return await jwt.sign({
    iat: now, // Issued at
    exp: now + 300, // Expires in 5 minutes
    iss: env.APP_ID, // GitHub App ID
    alg: "RS256",
  }, env.PRIVATE_KEY, {algorithm: 'RS256'});
}

let cachedToken = null;
let tokenExpiresAt = 0;

async function getInstallationToken(env) {

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

// Step 1: Generate JWT
  const jwt = await generateJWT(env)

// Step 2: Authenticate Octokit with the JWT
  const appOctokit = new Octokit({ auth: jwt });

// Step 3: Get Installation ID
  const { data: installations } = await appOctokit.request("GET /app/installations");
  if (installations.length === 0) {
    throw new Error("No installation found for this GitHub App.");
  }
  const installationId = installations[0].id;

// Step 4: Generate Installation Token
  const { data: tokenData } = await appOctokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      { installation_id: installationId }
  );
  const installationToken = tokenData.token;

  cachedToken = installationToken;
    tokenExpiresAt = Date.now() + 1000 * 59 * 60; // less than 1 hour

  return installationToken;
}

// Generate external component usage instructions
function generateExternalComponentInstructions(prNumber, componentNames, owner, repo) {
  let source;
  if (owner === 'esphome' && repo === 'esphome')
    source = `github://pr#${prNumber}`;
  else
    source = `github://${owner}/${repo}@pull/${prNumber}/head`;
  return `To use the changes from this PR as an external component, add the following to your ESPHome configuration YAML file:

\`\`\`yaml
external_components:
  - source: ${source}
    components: [${componentNames.join(', ')}]
    refresh: 1h
\`\`\``;
}

// Generate repo clone instructions
function generateRepoInstructions(prNumber, branch, url) {
  const reponame = url.split('/').filter(Boolean).pop();
  return `To use the changes in this PR:

   \`\`\`bash
   # Clone the repository:
   git clone ${url}
   cd ${reponame}

   # Checkout the PR branch:
   git fetch origin pull/${prNumber}/head:${branch}
   git checkout ${branch}

   # Install the development version:
   script/setup

   # Activate the development version:
   source venv/bin/activate
   \`\`\`

Now you can run \`esphome\` as usual to test the changes in this PR.
`;
}

async function createComment(octokit, pr, esphomeChanges, componentChanges) {
  const commentMarker = "<!-- This comment was generated automatically by a personal bot. -->";
  const [owner, repo] = pr.base.repo.full_name.split('/');
    const prNumber = pr.number;
  let commentBody;
  if (esphomeChanges.length === 1) {
    commentBody = generateExternalComponentInstructions(prNumber, componentChanges, owner, repo);
  } else {
    commentBody = generateRepoInstructions(prNumber, pr.head.ref, pr.base.repo.html_url);
  }
  commentBody += `\n\n---\n(Added by my bot)\n\n${commentMarker}`;

  // Check for existing bot comment
  const comments = await octokit.rest.issues.listComments({
    owner: owner,
    repo: repo,
    issue_number: prNumber,
  });

  const botComment = comments.data.find(comment =>
      comment.body.includes(commentMarker)
  );

  if (botComment && botComment.body === commentBody) {
    // No changes in the comment, do nothing
    return;
  }

  if (botComment) {
    // Update existing comment
    await octokit.rest.issues.updateComment({
      owner: owner,
      repo: repo,
      comment_id: botComment.id,
      body: commentBody,
    });
  } else {
    // Create new comment
    await octokit.rest.issues.createComment({
      owner: owner,
      repo: repo,
      issue_number: prNumber,
      body: commentBody,
    });
  }
}

async function getEsphomeAndComponentChanges(octokit, owner, repo, prNumber) {
  const changedFiles = await octokit.rest.pulls.listFiles({
    owner: owner,
    repo: repo,
    pull_number: prNumber,
  });

  const esphomeChanges = changedFiles.data
      .filter(file => file.filename.startsWith('esphome/'))
      .map(file => {
        const match = file.filename.match(/esphome\/([^/]+)/);
        return match ? match[1] : null;
      })
      .filter(it => it !== null);

  if (esphomeChanges.length === 0) {
    return { esphomeChanges: [], componentChanges: [] };
  }

  const uniqueEsphomeChanges = [...new Set(esphomeChanges)];
  const componentChanges = changedFiles.data
      .filter(file => file.filename.startsWith('esphome/components/'))
      .map(file => {
        const match = file.filename.match(/esphome\/components\/([^/]+)\//);
        return match ? match[1] : null;
      })
      .filter(it => it !== null);

  return { esphomeChanges: uniqueEsphomeChanges, componentChanges: [...new Set(componentChanges)] };
}

// Handle PR events
async function handlePullRequest(env, event, octokit) {
  const [owner, repo] = event.repository.full_name.split('/');
  const pr = event.pull_request;
  const prNumber = pr.number;

  // Get changes in the PR
  const {esphomeChanges, componentChanges} = await getEsphomeAndComponentChanges(octokit, owner, repo, prNumber);

  if (componentChanges.length !== 0) {
    await createComment(octokit, pr, esphomeChanges, componentChanges);
  }
}

// receive email notifications regarding PRs from GitHub
router.post('/mailhook', async (request, env) => {
  const formdata = await request.formData();
  const subject = formdata.get('subject');
  if (!subject) {
    return new Response('Missing subject', { status: 400 });
  }
  const match = subject.match(/\[([^\]]+)] .* \(PR #(\d+)\)/);
  if (!match) {
    return new Response('Invalid subject format', {status: 400});
  }
  const repoName = match[1];
  const prNumber = match[2];
  const [owner, repo] = repoName.split('/');
  const octokit = new Octokit();

  const prDetails = await octokit.rest.pulls.get({
    owner: owner,
    repo: repo,
    pull_number: prNumber,
  });
  const state = prDetails.data.state;
  const user_id = prDetails.data.user.login;
  if (user_id !== 'clydebarrow') {
    return new Response('Wrong user', {status: 202});
  }

  //if (state === 'closed') {
    //return new Response('PR is closed', {status: 202});
  //}

  const {esphomeChanges, componentChanges} = await getEsphomeAndComponentChanges(octokit, owner, repo, prNumber);
  if (componentChanges.length === 0) {
    return new Response('No component changes', { status: 202 });
  }

  await createComment(new Octokit({ auth: env.CPS_TOKEN }), prDetails.data, esphomeChanges, componentChanges);
  return new Response("OK");
});

// Main webhook handler
router.post('/webhook', async (request, env) => {
  try {
    // Verify webhook signature
    const isValid = await verifyGitHubWebhook(request, env.WEBHOOK_SECRET);
    if (!isValid) {
      return new Response('Invalid signature', { status: 401 });
    }

    const event = await request.json();
    const githubEvent = request.headers.get('x-github-event');

    if (githubEvent === 'pull_request') {
      const action = event.action;
      if (['opened', 'synchronize'].includes(action)) {
        // Get installation token
        const token = await getInstallationToken(env);

        // Create Octokit instance
        const octokit = new Octokit({
          auth: token,
        });

        await handlePullRequest(env, event, octokit);
      }
    }

    return new Response('OK');
  } catch (error) {
    console.log(error);
    return new Response(error.message, { status: 500 });
  }
});

// Handle root path
router.get('/', () => new Response('ESPHome PR Bot'));

// Handle all other routes
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  fetch: router.handle,
};
