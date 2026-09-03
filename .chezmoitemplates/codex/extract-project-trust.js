"use strict";

function isHeader(line) {
  const stripped = line.trim();
  return stripped.startsWith("[") && stripped.endsWith("]");
}

function isProjectHeader(line) {
  const stripped = line.trim();
  return stripped === "[projects]" || stripped.startsWith("[projects.");
}

function extractProjectTrust(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (isHeader(line)) {
      if (current !== null) {
        blocks.push(current.join("\n").trimEnd());
        current = null;
      }
      if (isProjectHeader(line)) current = [line];
      continue;
    }

    if (current !== null) current.push(line);
  }

  if (current !== null) blocks.push(current.join("\n").trimEnd());
  const output = blocks.filter((block) => block.trim()).join("\n\n");
  return output ? `${output}\n` : "";
}

function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write(
      "usage: extract-project-trust.js <existing-config-text>\n",
    );
    return 2;
  }

  try {
    process.stdout.write(extractProjectTrust(argv[0]));
    return 0;
  } catch (error) {
    process.stderr.write(`extract-project-trust.js: ${error.stack}\n`);
    return 1;
  }
}

module.exports = { extractProjectTrust };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
