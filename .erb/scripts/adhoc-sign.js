// macOS builds without an Apple Developer certificate: electron-builder leaves the app
// unsigned, and Apple Silicon then refuses it as "damaged". An ad-hoc signature keeps it
// launchable (Gatekeeper still asks once: right-click > Open). With a real certificate
// (CSC_LINK / CSC_NAME set) electron-builder signs it itself and this does nothing.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });
};
