/**
 * §39 — the window's analytics: no key, no queue, no request. Main supplies
 * identity and context, re-validates every event (usageBeforeSend), and
 * refuses identity/consent calls from here (acceptRendererIdentity: false).
 */
import { createElectronRenderer } from "inlet-sdk/analytics/electron-renderer";
import { USAGE_EVENTS, type Screen, type UsageEventName, type UsageParams } from "../../main/usage/events";

const client = createElectronRenderer();

export function trackUi(name: UsageEventName, params: UsageParams = {}): void {
  client.track(name, { category: USAGE_EVENTS[name].category, params });
}

export function screenView(name: Screen): void {
  client.screen(name);
}
