// Imports
const core = require("@actions/core");
const shell = require("shelljs");
const artifact = require("@actions/artifact");
const github = require("@actions/github");

// Exports
module.exports = { publishOutput };

/**
 * Publish the article output.
 *
 */
async function publishOutput() {
  // Infer the manuscript name
  const GITHUB_WORKSPACE = shell.env["GITHUB_WORKSPACE"];
  const config = require(`${GITHUB_WORKSPACE}/.showyourwork/config.json`);
  const output = [config["ms_pdf"]];
  core.startGroup("Uploading output");

  // Include the arxiv tarball?
  if (core.getInput("build-tarball") == "true") {
    output.push("arxiv.tar.gz");
  }

  // If this is a PR, record some metadata
  const GITHUB_EVENT_NAME = shell.env["GITHUB_EVENT_NAME"];
  const OUTPUT_BRANCH_SUFFIX = core.getInput("output-branch-suffix");
  if (GITHUB_EVENT_NAME.includes("pull_request")) {
    const PR_NUMBER = github.context.payload.pull_request.number;

    // Build PDF diff
    if (core.getInput("build-diff-on-pull-request") == "true") {
      const LATEXDIFF_URL = core.getInput("latexdiff-url");
      const BASE_REF = github.context.payload.pull_request.base.ref;

      core.startGroup("Build article diff");

      // Download latexdiff
      shell.exec(`wget ${LATEXDIFF_URL}`)

      // Checkout base version of ms.tex
      shell.exec(`git show ${BASE_REF}:src/tex/ms.tex > src/tex/old.tex`);
      // TODO: Flatten files to single latex file, to allow diff on
      //       auxiliary files.

      // Compute diff, and build
      shell.exec(`perl latexdiff src/tex/old.tex src/tex/ms.tex > tmp.tex`);
      shell.exec(`mv tmp.tex src/tex/ms.tex`);
      shell.exec(`showyourwork build`);

      core.endGroup();
    }

    output.forEach(function (file) {
      shell.exec(`echo ${file} >> output.txt`);
    });
    output.push("output.txt");
    shell.exec(`echo ${PR_NUMBER} > pr_number.txt`);
    output.push("pr_number.txt");
    shell.exec(`echo ${config["ms_pdf"]} > article_pdf.txt`);
    output.push("article_pdf.txt");
    shell.exec(`echo ${OUTPUT_BRANCH_SUFFIX} > branch_suffix.txt`);
    output.push("branch_suffix.txt");
  }

  // Upload an artifact
  const artifactClient = artifact.create();
  await artifactClient.uploadArtifact("showyourwork-output", output, ".", {
    continueOnError: false,
  });

  // Force-push output to a separate branch
  if (!GITHUB_EVENT_NAME.includes("pull_request")) {
    const GITHUB_SLUG = shell.env["GITHUB_REPOSITORY"];
    const GITHUB_REF = shell.env["GITHUB_REF"];
    const GITHUB_TOKEN = core.getInput("github-token");
    const GITHUB_BRANCH = GITHUB_REF.split("/")[2];
    const TARGET_DIRECTORY = shell
      .exec("mktemp -d")
      .replace(/(\r\n|\n|\r)/gm, "");
    const TARGET_BRANCH = `${GITHUB_BRANCH}-${OUTPUT_BRANCH_SUFFIX}`;
    shell.cp("-R", ".", `${TARGET_DIRECTORY}`);
    shell.cd(`${TARGET_DIRECTORY}`);
    shell.exec(`git checkout --orphan ${TARGET_BRANCH}`);
    shell.exec("git rm --cached -rf .", { silent: true });
    for (const out of output) {
      shell.exec(`git add -f ${out}`);
    }
    shell.exec(
      "git -c user.name='showyourwork' -c user.email='showyourwork' " +
        "commit -m 'force-push article output'"
    );
    shell.exec(
      "git push --force " +
        `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_SLUG} ` +
        `${TARGET_BRANCH}`
    );
    shell.cd(GITHUB_WORKSPACE);
    core.endGroup();
  }
}
