export function appearance(settings = {}, systemDark = true) {
  const accent = /^#[\da-f]{6}$/i.test(settings.accent || '')
    ? settings.accent
    : '#d8edab';
  const channels = accent
    .slice(1)
    .match(/../g)
    .map((c) => {
      const v = parseInt(c, 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
  const contrast =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.32
      ? '#162012'
      : '#ffffff';
  return {
    accent,
    contrast,
    light:
      settings.theme === 'light' ||
      (settings.theme === 'system' && !systemDark),
  };
}
