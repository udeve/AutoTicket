import { APP_VER_NO, CHANNEL, ENDPOINTS } from "../constants.js";
import type { SessionUser } from "../types.js";
import { nowTs } from "../utils/time.js";
import { ApiClient } from "../http/api-client.js";

export interface QrTokenResponse {
  result?: string;
  msg?: string;
  data?: { token?: string };
  [key: string]: unknown;
}

export interface SubwayTicketsResponse {
  result?: string;
  msg?: string;
  list?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export class QrService {
  constructor(private readonly client: ApiClient) {}

  async getQrToken(user: SessionUser) {
    const response = await this.client.postEncrypted<QrTokenResponse>(ENDPOINTS.qrToken, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      user_id: user.userId ?? user.loginName,
      ses_id: user.sesId
    });
    return response.data?.data?.token;
  }

  recordQrVisit(user: SessionUser) {
    return this.client.postEncrypted(ENDPOINTS.qrVisit, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      user_id: user.userId ?? user.loginName,
      icon_id: "92",
      type: "2"
    });
  }

  async getSubwayTickets(user: SessionUser, awardType = "1") {
    const response = await this.client.postEncrypted<SubwayTicketsResponse>(ENDPOINTS.subwayTickets, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      login_name: user.loginName,
      user_id: user.userId ?? user.loginName,
      ses_id: user.sesId,
      use_state: "1",
      award_type: awardType,
      page_size: 10,
      page_num: 1
    });
    return response.data;
  }

  async getSubwayTicketCount(user: SessionUser): Promise<number> {
    const response = await this.getSubwayTickets(user);
    // 优先使用 total 字段，如果没有则使用列表长度
    if (response?.total !== undefined && typeof response.total === "number") {
      return response.total;
    }
    return response?.list?.length ?? 0;
  }
}
