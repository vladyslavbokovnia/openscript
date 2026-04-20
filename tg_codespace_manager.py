#!/usr/bin/env python3
"""Telegram bot to start/stop GitHub Codespace and tg_kiro_bridge."""
import json, os, time, subprocess, urllib.request, urllib.error

TG_TOKEN = os.environ["TG_TOKEN"]
GH_TOKEN = os.environ["GH_TOKEN"]
CODESPACE_NAME = os.environ["CODESPACE_NAME"]
ALLOWED_CHAT = int(os.environ.get("ALLOWED_CHAT", "0"))
BRIDGE_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tg_kiro_bridge.py")

_bridge_proc = None
_kiro_proc = None
_autostart = False

GH = "https://api.github.com"

def tg(method, **params):
    data = json.dumps(params).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TG_TOKEN}/{method}", data=data,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

def gh(method, path, data=None):
    req = urllib.request.Request(
        f"{GH}{path}",
        data=json.dumps(data).encode() if data else None,
        headers={"Authorization": f"Bearer {GH_TOKEN}",
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "Content-Type": "application/json"},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}

def codespace_state():
    return gh("GET", f"/user/codespaces/{CODESPACE_NAME}").get("state", "unknown")

def bridge_running():
    global _bridge_proc
    return _bridge_proc is not None and _bridge_proc.poll() is None

def bridge_start():
    global _bridge_proc
    if bridge_running():
        return
    bridge_token = os.environ.get("TG_BRIDGE_TOKEN")
    if not bridge_token:
        raise RuntimeError("TG_BRIDGE_TOKEN не задан — bridge использует тот же токен, конфликт getUpdates")
    if bridge_token == TG_TOKEN:
        raise RuntimeError("TG_BRIDGE_TOKEN совпадает с TG_TOKEN — конфликт getUpdates")
    env = os.environ.copy()
    env["TG_TOKEN"] = bridge_token
    _bridge_proc = subprocess.Popen(["python3", BRIDGE_SCRIPT], env=env)

def bridge_stop():
    global _bridge_proc
    if bridge_running():
        _bridge_proc.terminate()
        _bridge_proc.wait(timeout=10)

def kiro_running():
    global _kiro_proc
    return _kiro_proc is not None and _kiro_proc.poll() is None

def kiro_start():
    global _kiro_proc
    if kiro_running():
        return
    token = os.environ.get("TG_BRIDGE_TOKEN") or os.environ.get("TG_TOKEN")
    _kiro_proc = subprocess.Popen(
        ["/usr/bin/gh", "codespace", "ssh", "-c", CODESPACE_NAME, "--",
         f"TG_TOKEN={token}", "python3", "/workspaces/-/tg_kiro_bridge.py"],
        env=os.environ.copy()
    )

def kiro_stop():
    global _kiro_proc
    if kiro_running():
        _kiro_proc.terminate()
        _kiro_proc.wait(timeout=10)

def make_buttons(cs_state=None):
    if cs_state is None:
        cs_state = codespace_state()
    cs_on = cs_state == "Available"
    cs_status = "🟢 Codespace ON" if cs_on else "🔴 Codespace OFF"
    bridge_status = "🟢 Bridge ON" if bridge_running() else "🔴 Bridge OFF"
    kiro_status = "🟢 Kiro Bridge ON" if kiro_running() else "🔴 Kiro Bridge OFF"
    autostart_status = "🔔 Автозапуск ON" if _autostart else "🔕 Автозапуск OFF"
    return {"reply_markup": json.dumps({
        "inline_keyboard": [
            [{"text": cs_status, "callback_data": "cs_toggle"}],
            [{"text": kiro_status, "callback_data": "kiro_toggle"}],
            [{"text": bridge_status, "callback_data": "bridge_toggle"}],
            [{"text": autostart_status, "callback_data": "autostart_toggle"}],
            [{"text": "🛑 Остановить бота", "callback_data": "manager_stop"}],
        ]
    })}

