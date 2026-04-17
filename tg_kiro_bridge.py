#!/usr/bin/env python3
import json, subprocess, time, urllib.request, re, os

TOKEN = os.environ.get("TG_TOKEN", "YOUR_TOKEN_HERE")
BASE = f"https://api.telegram.org/bot{TOKEN}"

def api(method, **params):
    data = json.dumps(params).encode()
    req = urllib.request.Request(f"{BASE}/{method}", data=data,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["result"]

HISTORY_LIMIT = 10
history = {}  # chat_id -> list of (role, text)

def ask_kiro(chat_id, text):
    hist = history.setdefault(chat_id, [])
    hist.append(("User", text))

    context = "\n".join(f"{r}: {t}" for r, t in hist[-HISTORY_LIMIT:])
    prompt = f"Conversation so far:\n{context}\n\nAssistant:"

    result = subprocess.run(
        ["kiro-cli", "chat", "--legacy-ui", "--trust-all-tools", prompt],
        input="\n",
        capture_output=True, text=True, timeout=120
    )
    # Strip all ANSI escape sequences
    clean = re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', result.stdout)
    clean = re.sub(r'\x1b[=>]', '', clean)
    lines = []
    for line in clean.splitlines():
        line = re.sub(r'^>\s*', '', line).strip()
        if line and not re.match(r'^[▸●▰▱✓✔]', line) and 'Credits:' not in line and 'trusted' not in line and 'Agents can' not in line and 'Learn more' not in line and not re.match(r'.*(using tool:|Fetching content|Searching the web)', line):
            lines.append(line)
    reply = '\n'.join(lines).strip() or "Нет ответа"
    hist.append(("Assistant", reply))
    return reply

def poll():
    offset = None
    print("Telegram → Kiro bridge started", flush=True)
    while True:
        try:
            updates = api("getUpdates", offset=offset, timeout=20,
                allowed_updates=["message"])
        except Exception as e:
            print(f"[poll error] {e}", flush=True)
            time.sleep(3)
            continue
        for u in updates:
            offset = u["update_id"] + 1
            msg = u.get("message", {})
            text = msg.get("text", "")
            if not text:
                continue
            chat_id = msg["chat"]["id"]
            user = msg["from"].get("username") or msg["from"].get("first_name", "?")
            print(f"[{user}]: {text}", flush=True)
            try:
                reply = ask_kiro(chat_id, text)
            except Exception as e:
                reply = f"Ошибка: {e}"
            api("sendMessage", chat_id=chat_id, text=reply)
            print(f"[sent]: {reply[:80]}", flush=True)

if __name__ == "__main__":
    poll()
