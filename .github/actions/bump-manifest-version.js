const fs = require('fs');

// Read the current manifest file
const manifestFile = fs.readFileSync('fxmanifest.lua', { encoding: 'utf8' });

// Extract the current version from the manifest file
const versionMatch = manifestFile.match(/\bversion\s+'([\d.]+)'/);

if (!versionMatch) {
    console.error('No version found in fxmanifest.lua');
    process.exit(1);
}

let version = versionMatch[1];
let versionParts = version.split('.').map(Number);

// Normally every push to main is a patch, so the last part goes up by one and
// nobody has to think about it.
//
// A DELIBERATE version - a minor or a major - cannot be expressed that way:
// there is no value that increments to 1.3.0. So a commit saying [no-bump]
// ships the manifest exactly as written. NEW_VERSION is still exported either
// way, because the release title, the dirk_versions dispatch and the changelog
// gate all read it.
const pinned = /\[no-bump\]/i.test(process.env.COMMIT_MSG || '');
if (!pinned) versionParts[versionParts.length - 1] += 1;

const newVersion = versionParts.join('.');

// Replace the old version in the manifest file content with the new version
const newFileContent = manifestFile.replace(/\bversion\s+'[\d.]+'/, `version      '${newVersion}'`);

// Write the updated content back to the file
fs.writeFileSync('fxmanifest.lua', newFileContent);

// Export the new version for GitHub Actions to use
fs.writeFileSync(process.env.GITHUB_ENV, `NEW_VERSION=${newVersion}\n`, { flag: 'a' });

console.log(`Version updated to ${newVersion}`);