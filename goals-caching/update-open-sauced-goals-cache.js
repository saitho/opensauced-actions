import {Octokit} from "octokit"
import fs from "fs";

const login = process.env.LOGIN
const contributionStats = !!process.env.ENABLE_CONTRIBUTION_STATS ?? false
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})
// fest authenticated users stars
async function getStars(user) {
  const {data} = await octokit.request('GET /users/{user}/starred', {
    user: user,
  }).catch(err => {
    console.log(err)
  })
  return Promise.all(
    data.map(async repo => {
  
    return {
      full_name: repo.full_name,
      stargazers_count: repo.stargazers_count,
      open_issues_count: repo.open_issues_count,
      forks_count: repo.forks_count
    }
  }))
}

async function buildIssueBody(repoData) {
  const issueData = await octokit.paginate(await octokit.rest.search.issuesAndPullRequests({
    owner: repoData.owner,
    repo: repoData.repo,
    q: `repo:${repoData.full_name} author:${login} is:issue`,
    sort: 'created',
    order: 'asc'
  }));
  const prData = await octokit.paginate(await octokit.rest.search.issuesAndPullRequests({
    owner: repoData.owner,
    repo: repoData.repo,
    q: `repo:${repoData.full_name} author:${login} is:pr`,
    sort: 'created',
    order: 'asc'
  }))

  const prList = prData.map((pr) => {
    const prSearchUrl = new URL(repoData.html_url)
    prSearchUrl.pathname += '/issues'
    prSearchUrl.searchParams.set('q', `"${pr.title}" in:title is:pr author:${login}`)
    const issueDate = new Date(pr.created_at)
    return `* ${issueDate.toDateString()}: [${pr.title}](${prSearchUrl.toString()})`;
  })

  let firstIssueDate, lastIssueDate
  if (issueData.length)  {
    firstIssueDate = new Date(issueData[0].created_at)
    lastIssueDate = new Date(issueData[issueData.length-1].created_at)
  }

  let firstPrDate, lastPrDate
  if (prData.length)  {
    firstPrDate = new Date(prData[0].created_at)
    lastPrDate = new Date(prData[prData.length-1].created_at)
  }

  let firstContributionDate;
  if (firstIssueDate && !firstPrDate) {
    firstContributionDate = firstIssueDate
  } else if (!firstIssueDate && firstPrDate) {
    firstContributionDate = firstPrDate
  } else if (firstIssueDate && firstPrDate) {
    firstContributionDate = firstIssueDate < firstPrDate ? firstIssueDate : firstPrDate;
  }

  let lastContributionDate;
  if (lastIssueDate && !lastPrDate) {
    lastContributionDate = lastIssueDate
  } else if (!lastIssueDate && lastPrDate) {
    lastContributionDate = lastPrDate
  } else if (lastIssueDate && lastPrDate) {
    lastContributionDate = lastIssueDate > lastPrDate ? lastIssueDate : lastPrDate;
  }

  return `# ${repoData.full_name}

Repository: ${repoData.html_url}

## About the project

${repoData.description}

## Contribution stats

First contribution: ${firstContributionDate ? firstContributionDate.toDateString() : '-'}
Last contribution: ${lastContributionDate ? lastContributionDate.toDateString() : '-'}

Issues: ${issueData.length}
Pull Requests: ${prData.length}

## Pull Requests

${prList.join('\n')}`;
}

async function getRepoGoals(issues) {
  return Promise.all(
    issues.map(async issue => {
      // all goal issues follow the "owner/repo" format 
      let [owner, name] = issue.title.split("/");
  
      const {data} = await octokit.rest.repos.get({
        owner: owner,
        repo: name,
      })
      console.log(`Title: ${issue.title} vs. ${data.full_name}`);
      if(data.full_name.trim() !== issue.title || contributionStats) {
        const body = contributionStats ? await buildIssueBody(data) : null
        goalsToRename.push({title:data.full_name,number:issue.number, body: body})
      }
      return {
        full_name: data.full_name,
        stargazers_count: data.stargazers_count,
        open_issues_count: data.open_issues_count,
        forks_count: data.forks_count,
      }
    }),
  );
}
async function updateGoals(){
  return Promise.all(
    goalsToRename.map(async goal => {
      const params = {
        owner:login,
        repo:"open-sauced-goals",
        issue_number:goal.number,
        title:goal.title
      }
      if (contributionStats && goal.body != null) {
        params.body = goal.body
      }
      return await octokit.rest.issues.update(params)
    })
  );
    
}
const starsData = await getStars(login)

// goals fetch and combine that with the stars
// fetch all goal repos
let repoIssues
let stagedIssues
let goalsToRename = [];
try {
  stagedIssues = await octokit.rest.issues.listForRepo({
    owner: login,
    repo: "open-sauced-goals" 
  })
  console.log("stagedIssues", stagedIssues)
  repoIssues = await octokit.paginate(stagedIssues);
} catch (err) {
  console.log(err)
}
  
const repoGoalsData = await getRepoGoals(repoIssues)
if(goalsToRename.length > 0) await updateGoals()
// create or update the json store
fs.writeFileSync("data.json", JSON.stringify(repoGoalsData, null, 2));
fs.writeFileSync("stars.json", JSON.stringify(starsData, null, 2));
