// Minimal MV3 background script (Chrome service worker / Firefox event page).
// Strictly offline: no network requests, no telemetry, no remote code.

import { ext } from '../shared/browser-api';

// Keep toolbar action opening Popup by default (Side Panel remains available via browser UI)
if (ext.raw.sidePanel?.setPanelBehavior) {
  ext.raw.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
    // Ignore on browsers that do not support setPanelBehavior
  });
}
