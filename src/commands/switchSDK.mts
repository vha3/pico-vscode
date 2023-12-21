import { Command } from "./command.mjs";
import { ProgressLocation, window, workspace } from "vscode";
import type UI from "../ui.mjs";
import { updateVSCodeStaticConfigs } from "../utils/vscodeConfigUtil.mjs";
import { SDK_REPOSITORY_URL, getSDKReleases } from "../utils/githubREST.mjs";
import {
  downloadAndInstallSDK,
  downloadAndInstallToolchain,
  downloadAndInstallTools,
} from "../utils/download.mjs";
import { cmakeUpdateSDK } from "../utils/cmakeUtil.mjs";
import {
  type SupportedToolchainVersion,
  getSupportedToolchains,
} from "../utils/toolchainUtil.mjs";
import type Settings from "../settings.mjs";

export default class SwitchSDKCommand extends Command {
  private _ui: UI;
  private _settings: Settings;

  constructor(ui: UI, settings: Settings) {
    super("switchSDK");

    this._ui = ui;
    this._settings = settings;
  }

  async execute(): Promise<void> {
    if (
      workspace.workspaceFolders === undefined ||
      workspace.workspaceFolders.length === 0
    ) {
      void window.showErrorMessage("Please open a Pico project folder first.");

      return;
    }

    const workspaceFolder = workspace.workspaceFolders[0];

    const sdks = await getSDKReleases();

    // show quick pick
    const selectedSDK = await window.showQuickPick(
      sdks.map(sdk => ({
        label: `v${sdk.tagName}`,
        sdk: sdk,
      })),
      {
        placeHolder: "Select SDK version",
      }
    );

    if (selectedSDK === undefined) {
      return;
    }

    let selectedToolchainVersion:
      | { label: string; toolchain: SupportedToolchainVersion }
      | undefined;

    try {
      const supportedToolchainVersions = await getSupportedToolchains();
      // show quick pick for toolchain version
      selectedToolchainVersion = await window.showQuickPick(
        supportedToolchainVersions.map(toolchain => ({
          label: toolchain.version.replaceAll("_", "."),
          toolchain: toolchain,
        })),
        {
          placeHolder: "Select ARM Embeded Toolchain version",
        }
      );
    } catch (error) {
      void window.showErrorMessage(
        "Failed to get supported toolchain versions. " +
          "Make sure you are connected to the internet."
      );

      return;
    }

    if (selectedToolchainVersion === undefined) {
      return;
    }

    // show progress bar while installing
    const result = await window.withProgress(
      {
        title:
          `Installing SDK ${selectedSDK.label} and ` +
          `toolchain ${selectedToolchainVersion.label}...`,
        location: ProgressLocation.Notification,
      },
      async progress => {
        // download and install selected SDK
        if (
          await downloadAndInstallSDK(
            selectedSDK.sdk.tagName,
            SDK_REPOSITORY_URL,
            this._settings
          ) &&
          (await downloadAndInstallTools(selectedSDK.sdk.tagName))
        ) {
          progress.report({
            increment: 40,
          });

          if (
            await downloadAndInstallToolchain(
              selectedToolchainVersion!.toolchain
            )
          ) {
            progress.report({
              increment: 40,
            });

            await updateVSCodeStaticConfigs(
              workspaceFolder.uri.fsPath,
              selectedSDK.sdk.tagName,
              selectedToolchainVersion!.toolchain.version
            );

            progress.report({
              increment: 10,
            });

            await cmakeUpdateSDK(
              workspaceFolder.uri,
              this._settings,
              selectedSDK.sdk.tagName,
              selectedToolchainVersion!.toolchain.version
            );

            progress.report({
              // show sdk installed notification
              message: `Successfully installed SDK ${selectedSDK.label}.`,
              increment: 10,
            });

            return true;
          } else {
            progress.report({
              message:
                "Failed to install " +
                `toolchain ${selectedToolchainVersion!.label}.`,
              increment: 60,
            });

            return false;
          }
        }

        progress.report({
          // show sdk install failed notification
          message:
            `Failed to install SDK ${selectedSDK.label}.` +
            "Make sure all requirements are met.",
          increment: 100,
        });

        return false;
      }
    );

    if (result) {
      this._ui.updateSDKVersion(selectedSDK.label);
    }
  }
}
