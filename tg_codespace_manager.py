#!/usr/bin/env python3
"""Telegram bot to start/stop GitHub Codespace."""
import json, os, time, urllib.request, urllib.error

TG_TOKEN = os.environ["TG_TOKEN"]
GH_TOKEN = os.environ["GH_TOKEN"]          # Personal Access Token, scope: codespace
CODESPACE_NAME = os.environ["CODESPACE_NAME"]  # e.g. "username-repo-abc123"
ALLOWED_CHAT = int(os.environ.get("ALLOWED_CHAT", "0"))  # your chat_id, 0 = any

TG = f"https://api.telegram.org/bot{TG_TOKEN}"
GH = "https://api.github.com"

def tg(method, **params):
    data = json.dumps(params).encode()
    req = urllib.request.Request(f"{TG}/{method}", data=data,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)

def gh(method, path, data=None):
    req = urllib.request.Request(f"{GH}{path}",
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
    r = gh("GET", f"/user/codespaces/{CODESPACE_NAME}")
    return r.get("state", "unknown")

def start_codespace():
    gh("POST", f"/user/codespaces/{CODESPACE_NAME}/start")

def stop_codespace():
    gh("POST", f"/user/codespaces/{CODESPACE_NAME}/stop")

def handle_update(upd):
    msg = upd.get("message", {})
    chat_id = msg.get("chat", {}).get("id")
    text = msg.get("text", "")
    if not chat_id or not text:
        return
    if ALLOWED_CHAT and chat_id != ALLOWED_CHAT:
        return

    tg("sendChatAction", chat_id=chat_id, action="typing")
    state = codespace_state()

    if state in ("Shutdown", "Stopped", "Available"):
        if state != "Available":
            tg("sendMessage", chat_id=chat_id, text="▶️ Запускаю Codespace...")
            start_codespace()
            for _ in range(12):
                time.sleep(5)
                tg("sendChatAction", chat_id=chat_id, action="typing")
                if codespace_state() == "Available":
                    break
        tg("sendMessage", chat_id=chat_id, text="✅ Codespace запущен и готов к работе.")
    else:
        tg("sendMessage", chat_id=chat_id, text=f"ℹ️ Codespace уже в состоянии: {state}")

def main():
    offset = None
    print("Bot started.")
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
