// Version bump (like Thingy's): package.json, release/app/package.json and the lockfile
// get the same version. The release workflows read it from package.json.
//
//   npm run bump              asks for the new version
//   npm run bump -- 0.2.0     sets it
//   npm run bump -- patch     0.1.0 -> 0.1.1   (also: minor, major)
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';

const root = path.resolve(__dirname, '../../');
const rootPkgPath = path.join(root, 'package.json');
const appPkgPath = path.join(root, 'release/app/package.json');
const lockPath = path.join(root, 'package-lock.json');

const readJson = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

const writeJson = (filePath: string, data: any) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(chalk.green(`Updated ${path.relative(root, filePath)}`));
};

/** 'patch' | 'minor' | 'major' or an explicit x.y.z; null when it is not a version. */
export const nextVersion = (current: string, input: string): string | null => {
  const wanted = input.trim().replace(/^v/, '');
  const [maj, min, pat] = current.split(/[.-]/).map((n) => Number(n) || 0);
  if (wanted === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (wanted === 'minor') return `${maj}.${min + 1}.0`;
  if (wanted === 'major') return `${maj + 1}.0.0`;
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(wanted) ? wanted : null;
};

const apply = (input: string) => {
  const rootPkg = readJson(rootPkgPath);
  const appPkg = readJson(appPkgPath);
  if (!input.trim()) {
    console.log(chalk.yellow('Operation cancelled. No version entered.'));
    process.exit(0);
  }
  const version = nextVersion(rootPkg.version, input);
  if (!version) {
    console.error(
      chalk.red(
        `Invalid version: "${input}". Expected x.y.z, patch, minor or major`,
      ),
    );
    process.exit(1);
  }
  rootPkg.version = version;
  appPkg.version = version;
  writeJson(rootPkgPath, rootPkg);
  writeJson(appPkgPath, appPkg);
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    writeJson(lockPath, lock);
  }
  console.log(chalk.green(`\nStackrun version bumped to ${chalk.bold(version)} 🚀`));
  console.log(
    chalk.gray(
      `Next: commit, push, then run "Build & Release" for macOS / Windows / Linux (tag v${version}).`,
    ),
  );
};

if (require.main === module) {
  console.log(chalk.cyan('--- Stackrun Version Manager ---'));
  const rootPkg = readJson(rootPkgPath);
  const appPkg = readJson(appPkgPath);
  console.log(`Current Root Version: ${chalk.yellow(rootPkg.version)}`);
  console.log(`Current App Version:  ${chalk.yellow(appPkg.version)}`);
  if (rootPkg.version !== appPkg.version)
    console.log(chalk.red('Warning: Versions are out of sync!'));

  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (arg) apply(arg);
  else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(
      chalk.blue(
        `\nNew version (x.y.z, patch, minor, major; current ${rootPkg.version}): `,
      ),
      (answer) => {
        rl.close();
        apply(answer);
      },
    );
  }
}
