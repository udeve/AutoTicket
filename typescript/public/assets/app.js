const output = document.querySelector("#output");
const users = document.querySelector("#users");
const stateOutput = document.querySelector("#stateOutput");
const captchaPreview = document.querySelector("#captchaPreview");
const captchaImage = document.querySelector("#captchaImage");
const captchaMeta = document.querySelector("#captchaMeta");

document.querySelector("#refreshConfig").addEventListener("click", () => handleAction(loadConfig));
document.querySelector("#refreshState").addEventListener("click", () => handleAction(loadState));
document.querySelector("#dailyForm").addEventListener("submit", (event) => handleAction(() => submitDaily(event)));
document.querySelector("#exchangeForm").addEventListener("submit", (event) => handleAction(() => submitExchange(event)));

for (const button of document.querySelectorAll("#loginForm button")) {
  button.addEventListener("click", () => handleAction(() => submitLogin(button.dataset.action)));
}

handleAction(loadConfig);
handleAction(loadState);

async function loadConfig() {
  const data = await api("/api/config");
  users.innerHTML = "";
  for (const user of data.users ?? []) {
    const card = document.createElement("div");
    card.className = "user-card";
    card.innerHTML = `
      <strong>${escapeHtml(user.id)}</strong>
      <div>${escapeHtml(user.name ?? "")}</div>
      <div>${escapeHtml(user.loginName)}</div>
      <div class="user-actions">
        <button type="button" data-user-status="${escapeHtml(user.id)}">查状态/积分</button>
        <span class="integral-badge" data-user-integral="${escapeHtml(user.id)}">未查询</span>
      </div>
    `;
    users.appendChild(card);
  }
  if (!data.users?.length) {
    users.textContent = "暂无用户。登录成功后会自动保存到配置文件。";
  }
  const exchangeSelect = document.querySelector("#exchangeForm [name='exchangeId']");
  if (exchangeSelect && data.exchange?.exchangeId) {
    exchangeSelect.value = data.exchange.exchangeId;
  }
  const startAtSelect = document.querySelector("#exchangeForm [name='startAt']");
  if (startAtSelect && data.exchange?.startAt) {
    startAtSelect.value = data.exchange.startAt;
  }
  write(data);
}

users.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-user-status]");
  if (!button) return;
  const userId = button.dataset.userStatus;
  const badge = button.closest(".user-card")?.querySelector("[data-user-integral]");
  try {
    setIntegralBadge(badge, "查询中...", "loading");
    const result = await api(`/api/user/status?userId=${encodeURIComponent(userId)}`);
    const integral = result.status?.remain_integral ?? result.status?.total_integral ?? "未返回";
    setIntegralBadge(badge, `积分 ${integral}`, "success");
  } catch (error) {
    setIntegralBadge(badge, "查询失败", "error");
    write(`操作失败\n${error.message ?? String(error)}`);
  }
});

async function loadState() {
  const state = await api("/api/state");
  stateOutput.textContent = state.text ?? JSON.stringify(state, null, 2);
}

async function submitLogin(action) {
  const form = formData("#loginForm");
  const paths = {
    captcha: "/api/login/captcha",
    sendSms: "/api/login/send-sms",
    password: "/api/login/password",
    sms: "/api/login/sms"
  };
  const result = await api(paths[action], form);
  if (action === "captcha") {
    renderCaptcha(result);
  }
  write(result);
  await loadConfig();
}

async function submitDaily(event) {
  event.preventDefault();
  await submitTaskWithDuplicateConfirm("/api/daily", formData("#dailyForm"));
  await loadState();
}

async function submitExchange(event) {
  event.preventDefault();
  await submitTaskWithDuplicateConfirm("/api/exchange", formData("#exchangeForm"));
  await loadState();
}

async function submitTaskWithDuplicateConfirm(path, form) {
  try {
    write(await api(path, form));
  } catch (error) {
    if (error.data?.duplicate && confirm(`${error.data.message}\n是否仍然重复执行？`)) {
      write(await api(path, { ...form, force: true }));
      return;
    }
    throw error;
  }
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? data.message ?? "请求失败");
    error.data = data;
    throw error;
  }
  return data;
}

function formData(selector) {
  const form = document.querySelector(selector);
  const data = Object.fromEntries(new FormData(form).entries());
  for (const key of ["delayMs", "concurrency", "intervalMs", "maxAttempts"]) {
    if (key in data && data[key] !== "") data[key] = Number(data[key]);
  }
  return data;
}

function write(data) {
  output.textContent = typeof data === "string" ? data : data?.text ?? JSON.stringify(data, null, 2);
}

function renderCaptcha(result) {
  const data = result?.data ?? result?.envelope ?? result;
  const image = data?.img;
  const imgUniCode = data?.imgUniCode;
  if (!image || !captchaPreview || !captchaImage || !captchaMeta) return;

  const cleanImage = String(image).replace(/\s+/g, "");
  captchaImage.src = cleanImage.startsWith("data:")
    ? cleanImage
    : `data:image/jpeg;base64,${cleanImage}`;
  captchaPreview.hidden = false;

  if (imgUniCode) {
    const input = document.querySelector("#loginForm [name='imgUniCode']");
    if (input) input.value = imgUniCode;
    captchaMeta.textContent = `验证码编号已填入: ${imgUniCode}`;
  } else {
    captchaMeta.textContent = "请输入图片中的图形验证码。";
  }
}

function setIntegralBadge(element, text, state) {
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
}

async function handleAction(action) {
  try {
    await action();
  } catch (error) {
    write(`操作失败\n${error.message ?? String(error)}`);
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
