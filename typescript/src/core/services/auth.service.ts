import { APP_VER_NO, CHANNEL, ENDPOINTS } from "../constants.js";
import type { RequestPayload } from "../types.js";
import { nowTs } from "../utils/time.js";
import { ApiClient } from "../http/api-client.js";

export interface CaptchaResponse {
  result?: string;
  msg?: string;
  img?: string;
  imgUniCode?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface LoginResponse {
  result?: string;
  msg?: string;
  login_name?: string;
  user_id?: string;
  ses_id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface UserInfoResponse {
  result?: string;
  msg?: string;
  name?: string;
  sensitive_name?: string;
  remain_integral?: string | number;
  total_integral?: string | number;
  [key: string]: unknown;
}

export class AuthService {
  constructor(private readonly client: ApiClient) {}

  getCaptcha() {
    return this.client.postEncrypted<CaptchaResponse>(ENDPOINTS.captcha, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      trcode: "U/U067"
    });
  }

  sendSms(captchaData: { imgUniCode?: string }, phone: string, imgAuthCode: string, smsType = "10") {
    const payload: RequestPayload = {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      login_name: phone,
      mobile: phone,
      imgUniCode: captchaData.imgUniCode ?? "",
      imgAuthCode,
      sms_type: smsType
    };
    return this.client.postEncrypted(ENDPOINTS.smsSend, payload);
  }

  loginBySms(phone: string, authCode: string) {
    return this.client.postEncrypted<LoginResponse>(ENDPOINTS.smsLogin, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      login_name: phone,
      auth_code: authCode
    });
  }

  loginByPassword(captchaData: { imgUniCode?: string }, phone: string, password: string, imgAuthCode: string) {
    return this.client.postEncrypted<LoginResponse>(ENDPOINTS.login, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      login_name: phone,
      pwd: password,
      imgUniCode: captchaData.imgUniCode ?? "",
      imgAuthCode
    });
  }

  queryUserInfo(loginName: string, sesId: string) {
    return this.client.postEncrypted<UserInfoResponse>(ENDPOINTS.query, {
      channel: CHANNEL,
      app_ver_no: APP_VER_NO,
      timestamp: nowTs(),
      login_name: loginName,
      ses_id: sesId
    });
  }
}
