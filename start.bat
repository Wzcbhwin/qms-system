@echo off
chcp 65001 >nul 2>&1
title QMS 质量整改追踪系统
echo ========================================
echo   QMS 质量整改追踪系统 - 启动中...
echo ========================================
echo.

cd /d "%~dp0"

echo 正在启动后端服务...
start /b "QMS Server" node server.js

echo.
echo ========================================
echo   系统已启动！
echo   访问地址: http://localhost:3000
echo   默认账号: admin@dafor.com
echo   默认密码: 123456
echo ========================================
echo.
echo 按任意键打开浏览器...
pause >nul

start http://localhost:3000
