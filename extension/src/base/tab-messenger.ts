/** 基座：向指定 tab 的 content script 发起请求（缺失时自动注入并重试一次） */
import { makeRequest, type ResponseEnvelope } from '../shared/protocol';
import { RpcError } from '../shared/rpc';

/** 无监听端（目标页未注入 content script）的典型错误文本 */
const NO_RECEIVER = /(Receiving end does not exist|Could not establish connection)/i;

export class TabMessenger {
  async send<TReq = unknown, TRes = unknown>(
    tabId: number,
    target: string,
    action: string,
    payload: TReq,
  ): Promise<TRes> {
    try {
      return await this.dispatch<TReq, TRes>(tabId, target, action, payload);
    } catch (e) {
      // 内容脚本缺失（页面在扩展加载前已打开等）→ 自动注入后重试一次
      if (e instanceof RpcError && e.code === 'no_content_script') {
        await this.injectContentScript(tabId);
        return this.dispatch<TReq, TRes>(tabId, target, action, payload);
      }
      throw e;
    }
  }

  private async dispatch<TReq, TRes>(
    tabId: number,
    target: string,
    action: string,
    payload: TReq,
  ): Promise<TRes> {
    let res: ResponseEnvelope<TRes> | undefined;
    try {
      res = (await chrome.tabs.sendMessage(tabId, makeRequest(target, action, payload))) as
        | ResponseEnvelope<TRes>
        | undefined;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (NO_RECEIVER.test(raw)) {
        throw new RpcError('no_content_script', '当前页面尚未注入 ai-edge 脚本');
      }
      throw new RpcError('no_content_script', `无法联系该页面：${raw}`);
    }
    if (!res) throw new RpcError('no_response', 'content script 无响应');
    if (!res.ok) throw new RpcError(res.error?.code ?? 'unknown', res.error?.message ?? 'content 调用失败');
    return res.data as TRes;
  }

  /** 向指定 tab 的指定 frame（iframe）发送消息（无自动注入） */
  async sendFrame<TReq = unknown, TRes = unknown>(
    tabId: number,
    frameId: number,
    target: string,
    action: string,
    payload: TReq,
  ): Promise<TRes> {
    let res: ResponseEnvelope<TRes> | undefined;
    try {
      res = (await chrome.tabs.sendMessage(tabId, makeRequest(target, action, payload), { frameId })) as
        | ResponseEnvelope<TRes>
        | undefined;
    } catch (e) {
      throw new RpcError('no_content_script', `frame ${frameId} 无内容脚本响应：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res) throw new RpcError('no_response', 'content script 无响应');
    if (!res.ok) throw new RpcError(res.error?.code ?? 'unknown', res.error?.message ?? 'content 调用失败');
    return res.data as TRes;
  }

  /** 向已打开标签注入 content.js（幂等；受限页/无权限会抛错） */
  private async injectContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/permission|access|Cannot access/i.test(raw)) {
        throw new RpcError(
          'no_host_permission',
          '无法访问该页面（站点权限未授予或为受限页）。请在设置页「数据与隐私」授权联网并刷新页面后重试。',
        );
      }
      throw new RpcError('no_content_script', `自动注入失败：${raw}`);
    }
  }
}