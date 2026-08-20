/** 基座：向指定 tab 的 content script 发起请求（与运行时消息同协议） */
import { makeRequest, type ResponseEnvelope } from '../shared/protocol';
import { RpcError } from '../shared/rpc';

export class TabMessenger {
  async send<TReq = unknown, TRes = unknown>(
    tabId: number,
    target: string,
    action: string,
    payload: TReq,
  ): Promise<TRes> {
    let res: ResponseEnvelope<TRes> | undefined;
    try {
      res = await chrome.tabs.sendMessage(tabId, makeRequest(target, action, payload));
    } catch (e) {
      throw new RpcError(
        'no_content_script',
        `tab ${tabId} 无内容脚本响应（页面未加载完成或属于受限页）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res) throw new RpcError('no_response', `tab ${tabId} content script 无响应`);
    if (!res.ok) throw new RpcError(res.error?.code ?? 'unknown', res.error?.message ?? 'content 调用失败');
    return res.data as TRes;
  }
}