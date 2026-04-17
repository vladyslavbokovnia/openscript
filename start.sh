#!/bin/bash
python3 tg_kiro_bridge.py &
python3 tg_codespace_manager.py &
wait
