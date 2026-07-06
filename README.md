# QMS 质量整改追踪系统

质量管理系统，用于追踪和整改质量问题。

## 部署指南

### 方案A：部署到 Render.com（推荐）

1. **创建 GitHub 仓库**
   - 访问 https://github.com/new
   - 仓库名：`qms-system`
   - 选择 Public
   - 不要勾选初始化选项
   - 点击 Create repository

2. **推送代码到 GitHub**
   ```bash
   cd "E:\workbuddy p\2026-06-26-15-41-27"
   git remote add origin https://github.com/YOUR_USERNAME/qms-system.git
   git branch -M main
   git push -u origin main
   ```

3. **部署到 Render.com**
   - 访问 https://render.com
   - 注册/登录（可以用 GitHub 账号）
   - 点击 "New +" → "Web Service"
   - 连接你的 GitHub 仓库 `qms-system`
   - 配置：
     - Name: `qms-system`
     - Environment: `Node`
     - Build Command: `npm install`
     - Start Command: `npm start`
     - Plan: `Free`
   - 点击 "Create Web Service"

4. **访问应用**
   - 部署完成后，Render 会提供一个网址：`https://qms-system.onrender.com`
   - 访问该网址即可使用系统

### 注意事项

- Render 免费版会在 15 分钟无活动后休眠，下次访问需要等待 30-60 秒唤醒
- 数据库使用 SQLite，数据会持久化保存
- 如需更稳定服务，建议升级到付费计划

## 本地开发

```bash
npm install
npm start
```

访问 http://localhost:3000

## 默认账号

- 管理员：admin@dafor.com / 123456
- 质量员：quality@dafor.com / 123456
- 检验员：jianyan@dafor.com / 123456
