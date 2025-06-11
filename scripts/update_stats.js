const fs = require('fs');
const fetch = require('node-fetch');

const username = 'uxillary'; // <-- your GitHub username
const headers = {
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  'User-Agent': 'GitHub Stats Script',
};

async function getPublicRepoCount() {
  const res = await fetch(`https://api.github.com/users/${username}`, { headers });
  const data = await res.json();
  return data.public_repos;
}

async function getContributions() {
  const query = `
    query {
      user(login: "${username}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  return data.data.user.contributionsCollection.contributionCalendar.totalContributions;
}

(async () => {
  const repos = await getPublicRepoCount();
  const contributions = await getContributions();

  fs.writeFileSync('docs/repos.txt', `${repos}`);
  fs.writeFileSync('docs/contributions.txt', `${contributions}`);

  console.log('✅ Stats updated:', { repos, contributions });
})();
