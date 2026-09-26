const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getForecast: (refresh) => ipcRenderer.invoke('forecast:get', refresh),
  openForecastSource: (url) => ipcRenderer.invoke('forecast:open', url),
  onShowForecast: (callback) => { const listener = () => callback(); ipcRenderer.on('forecast:show', listener); return () => { ipcRenderer.removeListener('forecast:show', listener); }; },
  getFeatures: () => ipcRenderer.invoke('features:get'),
  setFeatureSettings: (settings) => ipcRenderer.invoke('features:settings', settings),
  setAccountPreference: (id, input) => ipcRenderer.invoke('features:preference', id, input),
  inspectResetCredits: (id) => ipcRenderer.invoke('features:reset-details', id),
  consumeResetCredit: (id) => ipcRenderer.invoke('features:reset-consume', id),
  startLogin: (label, expectedId) => ipcRenderer.invoke('features:login', label, expectedId),
  cancelLogin: () => ipcRenderer.invoke('features:login-cancel'),
  diagnose: () => ipcRenderer.invoke('features:diagnose'),
  recoverLastSwitch: () => ipcRenderer.invoke('features:recover'),
  getAnalytics: (query) => ipcRenderer.invoke('features:analytics', query),
  scanAnalytics: () => ipcRenderer.invoke('features:scan'),
  exportAnalytics: (query) => ipcRenderer.invoke('features:export', query),
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  refreshAll: () => ipcRenderer.invoke('account:refresh-all'),
  refreshAccount: (accountId) => ipcRenderer.invoke('account:refresh', accountId),
  deleteAccount: (accountId) => ipcRenderer.invoke('account:delete', accountId),
  captureCurrentAuth: (input) => ipcRenderer.invoke('account:capture-current-auth', input),
  switchAccount: (accountId) => ipcRenderer.invoke('account:switch', accountId),
  switchRecommendedAccount: () => ipcRenderer.invoke('account:switch-recommended'),
  setAutoRestartOnSwitch: (enabled) =>
    ipcRenderer.invoke('settings:set-auto-restart-on-switch', enabled),
  terminateCodex: () => ipcRenderer.invoke('codex:terminate')
});
