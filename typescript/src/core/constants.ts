export const BASE_URL = "https://app.hzgh.org.cn";
export const CHANNEL = "02";
export const APP_VER_NO = "3.1.7";
export const DAILY_TASK_APP_VER_NO = "3.1.4";

export const ENDPOINTS = {
  captcha: "/unionApp/interf/front/U/U067",
  login: "/unionApp/interf/front/U/U004",
  smsSend: "/unionApp/interf/front/SMS/SMS1",
  smsLogin: "/unionApp/interf/front/U/U065",
  dailyLogin: "/unionApp/interf/front/U/U042",
  signin: "/unionApp/interf/front/U/U042",
  comment: "/unionApp/interf/front/AC/AC08",
  query: "/unionApp/interf/front/U/U005",
  exchange: "/unionApp/interf/front/OL/OL41",
  qrToken: "/unionApp/interf/front/OL/OL82",
  qrVisit: "/unionApp/interf/front/OP/OP80",
  subwayTickets: "/unionApp/interf/front/OL/OL83"
} as const;

export const DEFAULT_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 15; SM-9210 Build/AP2A.240905.003.F1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.7258.158 Mobile Safari/537.36;unionApp;HZGH",
  Origin: "https://app.hzgh.org.cn:8123",
  "X-Requested-With": "com.zjte.hanggongefamily",
  Referer: "https://app.hzgh.org.cn:8123/",
  "Cache-Control": "no-cache",
  Pragma: "no-cache"
} as const;
