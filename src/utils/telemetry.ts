import * as vscode from 'vscode';
import * as os from 'os';
import { randomUUID } from 'crypto';

/**
 * Anonymous installation telemetry.
 *
 * Sends one small beacon per day so we can count how many installs exist and
 * which versions are in use. Deliberately narrow:
 *
 *  - No connection details, hosts, tokens, queries, table names or result data
 *    ever leave the machine. Only the fields in `TelemetryPayload` are sent.
 *  - The installation id is a random UUID generated locally. It is not derived
 *    from the machine, the user, or anything VS Code knows about them, so it
 *    cannot be correlated back to a person or across other products.
 *  - Honours VS Code's global telemetry setting *and* an extension-specific
 *    setting; either one turning it off is enough.
 */

const ENDPOINT = 'https://telemetry.basekick.net/api/v1/vscode/telemetry';

/** Matches Arc's own telemetry cadence. */
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Delay before the first beacon. Activation is the busiest moment in an
 * extension's life; nothing here should compete with it.
 */
const STARTUP_DELAY_MS = 60 * 1000;

const REQUEST_TIMEOUT_MS = 10 * 1000;

const INSTALL_ID_KEY = 'arc.telemetry.installationId';
const LAST_SENT_KEY = 'arc.telemetry.lastSent';

interface TelemetryPayload {
  installation_id: string;
  timestamp: string;
  extension_version: string;
  vscode_version: string;
  editor: string;
  os_name: string;
  os_architecture: string;
}

export class TelemetryReporter implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private timer?: NodeJS.Timeout;
  private disposed = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * True only when the user has left both VS Code's global telemetry setting
   * and the Arc-specific setting enabled.
   */
  private isEnabled(): boolean {
    // Respect the global kill switch first: a user who disabled telemetry
    // editor-wide should not have to find our setting too.
    if (vscode.env.isTelemetryEnabled === false) {
      return false;
    }
    return vscode.workspace
      .getConfiguration('arc')
      .get<boolean>('telemetry.enabled', true);
  }

  /**
   * Stable random id for this install, created on first use.
   * globalState (not workspaceState) so it is one id per install, not per folder.
   */
  private async getInstallationId(): Promise<string> {
    let id = this.context.globalState.get<string>(INSTALL_ID_KEY);
    // Regenerate anything that is not a well-formed UUID: the server rejects
    // non-UUID ids with a 422, which would silently drop this install forever.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      id = randomUUID();
      await this.context.globalState.update(INSTALL_ID_KEY, id);
    }
    return id;
  }

  /**
   * Start reporting. Returns immediately; all work happens on a timer.
   */
  start(): void {
    if (!this.isEnabled()) {
      return;
    }

    // setTimeout for the first run, then an interval, so a freshly installed
    // extension does not beacon during activation.
    this.timer = setTimeout(() => {
      void this.reportIfDue();
      this.timer = setInterval(() => void this.reportIfDue(), REPORT_INTERVAL_MS);
      // A long interval on a machine that never sleeps should not hold the
      // event loop open by itself.
      this.timer.unref?.();
    }, STARTUP_DELAY_MS);
    this.timer.unref?.();
  }

  /**
   * Send a beacon if a full interval has passed since the last one.
   *
   * The timestamp check matters because VS Code restarts reset the timer:
   * without it, someone who opens and closes their editor ten times a day
   * would be counted as ten times the activity.
   */
  private async reportIfDue(): Promise<void> {
    if (this.disposed || !this.isEnabled()) {
      return;
    }

    const lastSent = this.context.globalState.get<number>(LAST_SENT_KEY, 0);
    const now = Date.now();
    // `now < lastSent` catches a clock that moved backwards; without it a
    // future timestamp would suppress beacons until real time caught up.
    if (lastSent && now - lastSent < REPORT_INTERVAL_MS && now >= lastSent) {
      return;
    }

    await this.send(now);
  }

  private async send(now: number): Promise<void> {
    try {
      const payload: TelemetryPayload = {
        installation_id: await this.getInstallationId(),
        timestamp: new Date(now).toISOString(),
        extension_version:
          vscode.extensions.getExtension('basekick-labs.arc-db-manager')?.packageJSON?.version ??
          'unknown',
        vscode_version: vscode.version,
        // Forks report their own name, so we can tell VS Code from Cursor etc.
        editor: vscode.env.appName || 'unknown',
        os_name: os.platform(),
        os_architecture: os.arch()
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        // Only record success. A failed beacon should be retried on the next
        // tick rather than counted as delivered.
        if (response.ok) {
          await this.context.globalState.update(LAST_SENT_KEY, now);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Telemetry is strictly best-effort: an offline machine, a proxy, or a
      // blocked domain must never surface an error to the user.
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
