@echo off
chcp 65001 >nul
rem 双击启动 RatCVS 大鼠心血管实验台（本地模式）
rem 加 --lan 可开放局域网：node scripts\serve.mjs --lan
node scripts\serve.mjs --open
pause
