// Статус в Discord временно отключён: способ с программой-помощником убран с сайта.
// Оставлены пустые функции, чтобы остальной код не менялся.
export const discordPossible = () => false;
export const discordReady = () => false;
export const discordOn = () => false;
export function startDiscord() {}
export async function setDiscord() { return false; }
export function showDiscordGuide() {}
try { localStorage.removeItem('mkw.discord'); } catch { /* ignore */ }
