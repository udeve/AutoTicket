import { APP_VER_NO, CHANNEL, ENDPOINTS } from "../constants.js";
import type { ExchangeOptions, RequestPayload } from "../types.js";
import { nowTs } from "../utils/time.js";
import { ApiClient } from "../http/api-client.js";

export interface ExchangeResponse {
  result?: string;
  msg?: string;
  trcode?: string;
  [key: string]: unknown;
}

export class ExchangeService {
  constructor(private readonly client: ApiClient) {}

  buildPayload(options: ExchangeOptions): RequestPayload {
    const userId = options.user.userId ?? options.user.loginName;
    return {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      login_name: options.user.loginName,
      user_id: userId,
      ses_id: options.user.sesId,
      exchange_id: options.exchangeId
    };
  }

  async exchangeOnce(options: ExchangeOptions) {
    return this.client.postEncrypted<ExchangeResponse>(ENDPOINTS.exchange, this.buildPayload(options));
  }
}
