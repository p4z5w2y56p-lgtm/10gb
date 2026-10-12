/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import fs from "node:fs";
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// In the cloud container the pre-installed headless shell is used (remotion.media is not reachable there).
// Locally this is skipped and Remotion downloads its own browser.
const headlessShell = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (fs.existsSync(headlessShell)) {
  Config.setBrowserExecutable(headlessShell);
}
Config.setCodec("h264");
Config.setCrf(16);
Config.setX264Preset("slow");
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setJpegQuality(95);