def handle_update(upd):
    cb = upd.get("callback_query")
    if cb:
        chat_id = cb["message"]["chat"]["id"]
        if ALLOWED_CHAT and chat_id != ALLOWED_CHAT:
            tg("answerCallbackQuery", callback_query_id=cb["id"])
            return
        tg("answerCallbackQuery", callback_query_id=cb["id"])
        data = cb.get("data")
        if data == "cs_toggle":
            state = codespace_state()
            if state == "Available":
                tg("sendMessage", chat_id=chat_id, text="⏹️ Останавливаю...", **make_buttons(state))
                gh("POST", f"/user/codespaces/{CODESPACE_NAME}/stop")
                for _ in range(24):
                    time.sleep(5)
                    if codespace_state() != "Available":
                        tg("sendMessage", chat_id=chat_id, text="✅ Остановлен.", **make_buttons())
                        return
                tg("sendMessage", chat_id=chat_id, text="⚠️ Таймаут — проверь вручную.", **make_buttons())
            else:
                _do_start(chat_id)
        elif data == "bridge_toggle":
            if bridge_running():
                bridge_stop()
                tg("sendMessage", chat_id=chat_id, text="🔴 Bridge остановлен.", **make_buttons())
            else:
                try:
                    bridge_start()
                    tg("sendMessage", chat_id=chat_id, text="🟢 Bridge запущен.", **make_buttons())
                except RuntimeError as e:
                    tg("sendMessage", chat_id=chat_id, text=f"❌ {e}", **make_buttons())
        elif data == "kiro_toggle":
            if kiro_running():
                kiro_stop()
                tg("sendMessage", chat_id=chat_id, text="🔴 Kiro Bridge остановлен.", **make_buttons())
            else:
                kiro_start()
                tg("sendMessage", chat_id=chat_id, text="🟢 Kiro Bridge запущен.", **make_buttons())
        elif data == "autostart_toggle":
            global _autostart
            _autostart = not _autostart
            status = "🔔 Автозапуск включён" if _autostart else "🔕 Автозапуск выключен"
            tg("sendMessage", chat_id=chat_id, text=status, **make_buttons())
        elif data == "manager_stop":
            tg("sendMessage", chat_id=chat_id, text="🛑 Бот остановлен.")
            os._exit(0)
        return

    msg = upd.get("message", {})
    chat_id = msg.get("chat", {}).get("id")
    if not chat_id or not msg.get("text"):
        return
    if ALLOWED_CHAT and chat_id != ALLOWED_CHAT:
        return
    if _autostart:
        _do_start(chat_id)

def _do_start(chat_id):
    if codespace_state() == "Available":
        tg("sendMessage", chat_id=chat_id, text="✅ Codespace уже запущен.", **make_buttons())
        return
    tg("sendMessage", chat_id=chat_id, text="▶️ Запускаю Codespace...", **make_buttons())
    gh("POST", f"/user/codespaces/{CODESPACE_NAME}/start")
    for _ in range(24):
        time.sleep(5)
        tg("sendChatAction", chat_id=chat_id, action="typing")
        if codespace_state() == "Available":
            tg("sendMessage", chat_id=chat_id, text="✅ Готов.", **make_buttons())
            return
    tg("sendMessage", chat_id=chat_id, text="⚠️ Таймаут — проверь вручную.", **make_buttons())

def wait_for_network():
    while True:
        try:
            urllib.request.urlopen("https://api.telegram.org", timeout=5)
            return
        except Exception:
            print("Waiting for network...", flush=True)
            time.sleep(5)

def main():
    wait_for_network()
    offset = None
    print("Bot started.")
    if ALLOWED_CHAT:
        try:
            tg("sendMessage", chat_id=ALLOWED_CHAT, text="🤖 Менеджер запущен.", **make_buttons())
        except Exception as e:
            print(f"Startup message error: {e}")
    while True:
        try:
            params = {"timeout": 30, "allowed_updates": ["message", "callback_query"]}
            if offset:
                params["offset"] = offset
            updates = tg("getUpdates", **params)
            for upd in updates.get("result", []):
                offset = upd["update_id"] + 1
                handle_update(upd)
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(3)

if __name__ == "__main__":
    main()
