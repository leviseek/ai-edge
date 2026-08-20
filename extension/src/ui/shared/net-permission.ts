/** UI 共享：运行时网络权限（动态收敛 host_permissions，用户确认后放行） */
const ALL_URLS_ORIGINS = ['<all_urls>'];

export async function hasNetworkPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: ALL_URLS_ORIGINS });
  } catch {
    return true; // 无法检测时按已具备处理
  }
}

/** 需要联网可能触发授权弹窗；返回是否已具备 */
export async function ensureNetworkPermission(): Promise<boolean> {
  const has = await hasNetworkPermission();
  if (has) return true;
  try {
    return await chrome.permissions.request({ origins: ALL_URLS_ORIGINS });
  } catch {
    return false;
  }
}