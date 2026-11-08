export function compareVersions(a, b) {
  const parse = (value) =>
    /^\d+\.\d+\.\d+$/.test(value || '') ? value.split('.').map(Number) : null;
  const left = parse(a),
    right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function bridgeCompatibilityError(message) {
  if (
    message.protocolVersion !== 2 ||
    !Array.isArray(message.state?.sessions) ||
    (compareVersions(message.extensionVersion, '1.3.0') ?? -1) < 0
  )
    return `Chrome is using an old desktop bridge (${message.extensionVersion || 'unknown'}). Open the latest LockIN app; the companion will reconnect to it. Category timers are not being applied by this bridge.`;
  return '';
}
export function updateCompatibilityError(hostVersion, companionVersion) {
  if ((compareVersions(hostVersion, companionVersion) ?? -1) < 0)
    return `Update blocked: desktop bridge ${hostVersion || 'unknown'} is older than companion ${companionVersion}. Open the latest LockIN app and reconnect. Your companion will not be downgraded.`;
  return '';
}
